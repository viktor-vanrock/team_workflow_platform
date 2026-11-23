import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { Module } from "../../../apps/api/node_modules/@nestjs/common/index.js";
import { NestFactory } from "../../../apps/api/node_modules/@nestjs/core/index.js";
import type { NestExpressApplication } from "../../../apps/api/node_modules/@nestjs/platform-express/index.js";
import {
  PILOT_EVIDENCE_IMPORT,
  PILOT_READINESS_QUERY,
  PilotController,
} from "../../../apps/api/src/extensions/pilot/pilot.controller.ts";
import {
  QA_DATA_SOURCE,
  QA_HTTP_IDENTITY,
  QaSessionGuard,
} from "../../../apps/api/src/extensions/qa-api-authorization.ts";
import type { PilotGateExecution } from "../../../packages/platform-core/src/index.ts";
import { PilotRepository } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { ProblemDetailsFilter } from "../../../packages/platform-runtime-nest/src/http/problem-details.filter.ts";
import { DurablePilotEvidenceImport } from "../../../packages/runtime-composition/src/pilot/evidence-import.ts";
import { VerifiedPilotGateEvidence } from "../../../packages/runtime-composition/src/pilot/gate-evidence.ts";
import { currentQaCommandAuthority } from "../../../packages/runtime-composition/src/pilot/qa-command-authority.ts";
import { PilotReadinessQuery } from "../../../packages/runtime-composition/src/pilot/readiness-query.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
} from "../../support/002-us3-database.ts";
import { create008SignedReportFixture } from "../../support/008-signed-report.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

