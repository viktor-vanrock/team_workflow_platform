import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Module } from "../../../apps/api/node_modules/@nestjs/common/index.js";
import { NestFactory } from "../../../apps/api/node_modules/@nestjs/core/index.js";
import { PilotCapabilitiesController } from "../../../apps/mock-hub/src/pilot-capabilities.controller.ts";
import { startPostgres } from "../../../packages/platform-testkit/src/postgres.ts";
import {
  createDevelopmentCapabilityProbeWorker,
  createRuntimeDataSource,
  loadEnvironment,
} from "../../../packages/runtime-composition/src/index.ts";
import { seed008CapabilityPlan } from "../../support/008-capability-plan.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

@Module({ controllers: [PilotCapabilitiesController] })
class EmulatorModule {}
afterEach(() => vi.unstubAllEnvs());
describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "008 developer capability emulator",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "persists HTTP observations, degradation, restart and revoked scope on %s",
      async (image) => {
        const postgres = await startPostgres(image);
        const app = await NestFactory.create(EmulatorModule, { logger: false });
        await app.listen(0, "127.0.0.1");
        const origin = await app.getUrl();
        for (const [key, value] of Object.entries({
          AWP_ENVIRONMENT: "LOCAL",
          AWP_RUNTIME_PROFILE: "local",
          AWP_COMPOSITION: "qa-jira-gitlab-mattermost-local",
          AWP_EXTERNAL_NETWORK_MODE: "deny",
          AWP_DATABASE_URL: postgres.url,
          AWP_MOCK_HUB_URL: origin,
          AWP_PILOT_ADAPTER_MODE: "development",
        }))
          vi.stubEnv(key, value);
        vi.stubEnv("AWP_DEPLOYMENT_CONFIG", undefined);
        vi.stubEnv("AWP_DEPLOYMENT_PROFILE", undefined);
        const environment = loadEnvironment();
        const source = createRuntimeDataSource(environment);
        const scope = { workspaceId: randomUUID(), projectId: randomUUID() };
        const headers = {
          "x-awp-mock-control-key": "local-gitlab-control",
          "content-type": "application/json",
        };
        let now = new Date();
        const clock = () => now.toISOString();
        const state = async () =>
          await (await fetch(`${origin}/mock/pilot/capabilities/state`, { headers })).json();
        try {
          await source.initialize();
          await source.runMigrations({ transaction: "all" });
          await source.query(
            "INSERT INTO workspaces(id,key,name,state) VALUES($1,'dev-probe','Development probes','ACTIVE')",
            [scope.workspaceId],
          );
          await source.query(
            "INSERT INTO projects(id,workspace_id,key,name,state,classification_key,registration_status) VALUES($1,$2,'dev-probe','Development probes','ACTIVE','INTERNAL','ACTIVE')",
            [scope.projectId, scope.workspaceId],
          );
          await seed008CapabilityPlan(source, scope);
          const worker = createDevelopmentCapabilityProbeWorker(source, environment, clock);
          expect(await worker.run()).toMatchObject({ checked: 1, probes: 4 });
          expect(await state()).toMatchObject({ calls: 4, providerEffects: 0 });
          expect(
            await source.query("SELECT DISTINCT status FROM capability_probe_results"),
          ).toEqual([{ status: "AVAILABLE" }]);
          expect(await worker.run()).toMatchObject({ checked: 0 });
          expect(
            (
              await fetch(`${origin}/mock/pilot/capabilities/fault`, {
                method: "POST",
                headers,
                body: JSON.stringify({ status: "DEGRADED" }),
              })
            ).status,
          ).toBe(201);
          now = new Date(now.getTime() + 31_000);
          await source.destroy();
          await source.initialize();
          expect(
            await createDevelopmentCapabilityProbeWorker(source, environment, clock).run(),
          ).toMatchObject({ checked: 1, probes: 4 });
          expect(await state()).toMatchObject({ calls: 8, providerEffects: 0 });
          expect(
            await source.query(
              "SELECT count(*)::int AS count FROM capability_probe_results WHERE status='DEGRADED'",
            ),
          ).toEqual([{ count: 4 }]);
          await source.query("UPDATE projects SET registration_status='ARCHIVED' WHERE id=$1", [
            scope.projectId,
          ]);
          now = new Date(now.getTime() + 31_000);
          await worker.run();
          expect(await state()).toMatchObject({ calls: 8, providerEffects: 0 });
          expect(
            (
              await fetch(`${origin}/mock/pilot/capabilities`, {
                method: "POST",
                headers,
                body: JSON.stringify({ ...scope, environmentScope: "NON_PROD" }),
              })
            ).status,
          ).toBe(403);
          expect((await fetch(`${origin}/mock/pilot/capabilities/state`)).status).toBe(403);
          vi.stubEnv("AWP_PILOT_ADAPTER_MODE", "disabled");
          expect((await fetch(`${origin}/mock/pilot/capabilities/state`, { headers })).status).toBe(
            403,
          );
        } finally {
          await app.close();
          if (source.isInitialized) await source.destroy();
          await postgres.stop();
        }
      },
      120_000,
    );
  },
);
