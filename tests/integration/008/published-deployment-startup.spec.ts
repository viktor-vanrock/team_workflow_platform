import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  type ExactRevisionRef,
  executeProjectEffect,
  INPUT_REQUIREMENTS_008,
  pilotContentHash,
  type PilotEffectContext,
  type PilotFenceSnapshot,
  type PilotRecord,
  StaticProjectEffectGuard,
} from "../../../packages/platform-core/src/index.ts";
import {
  PilotRepository,
  type RuntimeConfigurationKind,
  type RuntimeConfigurationPublication,
  RuntimeConfigurationRepository,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { parseDeploymentPolicy } from "../../../packages/runtime-composition/src/pilot/deployment-config.ts";
import { PilotEffectGuard } from "../../../packages/runtime-composition/src/pilot/effect-guard.ts";
import { PinnedNetworkTransport } from "../../../packages/runtime-composition/src/pilot/network-policy.ts";
import {
  createPublishedDeploymentStartup,
  PublishedDeploymentReferences,
} from "../../../packages/runtime-composition/src/pilot/published-deployment-references.ts";
import { PilotReadinessQuery } from "../../../packages/runtime-composition/src/pilot/readiness-query.ts";
import type { DeploymentStartup } from "../../../packages/runtime-composition/src/pilot/startup.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
} from "../../support/002-us3-database.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

