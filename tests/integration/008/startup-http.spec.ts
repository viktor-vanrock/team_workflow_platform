import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { Module } from "../../../apps/api/node_modules/@nestjs/common/index.js";
import { NestFactory } from "../../../apps/api/node_modules/@nestjs/core/index.js";
import { HealthController as ApiHealth } from "../../../apps/api/src/health.controller.ts";
import { bootstrapApi } from "../../../apps/api/src/main.ts";
import { HealthController as WorkerHealth } from "../../../apps/worker/src/health.controller.ts";
import { bootstrapWorker } from "../../../apps/worker/src/main.ts";
import { InstrumentedRuntimeModule } from "../../../packages/platform-runtime-nest/src/observability/runtime-module.ts";

@Module({})
class StartupHealthModule {}
describe("008 actual startup readiness HTTP", () => {
  it.each([
    { name: "API", controller: ApiHealth },
    { name: "worker", controller: WorkerHealth },
  ])(
    "keeps liveness separate and requires a composed current deployment for $name",
    async ({ controller }) => {
      let ready = false;
      let started = 0;
      let stopped = 0;
      const runtime = {
        readiness: async () => ({ ready, reasonCode: ready ? "READY" : "DEPLOYMENT_PEER_MISSING" }),
        keepAlive: () => {
          started++;
        },
        stop: async () => {
          stopped++;
        },
      };
      const app = await NestFactory.create(
        InstrumentedRuntimeModule.compose(
          { module: StartupHealthModule, controllers: [controller] },
          undefined,
          runtime,
        ),
        { logger: false, abortOnError: false },
      );
      try {
        await app.listen(0, "127.0.0.1");
        const origin = await app.getUrl();
        expect((await fetch(`${origin}/health/live`)).status).toBe(200);
        expect((await fetch(`${origin}/health/ready`)).status).toBe(503);
        ready = true;
        expect((await fetch(`${origin}/health/ready`)).status).toBe(200);
        ready = false;
        expect((await fetch(`${origin}/health/ready`)).status).toBe(503);
        expect(started).toBe(1);
      } finally {
        await app.close();
      }
      expect(stopped).toBe(1);
      const missing = await NestFactory.create(
        { module: StartupHealthModule, controllers: [controller] },
        { logger: false, abortOnError: false },
      );
      try {
        await missing.listen(0, "127.0.0.1");
        const result = await fetch(`${await missing.getUrl()}/health/ready`);
        expect(result.status).toBe(503);
        expect(await result.text()).toContain("DEPLOYMENT_STARTUP_REQUIRED");
      } finally {
        await missing.close();
      }
    },
  );
  it.each([
    { name: "API", bootstrap: bootstrapApi },
    { name: "worker", bootstrap: bootstrapWorker },
  ])(
    "rejects the Core-only non-local fallback before $name initialization",
    async ({ bootstrap }) => {
      const ref = { id: "approved-policy", version: 1, contentHash: `sha256:${"a".repeat(64)}` };
      const configuration = {
        schemaVersion: 1,
        deploymentId: randomUUID(),
        version: 1,
        deploymentProfile: "integration",
        runtimeProfile: "non-local",
        environmentScope: "NON_PROD",
        compositionKey: "qa-jira-gitlab-mattermost-test",
        workspaceId: randomUUID(),
        projectIds: [randomUUID()],
        imageDigest: ref.contentHash,
        artifactMode: "GITLAB_ONLY",
        ...Object.fromEntries(
          [
            "inputPackageRef",
            "identityPolicyRef",
            "secretResolverPolicyRef",
            "signingPolicyRef",
            "telemetryPolicyRef",
            "networkPolicyRef",
            "artifactPolicyRef",
            "modelPolicyRef",
            "recoveryPolicyRef",
          ].map((key) => [key, ref]),
        ),
        connectorBindings: ["jira", "gitlab", "mattermost"].map((provider) => ({ provider, ref })),
        endpoints: [
          {
            purpose: "identity",
            url: "https://identity.example.test/oidc",
            allowedOrigin: "https://identity.example.test",
          },
        ],
      };
      const environment = {
        AWP_ENVIRONMENT: "NON_PROD",
        AWP_RUNTIME_PROFILE: "non-local",
        AWP_COMPOSITION: configuration.compositionKey,
        AWP_DEPLOYMENT_PROFILE: "integration",
        AWP_DEPLOYMENT_CONFIG: JSON.stringify(configuration),
        AWP_DATABASE_URL: "postgresql://service@database.example.test/awp?sslmode=verify-full",
        AWP_IDENTITY_ISSUER: "https://identity.example.test/oidc",
        AWP_IDENTITY_AUDIENCE: "awp",
        AWP_EXTERNAL_NETWORK_MODE: "allowlisted",
        AWP_MOCK_HUB_URL: undefined,
      };
      try {
        for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
        await expect(bootstrap()).rejects.toThrow("CORPORATE_COMPOSITION_REQUIRED");
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
});
