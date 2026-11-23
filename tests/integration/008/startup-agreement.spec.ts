import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it, vi } from "vitest";

import {
  executeProjectEffect,
  StaticProjectEffectGuard,
} from "../../../packages/platform-core/src/commanding/project-effect-guard.ts";
import {
  pilotContentHash,
  type PilotEffectContext,
  type PilotFenceSnapshot,
  type PilotRecord,
} from "../../../packages/platform-core/src/index.ts";
import { PilotRepository } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { PilotEffectGuard } from "../../../packages/runtime-composition/src/pilot/effect-guard.ts";
import { PinnedNetworkTransport } from "../../../packages/runtime-composition/src/pilot/network-policy.ts";
import {
  assertDeploymentStartupBinding,
  DeploymentStartup,
} from "../../../packages/runtime-composition/src/pilot/startup.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
} from "../../support/002-us3-database.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

const hash = `sha256:${"a".repeat(64)}` as const;
const ref = { id: "approved-policy", version: 1, contentHash: hash };
const networkBody = {
  mode: "CORPORATE" as const,
  validUntil: new Date(Date.now() + 600_000).toISOString(),
  deadlineMs: 1000,
  maximumRequestBytes: 4096,
  maximumResponseBytes: 4096,
  endpoints: [
    {
      origin: "https://identity.example.test",
      addressRanges: ["10.42.0.0/24"],
      routes: [{ path: "/oidc", match: "EXACT" as const, methods: ["GET"], queryKeys: [] }],
    },
  ],
};
const networkRef = {
  id: "approved-network-policy",
  version: 1,
  contentHash: pilotContentHash(networkBody) as `sha256:${string}`,
};
function config(workspaceId: string = randomUUID(), projectId: string = randomUUID()) {
  return {
    schemaVersion: 1,
    deploymentId: randomUUID(),
    version: 1,
    deploymentProfile: "integration",
    runtimeProfile: "non-local",
    environmentScope: "NON_PROD",
    compositionKey: "qa-jira-gitlab-mattermost-test",
    workspaceId,
    projectIds: [projectId],
    imageDigest: hash,
    artifactMode: "GITLAB_ONLY",
    inputPackageRef: ref,
    identityPolicyRef: ref,
    secretResolverPolicyRef: ref,
    signingPolicyRef: ref,
    telemetryPolicyRef: ref,
    networkPolicyRef: networkRef,
    artifactPolicyRef: ref,
    modelPolicyRef: ref,
    recoveryPolicyRef: ref,
    connectorBindings: ["jira", "gitlab", "mattermost"].map((provider) => ({ provider, ref })),
    endpoints: [
      {
        purpose: "identity",
        url: "https://identity.example.test/oidc",
        allowedOrigin: "https://identity.example.test",
      },
      {
        purpose: "browser",
        url: "https://web.example.test",
        allowedOrigin: "https://web.example.test",
      },
      {
        purpose: "callback",
        url: "https://web.example.test/api/v1/auth/callback",
        allowedOrigin: "https://web.example.test",
      },
    ],
  };
}
function network() {
  return new PinnedNetworkTransport(
    { ...networkBody, ref: networkRef },
    { resolve: async () => ["10.42.0.1"] },
  );
}
function options(policy = config()) {
  return {
    policy,
    component: "api" as const,
    instanceId: randomUUID(),
    imageDigest: hash,
    leaseMs: 10_000,
    validationDeadlineMs: 1000,
    network: network(),
    requests: [{ purpose: "identity", method: "GET", url: "https://identity.example.test/oidc" }],
    browser: {
      origin: "https://web.example.test",
      callbackUrl: "https://web.example.test/api/v1/auth/callback",
      identityPolicyRef: ref,
    },
    references: {
      assertCurrent: async () => ({ validUntil: new Date(Date.now() + 30_000).toISOString() }),
    },
  };
}
describe("008 startup validation before persistence", () => {
  it("rejects unpinned callbacks, image drift, missing endpoints and fixture network before any SQL", () => {
    const query = vi.fn();
    const source = { query } as unknown as ConstructorParameters<typeof DeploymentStartup>[0];
    const input = options();
    for (const patch of [
      { imageDigest: `sha256:${"b".repeat(64)}` },
      {
        browser: {
          ...input.browser,
          callbackUrl: "https://evil.example.test/api/v1/auth/callback",
        },
      },
      { requests: [] },
      { policy: { ...input.policy, signingPolicyRef: { ...ref, id: "local-signer" } } },
    ])
      expect(() => new DeploymentStartup(source, { ...input, ...patch })).toThrow();
    const localNetwork = new PinnedNetworkTransport({
      ...input.network.policy,
      mode: "LOCAL_FIXTURE",
    });
    expect(() => new DeploymentStartup(source, { ...input, network: localNetwork })).toThrow(
      "DEPLOYMENT_STARTUP_INVALID",
    );
    expect(query).not.toHaveBeenCalled();
    const altered = new PinnedNetworkTransport({
      ...input.network.policy,
      maximumRequestBytes: 8192,
    });
    expect(() => new DeploymentStartup(source, { ...input, network: altered })).toThrow(
      "DEPLOYMENT_STARTUP_INVALID",
    );
  });
  it("bounds unresponsive validation and rejects a forged or not-yet-started runtime", async () => {
    const transaction = vi.fn();
    const source = { transaction } as unknown as ConstructorParameters<typeof DeploymentStartup>[0];
    const runtime = new DeploymentStartup(source, {
      ...options(),
      validationDeadlineMs: 100,
      references: {
        assertCurrent: async () =>
          new Promise<never>(() => {
            /* Promise intentionally remains pending. */
          }),
      },
    });
    const pending = runtime.start();
    const rejected = expect(pending).rejects.toThrow("DEPLOYMENT_INPUT_UNAVAILABLE");
    expect(() => assertDeploymentStartupBinding(runtime, "api", runtime.policy)).toThrow(
      "DEPLOYMENT_STARTUP_REQUIRED",
    );
    expect(() =>
      assertDeploymentStartupBinding(
        { assertBinding: () => undefined } as unknown as DeploymentStartup,
        "api",
        runtime.policy,
      ),
    ).toThrow("DEPLOYMENT_STARTUP_REQUIRED");
    await rejected;
    expect(transaction).not.toHaveBeenCalled();
    expect((await runtime.readiness()).ready).toBe(false);
    let current = true;
    const input = options();
    const changing = new DeploymentStartup(source, {
      ...input,
      network: new PinnedNetworkTransport(input.network.policy, {
        resolve: async () => {
          current = false;
          return ["10.42.0.1"];
        },
      }),
      references: {
        assertCurrent: async () => {
          if (!current) throw new Error("PRIVATE_REVOKED_POLICY_CANARY");
          return { validUntil: new Date(Date.now() + 30_000).toISOString() };
        },
      },
    });
    await expect(changing.start()).rejects.toThrow("DEPLOYMENT_INPUT_UNAVAILABLE");
    expect(transaction).not.toHaveBeenCalled();
  });
});
describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "008 durable deployment agreement",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "requires both exact current processes and fences rollout, stop and policy outage on %s",
      async (image) => {
        const f = await startUs3DatabaseFixture({ postgresImage: image });
        const runtimes: DeploymentStartup[] = [];
        try {
          const policy = config(f.workspaceId, f.projectId);
          const scope = { workspaceId: f.workspaceId, projectId: f.projectId };
          const publish = async (configuration: typeof policy) => {
            const value = {
              schemaVersion: 1 as const,
              kind: "DEPLOYMENT" as const,
              id: configuration.deploymentId,
              version: configuration.version,
              ...scope,
              actorRef: us3Actor.principalId,
              correlationId: randomUUID(),
              createdAt: new Date().toISOString(),
              body: configuration,
            };
            const record = { ...value, contentHash: pilotContentHash(value) } as PilotRecord;
            await new PilotRepository(f.source).publish(record, record.version - 1);
            return {
              id: record.id,
              version: record.version,
              contentHash: record.contentHash as `sha256:${string}`,
            };
          };
          const deploymentRef = await publish(policy);
          let available = true;
          const make = (component: "api" | "worker", configuration = policy) => {
            const runtime = new DeploymentStartup(f.source, {
              ...options(configuration),
              component,
              imageDigest: configuration.imageDigest,
              references: {
                assertCurrent: async () => {
                  if (!available) throw new Error("PRIVATE_STARTUP_INPUT_CANARY");
                  return { validUntil: new Date(Date.now() + 30_000).toISOString() };
                },
              },
            });
            runtimes.push(runtime);
            return runtime;
          };
          const api = make("api");
          await api.start();
          expect(await api.readiness()).toEqual({
            ready: false,
            reasonCode: "DEPLOYMENT_PEER_MISSING",
          });
          const worker = make("worker");
          await worker.start();
          expect(await api.readiness()).toEqual({ ready: true, reasonCode: "READY" });
          const context: PilotEffectContext = {
            principalId: us3Actor.principalId,
            purpose: "SANDBOX_CONFORMANCE",
            deploymentRef,
            cohortRef: ref,
            fenceRef: ref,
          };
          const fence: PilotFenceSnapshot = {
            ...scope,
            mode: "SANDBOX_CONFORMANCE",
            fenceRef: ref,
            cohortRef: ref,
            deploymentRef,
            projectIds: [f.projectId],
            principalIds: [us3Actor.principalId],
            environment: "NON_PROD",
            startsAt: new Date(Date.now() - 60_000).toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            revoked: false,
            runtimeInstanceId: worker.instanceId,
          };
          const guard = new PilotEffectGuard(
            new StaticProjectEffectGuard({
              ...scope,
              operationalState: "ACTIVE",
              onboardingVersion: 1,
            }),
            { current: async () => fence, authorize: async () => true },
            worker.instanceId,
            Date.now,
            worker,
          );
          let effects = 0;
          const send = () => executeProjectEffect(guard, scope, 1, async () => ++effects, context);
          await send();
          expect(effects).toBe(1);
          await expect(
            worker.assertReady({ ...scope, projectId: randomUUID() }, deploymentRef),
          ).rejects.toThrow("DEPLOYMENT_SCOPE_DENIED");
          available = false;
          expect(await api.readiness()).toEqual({
            ready: false,
            reasonCode: "DEPLOYMENT_INPUT_UNAVAILABLE",
          });
          await expect(send()).rejects.toThrow("DEPLOYMENT_INPUT_UNAVAILABLE");
          expect(effects).toBe(1);
          available = true;
          const revision = {
            ...policy,
            version: 2,
            imageDigest: `sha256:${"b".repeat(64)}` as const,
          };
          const nextRef = await publish(revision);
          const nextApi = make("api", revision);
          await nextApi.start();
          expect(await nextApi.readiness()).toEqual({
            ready: false,
            reasonCode: "DEPLOYMENT_DIGEST_MISMATCH",
          });
          await expect(send()).rejects.toThrow("DEPLOYMENT_REVISION_STALE");
          expect(effects).toBe(1);
          await api.stop();
          await worker.stop();
          await expect(worker.refresh()).rejects.toThrow("DEPLOYMENT_RUNTIME_STOPPED");
          const nextWorker = make("worker", revision);
          await nextWorker.start();
          await nextWorker.assertReady(scope, nextRef);
          expect(await nextApi.readiness()).toEqual({ ready: true, reasonCode: "READY" });
          await nextWorker.stop();
          expect(await nextApi.readiness()).toEqual({
            ready: false,
            reasonCode: "DEPLOYMENT_PEER_MISSING",
          });
          await expect(
            f.source.query(
              "UPDATE pilot_runtime_registrations SET config_digest=$1 WHERE instance_id=$2",
              [hash, nextApi.instanceId],
            ),
          ).rejects.toThrow("DEPLOYMENT_REGISTRATION_IMMUTABLE");
          const lock = f.source.createQueryRunner();
          await lock.connect();
          await lock.startTransaction();
          try {
            await lock.query(
              "SELECT instance_id FROM pilot_runtime_registrations WHERE instance_id=$1 FOR UPDATE",
              [nextApi.instanceId],
            );
            const started = performance.now();
            await expect(nextApi.refresh()).rejects.toThrow();
            expect(performance.now() - started).toBeLessThan(4000);
            expect(await nextApi.readiness()).toEqual({
              ready: false,
              reasonCode: "DEPLOYMENT_RUNTIME_STOPPED",
            });
          } finally {
            await lock.rollbackTransaction();
            await lock.release();
          }
        } finally {
          for (const runtime of runtimes) await runtime.stop();
          await stopUs3DatabaseFixture(f);
        }
      },
      120_000,
    );
    it.each(POSTGRES_TEST_IMAGES)(
      "cannot revive expired process leases on %s",
      async (image) => {
        const f = await startUs3DatabaseFixture({ postgresImage: image });
        let api: DeploymentStartup | undefined;
        let worker: DeploymentStartup | undefined;
        try {
          const policy = config(f.workspaceId, f.projectId);
          const value = {
            schemaVersion: 1 as const,
            kind: "DEPLOYMENT" as const,
            id: policy.deploymentId,
            version: 1,
            workspaceId: f.workspaceId,
            projectId: f.projectId,
            actorRef: us3Actor.principalId,
            correlationId: randomUUID(),
            createdAt: new Date().toISOString(),
            body: policy,
          };
          await new PilotRepository(f.source).publish(
            { ...value, contentHash: pilotContentHash(value) } as PilotRecord,
            0,
          );
          api = new DeploymentStartup(f.source, { ...options(policy), leaseMs: 1000 });
          worker = new DeploymentStartup(f.source, {
            ...options(policy),
            component: "worker",
            leaseMs: 1000,
          });
          await api.start();
          await worker.start();
          expect((await api.readiness()).ready).toBe(true);
          await delay(1100);
          expect(await api.readiness()).toEqual({
            ready: false,
            reasonCode: "DEPLOYMENT_LEASE_EXPIRED",
          });
          await expect(api.refresh()).rejects.toThrow("DEPLOYMENT_LEASE_EXPIRED");
          expect((await worker.readiness()).ready).toBe(false);
        } finally {
          await api?.stop();
          await worker?.stop();
          await stopUs3DatabaseFixture(f);
        }
      },
      120_000,
    );
  },
);