const pin = (id: string, document: unknown): ExactRevisionRef => ({
  id,
  version: 1,
  contentHash: pilotContentHash(document) as ExactRevisionRef["contentHash"],
});
async function fixture(image: string) {
  const f = await startUs3DatabaseFixture({ postgresImage: image });
  try {
    const otherProject = randomUUID();
    await f.source.query(
      "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES($1,$2,'startup-second','Second','ACTIVE','INTERNAL')",
      [otherProject, f.workspaceId],
    );
    const projectIds = [f.projectId, otherProject];
    const scope = { workspaceId: f.workspaceId, projectIds };
    const publications: RuntimeConfigurationPublication[] = [];
    const repository = new RuntimeConfigurationRepository();
    const publish = async (
      kind: RuntimeConfigurationKind,
      document: Record<string, unknown>,
      id = randomUUID(),
    ) => {
      const value = {
        schemaVersion: 1 as const,
        ...scope,
        kind,
        ref: pin(id, document),
        document: document as RuntimeConfigurationPublication["document"],
        publishedBy: us3Actor.principalId,
        publishedAt: new Date(Date.now() - 1000).toISOString(),
        validUntil: new Date(Date.now() + 600_000).toISOString(),
        correlationId: randomUUID(),
      };
      await f.source.transaction((manager) => repository.publish(manager, value, 0));
      publications.push(value);
      return value.ref;
    };
    const endpoints = [
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
    ];
    const connectorBindings = [];
    for (const provider of ["jira", "gitlab", "mattermost"]) {
      const endpoint = `https://${provider}.example.test`;
      endpoints.push({ purpose: provider, url: endpoint, allowedOrigin: endpoint });
      const projects = [];
      for (const projectId of projectIds) {
        const connectorKey = `connector-${provider}`;
        const connection = { connectorKey, baseUrl: endpoint };
        const connectionRef = pin(randomUUID(), connection);
        const profile = {
          connectorKey,
          connectionRef,
          capabilityConfigurations: [
            {
              capabilityKey: provider,
              exactContractVersion: "1.0.0",
              environmentScopes: ["NON_PROD"],
            },
          ],
        };
        const profileRef = pin(randomUUID(), profile);
        const binding = {
          entries: [
            {
              profileRef,
              capabilityKey: provider,
              exactContractVersion: "1.0.0",
              environmentScope: "NON_PROD",
            },
          ],
        };
        const integrationBindingRef = pin(randomUUID(), binding);
        for (const [table, ref, content] of [
          ["connection", connectionRef, connection],
          ["connector_profile", profileRef, profile],
          ["project_integration_binding", integrationBindingRef, binding],
        ] as const) {
          const scoped = table === "project_integration_binding";
          await f.source.query(
            `INSERT INTO ${table}_headers(id,workspace_id,key,current_published_version${scoped ? ",project_id" : ""}) VALUES($1,$2,$3,1${scoped ? ",$4" : ""})`,
            [ref.id, f.workspaceId, randomUUID(), ...(scoped ? [projectId] : [])],
          );
          await f.source.query(
            `INSERT INTO ${table}_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at${scoped ? ",project_id" : ""}) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,now()${scoped ? ",$6" : ""})`,
            [
              randomUUID(),
              f.workspaceId,
              ref.id,
              content,
              ref.contentHash,
              ...(scoped ? [projectId] : []),
            ],
          );
        }
        projects.push({
          projectId,
          connectorKey,
          endpoint,
          integrationBindingRef,
          profileRef,
          connectionRef,
        });
      }
      connectorBindings.push({
        provider,
        ref: await publish("CONNECTOR_BINDING", { provider, projects }),
      });
    }
    const inputId = randomUUID();
    const listFields = new Set([
      "projectRefs",
      "channelRefs",
      "secretRefs",
      "origins",
      "callbackRoutes",
      "humanRefs",
      "sourceRefs",
    ]);
    // Controlled reviewed metadata exercises validation; it is not a corporate C1 attestation.
    const entries = Object.entries(INPUT_REQUIREMENTS_008).map(([id, fields]) => {
      const metadata: Record<string, unknown> = Object.fromEntries(
        fields.map((field) => [
          field,
          listFields.has(field) ? ["urn:approved:reference"] : "urn:approved:reference",
        ]),
      );
      if (id === "IN-02")
        metadata.providers = ["JIRA", "GITLAB", "MATTERMOST"].map((type) => ({
          type,
          edition: "controlled",
          version: "1.0",
          apiDialect: "controlled-v1",
          authStrategy: "controlled",
          documentRef: "urn:approved:doc",
          permissionsRef: "urn:approved:permissions",
        }));
      if (id === "IN-03") metadata.issuer = "https://identity.example.test/oidc";
      if (id === "IN-07") metadata.artifactMode = "GITLAB_ONLY";
      if (id === "IN-08") metadata.backupMethod = "LOGICAL";
      const entry = {
        id,
        version: 1,
        ...scope,
        synthetic: false,
        status: "ACCEPTED",
        suppliedBy: us3Actor.principalId,
        reviewedBy: us3Actor.principalId,
        reviewedAt: new Date(Date.now() - 2000).toISOString(),
        evidenceRef: "urn:approved:evidence",
        metadata,
      };
      return { ...entry, contentHash: pilotContentHash(entry) };
    });
    const input = {
      schemaVersion: 1,
      id: inputId,
      version: 1,
      profile: "integration",
      scope,
      entries,
    };
    const policyRefs: Record<string, ExactRevisionRef> = {
      inputPackageRef: await publish("INPUT_PACKAGE", input, inputId),
    };
    for (const [key, kind] of Object.entries({
      identityPolicyRef: "IDENTITY_POLICY",
      secretResolverPolicyRef: "SECRET_RESOLVER_POLICY",
      signingPolicyRef: "SIGNING_POLICY",
      telemetryPolicyRef: "TELEMETRY_POLICY",
      artifactPolicyRef: "ARTIFACT_POLICY",
      modelPolicyRef: "MODEL_POLICY",
      recoveryPolicyRef: "RECOVERY_POLICY",
    } as const))
      policyRefs[key] = await publish(kind, { mode: "CORPORATE", dialect: "controlled" });
    const networkBody = {
      mode: "CORPORATE" as const,
      validUntil: new Date(Date.now() + 600_000).toISOString(),
      deadlineMs: 1000,
      maximumRequestBytes: 4096,
      maximumResponseBytes: 4096,
      endpoints: endpoints
        .filter((value) => !["browser", "callback"].includes(value.purpose))
        .map((value) => ({
          origin: value.allowedOrigin,
          addressRanges: ["10.42.0.0/24"],
          routes: [
            {
              path: new URL(value.url).pathname,
              match: "EXACT" as const,
              methods: ["GET"],
              queryKeys: [],
            },
          ],
        })),
    };
    const networkRef = await publish("NETWORK_POLICY", networkBody);
    const policy = parseDeploymentPolicy({
      schemaVersion: 1,
      deploymentId: randomUUID(),
      version: 1,
      deploymentProfile: "integration",
      runtimeProfile: "non-local",
      environmentScope: "NON_PROD",
      compositionKey: "qa-jira-gitlab-mattermost-test",
      ...scope,
      imageDigest: `sha256:${"a".repeat(64)}`,
      artifactMode: "GITLAB_ONLY",
      ...policyRefs,
      networkPolicyRef: networkRef,
      connectorBindings,
      endpoints,
    });
    return { ...f, policy, publications, publish, input, networkBody, networkRef, repository };
  } catch (error) {
    await stopUs3DatabaseFixture(f);
    throw error;
  }
}

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "008 startup with published references",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "loads all Projects, renews real leases and denies a revoked policy on %s",
      async (image) => {
        const f = await fixture(image);
        const runtimes: DeploymentStartup[] = [];
        try {
          const references = new PublishedDeploymentReferences(f.source, f.policy, 1000);
          expect(
            (await references.load(f.policy, new AbortController().signal)).publications,
          ).toHaveLength(12);
          let deploymentRef: ExactRevisionRef | undefined;
          for (const projectId of f.policy.projectIds) {
            const readiness = await f.source.transaction((manager) =>
              references.current(
                manager,
                { workspaceId: f.workspaceId, projectId },
                f.policy.inputPackageRef,
              ),
            );
            expect(readiness.entries).toHaveLength(12);
            expect(readiness.entries.every((value) => value.status === "PASS")).toBe(true);
            const value = {
              schemaVersion: 1 as const,
              kind: "DEPLOYMENT" as const,
              id: f.policy.deploymentId,
              version: 1,
              workspaceId: f.workspaceId,
              projectId,
              actorRef: us3Actor.principalId,
              correlationId: randomUUID(),
              createdAt: new Date().toISOString(),
              body: f.policy,
            };
            await new PilotRepository(f.source).publish(
              { ...value, contentHash: pilotContentHash(value) } as unknown as PilotRecord,
              0,
            );
            if (projectId === f.projectId) deploymentRef = pin(value.id, value);
          }
          for (const component of ["api", "worker"] as const) {
            const runtime = createPublishedDeploymentStartup(f.source, {
              policy: f.policy,
              component,
              instanceId: randomUUID(),
              imageDigest: f.policy.imageDigest,
              leaseMs: 10_000,
              validationDeadlineMs: 1000,
              network: new PinnedNetworkTransport(
                { ...f.networkBody, ref: f.networkRef },
                { resolve: async () => ["10.42.0.1"] },
              ),
              requests: f.policy.endpoints
                .filter((value) => !["browser", "callback"].includes(value.purpose))
                .map((value) => ({ ...value, method: "GET" })),
              browser: {
                origin: "https://web.example.test",
                callbackUrl: "https://web.example.test/api/v1/auth/callback",
                identityPolicyRef: f.policy.identityPolicyRef,
              },
            });
            runtimes.push(runtime);
            await runtime.start();
          }
          const api = runtimes[0]!;
          expect(await api.readiness()).toEqual({ ready: true, reasonCode: "READY" });
          await api.refresh();
          expect(
            await f.source.query(
              "SELECT row_version FROM pilot_runtime_registrations WHERE instance_id=$1",
              [api.instanceId],
            ),
          ).toEqual([{ row_version: "2" }]);
          const scope = { workspaceId: f.workspaceId, projectId: f.projectId };
          const worker = runtimes[1]!;
          const readiness = await new PilotReadinessQuery(f.source, references, {
            isCurrent: async () => false,
          }).readiness(
            { ...scope, authorize: async () => ({ classificationCeiling: "CONFIDENTIAL" }) },
            f.policy.deploymentId,
          );
          expect(readiness.inputs.entries).toHaveLength(12);
          expect(readiness.gateReady).toBe(false);
          expect(readiness.corporateGatesReady).toBe(false);
          const context: PilotEffectContext = {
            principalId: us3Actor.principalId,
            purpose: "SANDBOX_CONFORMANCE",
            deploymentRef: deploymentRef!,
            fenceRef: pin(randomUUID(), {}),
            cohortRef: pin(randomUUID(), {}),
          };
          const fence: PilotFenceSnapshot = {
            ...scope,
            mode: "SANDBOX_CONFORMANCE",
            deploymentRef: deploymentRef!,
            fenceRef: context.fenceRef,
            cohortRef: context.cohortRef,
            projectIds: f.policy.projectIds,
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
          const query = vi.spyOn(f.source, "transaction");
          await expect(
            references.assertCurrent({ ...f.policy, version: 2 }, new AbortController().signal),
          ).rejects.toThrow("DEPLOYMENT_INPUT_UNAVAILABLE");
          await expect(references.assertCurrent(f.policy, AbortSignal.abort())).rejects.toThrow(
            "DEPLOYMENT_INPUT_UNAVAILABLE",
          );
          expect(query).not.toHaveBeenCalled();
          query.mockRestore();
          await f.source.transaction((manager) =>
            f.repository.revoke(
              manager,
              {
                workspaceId: f.workspaceId,
                ref: f.policy.signingPolicyRef,
                actorRef: us3Actor.principalId,
                correlationId: randomUUID(),
              },
              1,
            ),
          );
          await expect(send()).rejects.toThrow("DEPLOYMENT_INPUT_UNAVAILABLE");
          expect(effects).toBe(1);
          expect(await api.readiness()).toEqual({
            ready: false,
            reasonCode: "DEPLOYMENT_INPUT_UNAVAILABLE",
          });
          await expect(api.refresh()).rejects.toThrow("DEPLOYMENT_INPUT_UNAVAILABLE");
          expect(await api.readiness()).toEqual({
            ready: false,
            reasonCode: "DEPLOYMENT_RUNTIME_STOPPED",
          });
        } finally {
          for (const runtime of runtimes) await runtime.stop();
          await stopUs3DatabaseFixture(f);
        }
      },
      120_000,
    );
    it.each(POSTGRES_TEST_IMAGES)(
      "rejects incomplete metadata, provider head drift and bounded locked publications on %s",
      async (image) => {
        const f = await fixture(image);
        try {
          const references = new PublishedDeploymentReferences(f.source, f.policy, 500);
          const signal = () => new AbortController().signal;
          const incompleteId = randomUUID();
          const incompleteRef = await f.publish(
            "INPUT_PACKAGE",
            { ...f.input, id: incompleteId, entries: f.input.entries.slice(0, 5) },
            incompleteId,
          );
          const incompletePolicy = { ...f.policy, inputPackageRef: incompleteRef };
          await expect(
            new PublishedDeploymentReferences(f.source, incompletePolicy).assertCurrent(
              incompletePolicy,
              signal(),
            ),
          ).rejects.toThrow("DEPLOYMENT_INPUT_UNAVAILABLE");
          const selected = f.publications.find((value) => value.kind === "CONNECTOR_BINDING")!;
          const project = (
            selected.document.projects as unknown as { profileRef: ExactRevisionRef }[]
          )[0]!;
          await f.source.query(
            "UPDATE connector_profile_headers SET current_published_version=2 WHERE id=$1",
            [project.profileRef.id],
          );
          await expect(references.assertCurrent(f.policy, signal())).rejects.toThrow(
            "DEPLOYMENT_INPUT_UNAVAILABLE",
          );
          await f.source.query(
            "UPDATE connector_profile_headers SET current_published_version=1 WHERE id=$1",
            [project.profileRef.id],
          );
          const partialId = randomUUID();
          const partialInput = {
            ...f.input,
            id: partialId,
            entries: f.input.entries.map((entry) => {
              const body = Object.fromEntries(
                Object.entries(entry).filter(([key]) => key !== "contentHash"),
              );
              const partial = { ...body, projectIds: [f.projectId] };
              return { ...partial, contentHash: pilotContentHash(partial) };
            }),
          };
          const partialRef = await f.publish("INPUT_PACKAGE", partialInput, partialId);
          const partialPolicy = { ...f.policy, inputPackageRef: partialRef };
          await expect(
            new PublishedDeploymentReferences(f.source, partialPolicy).assertCurrent(
              partialPolicy,
              signal(),
            ),
          ).rejects.toThrow("DEPLOYMENT_INPUT_UNAVAILABLE");
          const badHash = `sha256:${"b".repeat(64)}`;
          await f.source.query(
            "INSERT INTO connector_profile_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,2,'PUBLISHED','{}',$4,now())",
            [randomUUID(), f.workspaceId, project.profileRef.id, badHash],
          );
          await f.source.query(
            "UPDATE connector_profile_headers SET current_published_version=2 WHERE id=$1",
            [project.profileRef.id],
          );
          const projects = selected.document.projects as unknown as {
            profileRef: ExactRevisionRef;
          }[];
          const badRef = await f.publish("CONNECTOR_BINDING", {
            ...selected.document,
            projects: projects.map((entry, index) =>
              index === 0
                ? {
                    ...entry,
                    profileRef: { ...entry.profileRef, version: 2, contentHash: badHash },
                  }
                : entry,
            ),
          });
          const badPolicy = {
            ...f.policy,
            connectorBindings: f.policy.connectorBindings.map((value) =>
              value.ref.id === selected.ref.id ? { ...value, ref: badRef } : value,
            ),
          };
          await expect(
            new PublishedDeploymentReferences(f.source, badPolicy).assertCurrent(
              badPolicy,
              signal(),
            ),
          ).rejects.toThrow("DEPLOYMENT_INPUT_UNAVAILABLE");
          await f.source.query(
            "UPDATE connector_profile_headers SET current_published_version=1 WHERE id=$1",
            [project.profileRef.id],
          );
          const lock = f.source.createQueryRunner();
          await lock.connect();
          await lock.startTransaction();
          try {
            await lock.query(
              "SELECT * FROM runtime_configuration_headers WHERE configuration_id=$1 FOR UPDATE",
              [f.policy.inputPackageRef.id],
            );
            const started = performance.now();
            await expect(references.assertCurrent(f.policy, signal())).rejects.toThrow(
              "DEPLOYMENT_INPUT_UNAVAILABLE",
            );
            expect(performance.now() - started).toBeLessThan(2000);
          } finally {
            await lock.rollbackTransaction();
            await lock.release();
          }
          await references.assertCurrent(f.policy, signal());
        } finally {
          await stopUs3DatabaseFixture(f);
        }
      },
      120_000,
    );
  },
);
