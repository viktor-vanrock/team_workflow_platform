import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { bootstrapApi } from "../../../apps/api/src/main.ts";
import {
  DurableWorkerLoops,
  type NamedWorkerLoopContribution,
  WORKER_CONTRIBUTIONS,
} from "../../../apps/worker/src/app.module.ts";
import { bootstrapWorker } from "../../../apps/worker/src/main.ts";
import { startPostgres } from "../../../packages/platform-testkit/src/postgres.ts";
import { migrateLocalDatabase } from "../../../packages/runtime-composition/src/bootstrap/local-bootstrap.ts";
import {
  type CorporateConnectorBinding,
  type CorporateConnectorFactoryOptions,
  createPilotDevelopmentComposition,
  createRuntimeDataSource,
  ensurePilotDevelopmentProjects,
  loadEnvironment,
  PinnedNetworkTransport,
  runQaJiraGitLabMattermostQueueLocalSeed,
  VaultHttpClient,
} from "../../../packages/runtime-composition/src/index.ts";
import type { VaultSecretMapping } from "../../../packages/runtime-composition/src/security/vault-secret-resolver.ts";
import {
  startPublishedRuntimeFixture008,
  stopPublishedRuntimeFixture008,
} from "../../support/008-published-runtime-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});
describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "008 full developer API/worker entry points",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "migrates, seeds and boots every runtime contribution on %s",
      async (postgresImage) => {
        const postgres = await startPostgres(postgresImage);
        const http = createServer((_request, response) => {
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({ status: "UP", version: "18.3.0", revision: "controlled-dev" }),
          );
        });
        http.listen(0, "127.0.0.1");
        await once(http, "listening");
        const origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
        let api: Awaited<ReturnType<typeof bootstrapApi>> | undefined;
        let worker: Awaited<ReturnType<typeof bootstrapWorker>> | undefined;
        for (const [key, value] of Object.entries({
          AWP_ENVIRONMENT: "LOCAL",
          AWP_RUNTIME_PROFILE: "local",
          AWP_COMPOSITION: "qa-jira-gitlab-mattermost-local",
          AWP_EXTERNAL_NETWORK_MODE: "deny",
          AWP_DATABASE_URL: postgres.url,
          AWP_MOCK_HUB_URL: origin,
          AWP_IDENTITY_ISSUER: "https://fake-idp:4443/oidc",
          AWP_IDENTITY_AUDIENCE: "awp-local",
          AWP_QUEUE_STATIC_CONTOUR: "true",
          AWP_ONBOARDING_STATIC_CONTOUR: "true",
          AWP_EVIDENCE_SIGNER: "local-ed25519",
          AWP_PILOT_ADAPTER_MODE: "development",
          PORT: "0",
          WORKER_HEALTH_PORT: "0",
        }))
          vi.stubEnv(key, value);
        vi.stubEnv("AWP_DEPLOYMENT_CONFIG", undefined);
        vi.stubEnv("AWP_DEPLOYMENT_PROFILE", undefined);
        const environment = loadEnvironment();
        const composition = createPilotDevelopmentComposition(environment);
        const source = createRuntimeDataSource(environment);
        try {
          await migrateLocalDatabase(source, {
            profile: "local",
            expectedVersions: composition.expectedVersions,
          });
          expect(composition.expectedVersions).toMatchObject({
            core: 220,
            "pack:qa": 2110,
            "connector:gitlab": 4020,
          });
          await runQaJiraGitLabMattermostQueueLocalSeed(source, environment);
          await ensurePilotDevelopmentProjects(source, environment);
          await ensurePilotDevelopmentProjects(source, environment);
          expect(
            await source.query("SELECT count(*)::int AS count FROM project_onboarding_headers"),
          ).toEqual([{ count: 4 }]);
          expect(
            await source.query(
              "SELECT current_operational_state AS state FROM project_onboarding_headers WHERE project_id='20000000-0000-4000-8000-000000000003'",
            ),
          ).toEqual([{ state: "SUSPENDED" }]);
          api = await bootstrapApi();
          worker = await bootstrapWorker();
          const contributions =
            worker.get<readonly NamedWorkerLoopContribution[]>(WORKER_CONTRIBUTIONS);
          expect(contributions.map((value) => value.key)).toEqual(
            expect.arrayContaining([...composition.workerKeys]),
          );
          expect(contributions.some((value) => value.key === "noop")).toBe(false);
          await worker.get(DurableWorkerLoops).tick();
          for (const app of [api, worker]) {
            const result = await fetch(`${await app.getUrl()}/health/ready`);
            expect(result.status).toBe(200);
            expect(await result.json()).toMatchObject({ status: "UP" });
          }
          const route = `/api/v1/workspaces/10000000-0000-4000-8000-000000000001/projects/20000000-0000-4000-8000-000000000001/qa/automation/availability`;
          expect((await fetch(`${await api.getUrl()}${route}`)).status).toBe(401);
          await source.query(
            "UPDATE platform_schema_versions SET version=160 WHERE namespace='core'",
          );
          const down = await fetch(`${await api.getUrl()}/health/ready`);
          expect(down.status).toBe(503);
          expect(await down.json()).toMatchObject({
            status: "DOWN",
            dependencies: { schema: { state: "DOWN" } },
          });
        } finally {
          await worker?.close();
          await api?.close();
          if (source.isInitialized) await source.destroy();
          http.closeAllConnections();
          await new Promise<void>((resolve) => {
            http.close(() => resolve());
          });
          await postgres.stop();
        }
      },
      120_000,
    );
  },
);

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "008 full non-local API/worker entry points",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "boots the exact corporate composition without Core/no-op/persona fallback on %s",
      async (postgresImage) => {
        const fixture = await startPublishedRuntimeFixture008(postgresImage);
        let api: Awaited<ReturnType<typeof bootstrapApi>> | undefined;
        let worker: Awaited<ReturnType<typeof bootstrapWorker>> | undefined;
        let apiSource: ReturnType<typeof createRuntimeDataSource> | undefined;
        let workerSource: ReturnType<typeof createRuntimeDataSource> | undefined;
        const environmentVariables = {
          NODE_ENV: "test",
          AWP_PILOT_ADAPTER_MODE: "controlled-sandbox",
          AWP_ENVIRONMENT: "NON_PROD",
          AWP_RUNTIME_PROFILE: "non-local",
          AWP_COMPOSITION: fixture.policy.compositionKey,
          AWP_DEPLOYMENT_PROFILE: "integration",
          AWP_DEPLOYMENT_CONFIG: JSON.stringify(fixture.policy),
          AWP_DATABASE_URL: (fixture.source.options as { url: string }).url,
          AWP_IDENTITY_ISSUER: "https://identity.example.test/oidc",
          AWP_IDENTITY_AUDIENCE: "awp",
          AWP_EXTERNAL_NETWORK_MODE: "allowlisted",
          AWP_WEB_ORIGIN: "https://web.example.test",
          PORT: "0",
          WORKER_HEALTH_PORT: "0",
        };
        for (const [key, value] of Object.entries(environmentVariables)) vi.stubEnv(key, value);
        vi.stubEnv("AWP_MOCK_HUB_URL", undefined);
        const environment = loadEnvironment();
        const network = new PinnedNetworkTransport(
          { ...fixture.networkBody, ref: fixture.networkRef },
          { resolve: async () => ["10.42.0.1"] },
        );
        const servicePrincipalId = randomUUID();
        const mapping = (
          binding: CorporateConnectorBinding,
          purpose: VaultSecretMapping["use"]["purpose"],
        ): VaultSecretMapping => ({
          ref: { id: randomUUID(), version: 1, contentHash: `sha256:${"b".repeat(64)}` },
          secretRef:
            binding.provider === "GITLAB"
              ? `secretref://gitlab/${purpose.toLowerCase()}`
              : `secret-ref:${binding.provider.toLowerCase()}/${purpose.toLowerCase()}`,
          use: {
            workspaceId: binding.workspaceId,
            projectId: binding.projectId,
            servicePrincipalId: binding.servicePrincipalId,
            purpose,
            profileRef: binding.profileRef,
            connectionRef: binding.connectionRef,
            policyRef: binding.policyRef,
          },
          mount: "secret",
          path: `pilot/${binding.provider.toLowerCase()}/${purpose.toLowerCase()}`,
          field: "credential",
          secretVersion: 1,
          maximumLeaseMs: 1000,
        });
        const vault = new VaultHttpClient({
          baseUrl: "https://vault.example.test",
          namespace: "pilot/",
          mode: "CORPORATE",
          deadlineMs: 1000,
          maximumResponseBytes: 4096,
          network,
          authorizeEndpoint: async (request, signal) =>
            network.authorizeEndpoint(request.url, request.method, signal),
          credentials: {
            withToken: async (_use, _signal, consume) =>
              consume("controlled-workload-token", Date.now() + 5000),
          },
        });
        const connectorBindings = fixture.providerProjects.map((project) => {
          const provider = project.provider.toUpperCase() as CorporateConnectorBinding["provider"];
          const binding: CorporateConnectorBinding = {
            workspaceId: fixture.workspaceId,
            projectId: fixture.projectId,
            servicePrincipalId,
            provider,
            ref: project.integrationBindingRef,
            profileRef: project.profileRef,
            connectionRef: project.connectionRef,
            policyRef: fixture.policy.secretResolverPolicyRef,
            mode: "CORPORATE",
            endpoint: project.endpoint,
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
            ...(provider === "GITLAB"
              ? {
                  gitlab: {
                    numericProjectId: 42,
                    trigger: { dialect: "TYPED_INPUTS", ref: "qa", pipelineNameInput: "awp_name" },
                  },
                }
              : {}),
            routes: [
              { method: "GET", path: "/", match: "EXACT", purpose: "CONNECTOR_READ" },
              { method: "POST", path: "/", match: "EXACT", purpose: "CONNECTOR_WRITE" },
            ],
          };
          const purposes =
            provider === "GITLAB"
              ? (["CONNECTOR_READ", "CONNECTOR_WRITE", "CONNECTOR_WEBHOOK"] as const)
              : (["CONNECTOR_READ", "CONNECTOR_WRITE"] as const);
          return {
            binding,
            credentials: purposes.map((purpose) => ({
              mapping: mapping(binding, purpose),
              authentication:
                provider === "GITLAB"
                  ? purpose === "CONNECTOR_READ"
                    ? ("GITLAB_PRIVATE_TOKEN" as const)
                    : purpose === "CONNECTOR_WRITE"
                      ? ("GITLAB_TRIGGER_TOKEN" as const)
                      : ("STANDARD_WEBHOOK_HMAC" as const)
                  : ("BEARER" as const),
            })),
          };
        });
        const connectorFactories: CorporateConnectorFactoryOptions = {
          network,
          vault,
          authority: { authorize: async () => true },
          secretAuthorization: { authorize: async () => true, isCurrent: () => true },
          bindings: connectorBindings,
        };
        const startup = (instanceId: string) => ({
          instanceId,
          imageDigest: fixture.policy.imageDigest,
          leaseMs: 10_000,
          validationDeadlineMs: 1000,
          network,
          requests: fixture.policy.endpoints
            .filter((value) => !["browser", "callback"].includes(value.purpose))
            .map((value) => ({ purpose: value.purpose, url: value.url, method: "GET" })),
          browser: {
            origin: "https://web.example.test",
            callbackUrl: "https://web.example.test/api/v1/auth/callback",
            identityPolicyRef: fixture.policy.identityPolicyRef,
          },
        });
        const telemetry = () => ({
          health: () => ({ ready: true as const, reasonCode: "READY" as const }),
          flush: async () => undefined,
          shutdown: async () => undefined,
        });
        try {
          apiSource = createRuntimeDataSource(environment);
          workerSource = createRuntimeDataSource(environment);
          await apiSource.initialize();
          await workerSource.initialize();
          const identity = {
            authenticate: async () => {
              throw new Error("CONTROLLED_IDENTITY_NOT_AUTHENTICATED");
            },
          };
          api = await bootstrapApi(telemetry(), {
            source: apiSource,
            composition: { startup: startup(randomUUID()), connectorFactories },
            api: {
              identity,
              evidenceImport: {
                import: async () => {
                  throw new Error("CONTROLLED_IMPORT_DISABLED");
                },
              } as never,
              readinessQuery: { health: async () => ({}), readiness: async () => ({}) } as never,
            },
          });
          let ticks = 0;
          const contributions = [
            "qa-jira",
            "mattermost",
            "queue.foundation",
            "artifact-retention",
            "project-onboarding-events",
            "project-onboarding-probes",
            "project-suspension-recovery",
            "gitlab.automation-trigger",
            "gitlab.webhook-reconciliation",
            "gitlab.automation-events",
          ].map((key) => {
            const step = {
              run: async () => {
                ticks++;
                await workerSource!.query("SELECT 1");
              },
            };
            return { key, recovery: step, dispatcher: step, commands: step };
          });
          worker = await bootstrapWorker(telemetry(), {
            source: workerSource,
            composition: { startup: startup(randomUUID()), connectorFactories },
            contributions,
          });
          const apiOrigin = await api.getUrl();
          const workerOrigin = await worker.getUrl();
          expect((await fetch(`${apiOrigin}/health/ready`)).status).toBe(200);
          expect((await fetch(`${workerOrigin}/health/ready`)).status).toBe(200);
          expect((await fetch(`${apiOrigin}/local/personas`)).status).toBe(404);
          const installed =
            worker.get<readonly NamedWorkerLoopContribution[]>(WORKER_CONTRIBUTIONS);
          expect(installed.map((value) => value.key)).toEqual(
            contributions.map((value) => value.key),
          );
          expect(installed.some((value) => value.key === "noop")).toBe(false);
          await worker.get(DurableWorkerLoops).tick();
          expect(ticks).toBeGreaterThanOrEqual(contributions.length * 3);
        } finally {
          await worker?.close();
          await api?.close();
          if (workerSource?.isInitialized) await workerSource.destroy();
          if (apiSource?.isInitialized) await apiSource.destroy();
          await stopPublishedRuntimeFixture008(fixture);
        }
      },
      120_000,
    );
  },
);
