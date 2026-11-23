import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { NestFactory } from "../../../apps/api/node_modules/@nestjs/core/index.js";
import type { NestExpressApplication } from "../../../apps/api/node_modules/@nestjs/platform-express/index.js";
import { PublishedAutomationAvailabilityModule } from "../../../apps/api/src/extensions/gitlab-automation/published-automation-availability.module.ts";
import type {
  QaApiAuthorization,
  QaHttpIdentity,
} from "../../../apps/api/src/extensions/qa-api-authorization.ts";
import { pilotContentHash } from "../../../packages/platform-core/src/index.ts";
import { ProblemDetailsFilter } from "../../../packages/platform-runtime-nest/src/http/problem-details.filter.ts";
import {
  PublishedQaAutomationAvailability,
  type QaAutomationAvailabilityAuthority,
} from "../../../packages/runtime-composition/src/pilot/automation-availability.ts";
import { currentQaCommandAuthority } from "../../../packages/runtime-composition/src/pilot/qa-command-authority.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
} from "../../support/002-us3-database.ts";
import { seed008AutomationAvailability } from "../../support/008-automation-availability.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "008 published automation availability",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "requires current exact configuration, Core mode, acceptance and all eight observations on %s",
      async (postgresImage) => {
        const f = await startUs3DatabaseFixture({ postgresImage });
        try {
          const seed = await seed008AutomationAvailability(f);
          const { pins } = seed;
          for (const table of ["role_assignments", "project_entitlements"])
            await f.source.query(
              `UPDATE ${table} SET permissions=permissions || '["qa.automation.read"]'::jsonb,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3`,
              [f.workspaceId, f.projectId, us3Actor.principalId],
            );
          const authorize = async () =>
            (await currentQaCommandAuthority(f.source, pins, us3Actor, "INTERNAL").authorize(
              "qa.automation.read",
            )) as QaApiAuthorization;
          const runtime = new PublishedQaAutomationAvailability(f.source, [pins], 3000);
          const current = (authority: QaAutomationAvailabilityAuthority = { authorize }) =>
            runtime.current(pins, authority);
          expect(await current()).toMatchObject({
            capabilityMode: "FULL_QA",
            liveAvailability: "AVAILABLE",
            launchPermitted: true,
          });
          expect(
            await new PublishedQaAutomationAvailability(f.source, [pins]).current(pins, {
              authorize,
            }),
          ).toMatchObject({ launchPermitted: true });
          await expect(
            runtime.current({ ...pins, projectId: randomUUID() }, { authorize }),
          ).rejects.toThrow("QA_AUTOMATION_ACCESS_DENIED");
          await expect(
            current({
              authorize: async () => ({ ...(await authorize()), classificationCeiling: "PUBLIC" }),
            }),
          ).rejects.toThrow("QA_AUTOMATION_ACCESS_DENIED");
          for (const [table, id] of [
            ["connector_profile", pins.roles[0]!.profileRef.id],
            ["connection", pins.roles[0]!.connectionRef.id],
            ["project_integration_binding", pins.bindingRef.id],
          ] as const) {
            await f.source.query(
              `UPDATE ${table}_headers SET current_published_version=2 WHERE id=$1`,
              [id],
            );
            expect((await current()).launchPermitted).toBe(false);
            await f.source.query(
              `UPDATE ${table}_headers SET current_published_version=1 WHERE id=$1`,
              [id],
            );
          }
          for (const [column, value] of [
            ["current_capability_mode", "MANUAL_ONLY"],
            ["current_stage", "SHADOW"],
            ["current_operational_state", "SUSPENDED"],
          ]) {
            await f.source.query(
              `UPDATE project_onboarding_headers SET ${column}=$3 WHERE workspace_id=$1 AND project_id=$2`,
              [f.workspaceId, f.projectId, value],
            );
            expect((await current()).launchPermitted).toBe(false);
            await f.source.query(
              "UPDATE project_onboarding_headers SET current_capability_mode='FULL_QA',current_stage='PILOT_ACTIVE',current_operational_state='ACTIVE' WHERE workspace_id=$1 AND project_id=$2",
              [f.workspaceId, f.projectId],
            );
          }
          await f.source.query(
            "UPDATE qa_project_context_headers_v2 SET current_published_version=NULL WHERE context_id=$1",
            [pins.contextRef.id],
          );
          expect((await current()).launchPermitted).toBe(false);
          await f.source.query(
            "UPDATE qa_project_context_headers_v2 SET current_published_version=1 WHERE context_id=$1",
            [pins.contextRef.id],
          );
          await f.source.query(
            "UPDATE qa_automation_suite_bindings SET current_published_version=NULL,current_published_version_id=NULL WHERE suite_binding_id=$1",
            [pins.suiteBindingId],
          );
          expect((await current()).launchPermitted).toBe(false);
          await f.source.query(
            "UPDATE qa_automation_suite_bindings SET current_published_version=1,current_published_version_id=$2 WHERE suite_binding_id=$1",
            [pins.suiteBindingId, pins.suiteRef.id],
          );
          // A new negative result replaces the older success for every required operation.
          for (let index = 0; index < 8; index++) {
            await seed.appendProbe(index, {
              status: "UNAVAILABLE",
              safeIssueCodes: ["PRIVATE_PROVIDER_CANARY"],
            });
            const result = await current();
            expect(result).toMatchObject({
              capabilityMode: "FULL_QA",
              liveAvailability: "UNAVAILABLE",
              launchPermitted: false,
            });
            expect(JSON.stringify(result)).not.toContain("PRIVATE_PROVIDER_CANARY");
            await seed.appendProbe(index, {});
            expect((await current()).launchPermitted).toBe(true);
          }
          const refreshed = await seed008AutomationAvailability(f);
          const fresh = new PublishedQaAutomationAvailability(f.source, [refreshed.pins], 3000);
          expect((await fresh.current(refreshed.pins, { authorize })).launchPermitted).toBe(true);
          await refreshed.appendProbe(0, {
            validUntil: new Date(Date.now() - 1).toISOString(),
            observedAt: new Date(Date.now() - 2000).toISOString(),
          });
          // This is older than the success and must not replace it; a newer expired observation must replace it.
          await refreshed.appendProbe(0, {
            validUntil: new Date(Date.now() - 1).toISOString(),
            observedAt: new Date(Date.now() - 2).toISOString(),
          });
          expect((await fresh.current(refreshed.pins, { authorize })).launchPermitted).toBe(false);
          const revocation = await seed008AutomationAvailability(f);
          let calls = 0;
          const changing = new PublishedQaAutomationAvailability(f.source, [revocation.pins], 3000);
          const changed = await changing.current(revocation.pins, {
            authorize: async () => {
              const result = await authorize();
              if (++calls === 2) await revocation.rejectAcceptance();
              return result;
            },
          });
          expect(changed.launchPermitted).toBe(false);
          const altered = await seed008AutomationAvailability(f, { corruptProfileHash: true });
          expect(
            (
              await new PublishedQaAutomationAvailability(f.source, [altered.pins], 3000).current(
                altered.pins,
                { authorize },
              )
            ).launchPermitted,
          ).toBe(false);
          const missing = await seed008AutomationAvailability(f, { omittedProbe: 7 });
          expect(
            await new PublishedQaAutomationAvailability(f.source, [missing.pins], 3000).current(
              missing.pins,
              { authorize },
            ),
          ).toMatchObject({
            capabilityMode: "FULL_QA",
            liveAvailability: "UNAVAILABLE",
            launchPermitted: false,
          });
          const suite = await seed008AutomationAvailability(f);
          const reportBody = {
            ...Object.fromEntries(
              Object.entries(suite.report).filter(([key]) => key !== "contentHash"),
            ),
            id: randomUUID(),
            status: "INVALID",
            checks: suite.report.checks.map((check, index) => ({ ...check, passed: index !== 0 })),
            issues: [{ code: "VALIDATION_REVOKED", path: "/" }],
            createdAt: new Date().toISOString(),
          };
          await f.source.query(
            `INSERT INTO qa_automation_suite_validation_reports SELECT (jsonb_populate_record(NULL::qa_automation_suite_validation_reports,to_jsonb(r)||$2::jsonb)).* FROM qa_automation_suite_validation_reports r WHERE report_id=$1`,
            [
              suite.report.id,
              JSON.stringify({
                report_id: reportBody.id,
                status: reportBody.status,
                checks: reportBody.checks,
                issues: reportBody.issues,
                created_at: reportBody.createdAt,
                content_hash: pilotContentHash(reportBody),
              }),
            ],
          );
          expect(
            (
              await new PublishedQaAutomationAvailability(f.source, [suite.pins], 3000).current(
                suite.pins,
                { authorize },
              )
            ).launchPermitted,
          ).toBe(false);
          const binding = await seed008AutomationAvailability(f);
          await f.source.query(
            "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,'BINDING',$4,1,'INVALID',$5,'{}',now())",
            [
              randomUUID(),
              f.workspaceId,
              f.projectId,
              binding.pins.bindingRef.id,
              binding.pins.bindingRef.contentHash,
            ],
          );
          expect(
            (
              await new PublishedQaAutomationAvailability(f.source, [binding.pins], 3000).current(
                binding.pins,
                { authorize },
              )
            ).launchPermitted,
          ).toBe(false);
          const last = await seed008AutomationAvailability(f);
          const locked = f.source.createQueryRunner();
          await locked.connect();
          await locked.startTransaction();
          try {
            await locked.query("LOCK TABLE capability_probe_results IN ACCESS EXCLUSIVE MODE");
            const started = performance.now();
            expect(
              (
                await new PublishedQaAutomationAvailability(f.source, [last.pins], 500).current(
                  last.pins,
                  { authorize },
                )
              ).launchPermitted,
            ).toBe(false);
            expect(performance.now() - started).toBeLessThan(1800);
          } finally {
            await locked.rollbackTransaction();
            await locked.release();
          }
        } finally {
          await stopUs3DatabaseFixture(f);
        }
      },
      120_000,
    );

    it.each(POSTGRES_TEST_IMAGES)(
      "serves the published API module with live Core authorization and no-store on %s",
      async (postgresImage) => {
        const f = await startUs3DatabaseFixture({ postgresImage });
        let app: NestExpressApplication | undefined;
        try {
          const { pins } = await seed008AutomationAvailability(f);
          for (const table of ["role_assignments", "project_entitlements"])
            await f.source.query(
              `UPDATE ${table} SET permissions=permissions || '["qa.automation.read"]'::jsonb,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3`,
              [f.workspaceId, f.projectId, us3Actor.principalId],
            );
          let revokeOnCall = 0;
          let calls = 0;
          const identity: QaHttpIdentity = {
            authenticate: async (context) => {
              const request = context
                .switchToHttp()
                .getRequest<{ headers: Record<string, string> }>();
              if (request.headers.authorization !== "Bearer controlled-availability")
                throw new Error("PRIVATE_IDENTITY_CANARY");
              return async ({ scope, permission }) => {
                expect(permission).toBe("qa.automation.read");
                if (++calls === revokeOnCall)
                  await f.source.query(
                    "UPDATE project_entitlements SET revoked_at=now(),row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
                    [f.workspaceId, f.projectId, us3Actor.principalId],
                  );
                return (await currentQaCommandAuthority(
                  f.source,
                  scope,
                  us3Actor,
                  "INTERNAL",
                ).authorize(permission)) as QaApiAuthorization;
              };
            },
          };
          app = await NestFactory.create<NestExpressApplication>(
            PublishedAutomationAvailabilityModule.register({
              source: f.source,
              identity,
              pins: [pins],
              deadlineMs: 3000,
            }),
            { logger: false, abortOnError: false },
          );
          app.useGlobalFilters(new ProblemDetailsFilter());
          await app.listen(0, "127.0.0.1");
          const origin = await app.getUrl();
          const path = `/api/v1/workspaces/${f.workspaceId}/projects/${f.projectId}/qa/automation/availability`;
          const read = (target = path) =>
            fetch(`${origin}${target}`, {
              headers: { authorization: "Bearer controlled-availability", connection: "close" },
            });
          const unauthenticated = await fetch(`${origin}${path}`);
          expect(unauthenticated.status).toBe(401);
          expect(await unauthenticated.text()).not.toContain("PRIVATE_IDENTITY_CANARY");
          const response = await read();
          expect(response.status).toBe(200);
          expect(response.headers.get("cache-control")).toBe("no-store");
          expect(await response.json()).toMatchObject({
            capabilityMode: "FULL_QA",
            launchPermitted: true,
          });
          expect((await read(path.replace(f.projectId, randomUUID()))).status).toBe(403);
          calls = 0;
          revokeOnCall = 3;
          const revoked = await read();
          expect(revoked.status).toBe(403);
          expect(revoked.headers.get("cache-control")).toBe("no-store");
          expect(await revoked.text()).not.toContain("PRIVATE_");
        } finally {
          await app?.close();
          await stopUs3DatabaseFixture(f);
        }
      },
      120_000,
    );
  },
);