@Module({})
class PilotImportProofModule {}
describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "008 authenticated evidence import",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "imports exactly once through HTTP, rolls back audit failure and rechecks trust/current rights on %s",
      async (postgresImage) => {
        const f = await startUs3DatabaseFixture({ postgresImage });
        const signed = create008SignedReportFixture(f);
        let app: NestExpressApplication | undefined;
        let allowed = true;
        let origin = "";
        const runtime = new DurablePilotEvidenceImport(f.source, signed.verifier);
        const boot = async () => {
          app = await NestFactory.create<NestExpressApplication>(
            {
              module: PilotImportProofModule,
              controllers: [PilotController],
              providers: [
                QaSessionGuard,
                { provide: QA_DATA_SOURCE, useValue: f.source },
                { provide: PILOT_EVIDENCE_IMPORT, useValue: runtime },
                {
                  provide: PILOT_READINESS_QUERY,
                  useValue: new PilotReadinessQuery(
                    f.source,
                    {
                      current: async () => {
                        throw new Error("INPUT_NOT_SUPPLIED");
                      },
                    },
                    new VerifiedPilotGateEvidence(signed.verifier),
                  ),
                },
                {
                  provide: QA_HTTP_IDENTITY,
                  useValue: {
                    authenticate: async (context: {
                      switchToHttp(): { getRequest(): { headers: Record<string, string> } };
                    }) => {
                      if (
                        context.switchToHttp().getRequest().headers.authorization !==
                        "Bearer controlled-pilot-import"
                      )
                        throw new Error("UNAUTHENTICATED");
                      return async ({
                        scope,
                        permission,
                      }: {
                        scope: { workspaceId: string; projectId: string };
                        permission: string;
                      }) => {
                        if (!allowed) throw new Error("REVOKED");
                        return currentQaCommandAuthority(
                          f.source,
                          scope,
                          us3Actor,
                          "CONFIDENTIAL",
                        ).authorize(permission);
                      };
                    },
                  },
                },
              ],
            },
            { logger: false, abortOnError: false },
          );
          app.useGlobalFilters(new ProblemDetailsFilter());
          await app.listen(0, "127.0.0.1");
          origin = await app.getUrl();
        };
        const path = `/api/v1/workspaces/${f.workspaceId}/projects/${f.projectId}/pilot/evidence-imports`;
        const call = (body: unknown, target = path) =>
          fetch(`${origin}${target}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer controlled-pilot-import",
              connection: "close",
            },
            body: JSON.stringify(body),
          });
        try {
          await f.source.query(
            "INSERT INTO identities(id,issuer,subject,kind,display_name,row_version,created_at) VALUES($1,'urn:controlled:report-executor','signed-report-executor','SERVICE','Report executor',1,now())",
            [signed.policy.keys[0]!.executorId],
          );
          for (const table of ["role_assignments", "project_entitlements"])
            await f.source.query(
              `UPDATE ${table} SET permissions=permissions || '["pilot.evidence.import","pilot.health.read","pilot.readiness.read"]'::jsonb,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3`,
              [f.workspaceId, f.projectId, us3Actor.principalId],
            );
          await boot();
          const document = signed.publish();
          const input = { executionKey: "engineering", reportRef: document.reportRef };
          expect(
            (
              await fetch(`${origin}${path}`, {
                method: "POST",
                headers: { "content-type": "application/json", connection: "close" },
                body: JSON.stringify(input),
              })
            ).status,
          ).toBe(401);
          expect((await call(input)).status).toBe(403);
          await f.source.query(
            "UPDATE project_entitlements SET classification_ceiling_key='CONFIDENTIAL',row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
            [f.workspaceId, f.projectId, us3Actor.principalId],
          );
          expect((await call(input, path.replace(f.projectId, randomUUID()))).status).toBe(403);
          const read = (suffix: string, projectId = f.projectId) =>
            fetch(
              `${origin}/api/v1/workspaces/${f.workspaceId}/projects/${projectId}/pilot/${suffix}`,
              { headers: { authorization: "Bearer controlled-pilot-import", connection: "close" } },
            );
          const health = await read("health");
          expect(health.status).toBe(200);
          expect(health.headers.get("cache-control")).toBe("private, no-store");
          expect(await health.json()).toMatchObject({
            workspaceId: f.workspaceId,
            projectId: f.projectId,
          });
          expect((await read("health", randomUUID())).status).toBe(403);
          expect((await read(`deployments/${randomUUID()}/readiness`)).status).toBe(404);
          const readEvidence = vi.mocked(signed.store.evidence).getMockImplementation()!;
          vi.mocked(signed.store.evidence).mockImplementationOnce(async (...args) => {
            await f.source.query(
              "UPDATE role_assignments SET revoked_at=now(),row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
              [f.workspaceId, f.projectId, us3Actor.principalId],
            );
            return readEvidence(...args);
          });
          expect((await call(input)).status).toBe(403);
          expect(await f.source.query("SELECT record_id FROM pilot_record_revisions")).toHaveLength(
            0,
          );
          await f.source.query(
            "UPDATE role_assignments SET revoked_at=NULL,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
            [f.workspaceId, f.projectId, us3Actor.principalId],
          );
          signed.policies.current
            .mockResolvedValueOnce(signed.policy)
            .mockResolvedValueOnce(signed.policy)
            .mockResolvedValueOnce({ ...signed.policy, keys: [] });
          expect((await call(input)).status).toBe(409);
          expect(await f.source.query("SELECT record_id FROM pilot_record_revisions")).toHaveLength(
            0,
          );
          await f.source.query(
            "CREATE FUNCTION fail_pilot_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='pilot.evidence.import' THEN RAISE EXCEPTION 'SECRET_IMPORT_FAILURE_CANARY'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_pilot_import BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_pilot_import()",
          );
          const failed = await call(input);
          expect(failed.status).toBe(409);
          expect(await failed.text()).not.toContain("SECRET_IMPORT_FAILURE_CANARY");
          expect(await f.source.query("SELECT record_id FROM pilot_record_revisions")).toHaveLength(
            0,
          );
          await f.source.query("DROP TRIGGER fail_pilot_import ON audit_events");
          const results = await Promise.all([call(input), call(input)]);
          expect(results.map((value) => value.status)).toEqual([201, 201]);
          const values = await Promise.all(
            results.map(
              async (value) =>
                (await value.json()) as {
                  replayed: boolean;
                  execution: { id: string; status: string };
                },
            ),
          );
          expect(values.filter((value) => !value.replayed)).toHaveLength(1);
          expect(values[0]!.execution.status).toBe("PASS");
          expect(await f.source.query("SELECT record_id FROM pilot_record_revisions")).toHaveLength(
            1,
          );
          expect(
            await f.source.query(
              "SELECT id FROM audit_events WHERE action='pilot.evidence.import'",
            ),
          ).toHaveLength(1);
          expect(
            await f.source.query("SELECT gate_result_id FROM project_onboarding_gate_results"),
          ).toHaveLength(0);
          await app!.close();
          await boot();
          expect(await (await call(input)).json()).toMatchObject({ replayed: true });
          allowed = false;
          expect((await call(input)).status).toBe(403);
          allowed = true;
          signed.policies.current.mockResolvedValue({ ...signed.policy, keys: [] });
          expect((await call(input)).status).toBe(409);
          expect(
            await f.source.query(
              "SELECT id FROM audit_events WHERE action='pilot.evidence.import'",
            ),
          ).toHaveLength(1);
          signed.policies.current.mockResolvedValue(signed.policy);
          const inputsReport = signed.publish({ ...signed.report, gate: "inputs" });
          const importedInputs = await call({
            executionKey: "inputs",
            reportRef: inputsReport.reportRef,
          });
          expect(importedInputs.status).toBe(201);
          const { execution } = (await importedInputs.json()) as { execution: PilotGateExecution };
          const repository = new PilotRepository(f.source);
          const gateEvidence = new VerifiedPilotGateEvidence(signed.verifier);
          const gate = await repository.recordOnboardingGate(
            {
              ...signed.scope,
              id: randomUUID(),
              kind: "C1",
              subjectRef: signed.policy.subjectRef,
              evaluatorId: signed.policy.keys[0]!.executorId,
              evaluatedAt: "2026-09-04T09:00:00.000Z",
              executions: [execution],
            },
            signed.verifier,
          );
          expect(gate.outcome).toBe("PASS");
          expect(
            await f.source.transaction((manager) => gateEvidence.isCurrent(manager, gate)),
          ).toBe(true);
          // Opposite row/publication orders must reconstruct exactly the same multi-report gate.
          const compatibility = signed.publish({ ...signed.report, runId: "compatibility-proof" });
          const importedCompatibility = (await (
            await call({ executionKey: "compatibility", reportRef: compatibility.reportRef })
          ).json()) as { execution: PilotGateExecution };
          const engineering = (await (await call(input)).json()) as {
            execution: PilotGateExecution;
          };
          const ordered = [engineering.execution, importedCompatibility.execution].sort((a, b) =>
            b.id.localeCompare(a.id),
          );
          const engineeringGate = await repository.recordOnboardingGate(
            {
              ...signed.scope,
              id: randomUUID(),
              kind: "L0",
              subjectRef: signed.policy.subjectRef,
              evaluatorId: signed.policy.keys[0]!.executorId,
              evaluatedAt: "2026-09-04T09:00:00.000Z",
              executions: ordered,
            },
            signed.verifier,
          );
          expect(engineeringGate.outcome).toBe("PASS");
          expect(
            await f.source.transaction((manager) =>
              gateEvidence.isCurrent(manager, engineeringGate),
            ),
          ).toBe(true);
          const n2 = signed.publish({ ...signed.report, gate: "integration" });
          expect((await call({ executionKey: "N2", reportRef: n2.reportRef })).status).toBe(201);
          vi.mocked(signed.store.evidence).mockResolvedValueOnce(
            Buffer.from("tampered independent evidence"),
          );
          expect(
            await f.source.transaction((manager) => gateEvidence.isCurrent(manager, gate)),
          ).toBe(false);
          signed.policies.current.mockResolvedValue({ ...signed.policy, keys: [] });
          expect(
            await f.source.transaction((manager) => gateEvidence.isCurrent(manager, gate)),
          ).toBe(false);
        } finally {
          await app?.close();
          await stopUs3DatabaseFixture(f);
        }
      },
      120_000,
    );
  },
);
