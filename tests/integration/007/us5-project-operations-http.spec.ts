import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  Module,
  UnauthorizedException,
} from "../../../apps/api/node_modules/@nestjs/common/index.js";
import { NestFactory } from "../../../apps/api/node_modules/@nestjs/core/index.js";
import type { NestExpressApplication } from "../../../apps/api/node_modules/@nestjs/platform-express/index.js";
import {
  DurableProjectOperationsApplication,
  PROJECT_OPERATIONS_HTTP_APPLICATION,
} from "../../../apps/api/src/extensions/onboarding/project-operations.application.ts";
import { ProjectOperationsController } from "../../../apps/api/src/extensions/onboarding/project-operations.controller.ts";
import {
  QA_DATA_SOURCE,
  QA_HTTP_IDENTITY,
  type QaHttpIdentity,
  QaSessionGuard,
} from "../../../apps/api/src/extensions/qa-api-authorization.ts";
import { authorizeLocalQaApi } from "../../../apps/api/src/local/local-qa-authorization.ts";
import {
  createExactApproval,
  decideApproval,
  InMemoryDurableCommandStore,
} from "../../../packages/platform-core/src/index.ts";
import {
  TypeOrmApprovalRepository,
  TypeOrmCommandOutboxRepository,
  TypeOrmCommandRepository,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { ProjectBindingRepository } from "../../../packages/platform-persistence-typeorm/src/project-binding.repository.ts";
import { createSafeCapabilityProbe } from "../../../packages/runtime-composition/src/onboarding/capability-probes.ts";
import { TypeOrmProjectEffectGuard } from "../../../packages/runtime-composition/src/onboarding/project-effect-guard.ts";
import { startProjectOperationsFixture } from "../../support/007-project-operations-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

@Module({})
class OperationsProofModule {}
describe("007 project operations HTTP authority", () => {
  it("rejects unauthenticated suspend before accepting client incident data", async () => {
    const app = await NestFactory.create<NestExpressApplication>(
      {
        module: OperationsProofModule,
        controllers: [ProjectOperationsController],
        providers: [
          QaSessionGuard,
          { provide: QA_DATA_SOURCE, useValue: {} },
          {
            provide: QA_HTTP_IDENTITY,
            useValue: {
              authenticate: () => {
                throw new UnauthorizedException();
              },
            },
          },
          { provide: "PROJECT_OPERATIONS_HTTP_APPLICATION", useValue: {} },
        ],
      },
      { logger: false, abortOnError: false },
    );
    try {
      await app.listen(0, "127.0.0.1");
      const response = await fetch(
        `${await app.getUrl()}/v1/workspaces/10000000-0000-4000-8000-000000000001/projects/20000000-0000-4000-8000-000000000001/operations/suspend`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "if-match": '"1"',
            "idempotency-key": "unauthenticated-command",
          },
          body: JSON.stringify({
            incidentRef: "INC-UNTRUSTED",
            reason: "must not change a project",
          }),
        },
      );
      expect(response.status).toBe(401);
    } finally {
      await app.close();
    }
  });
});

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "007 durable suspend/resume HTTP",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "requires current distinct approval and preserves exact receipts on %s",
      async (image) => {
        const errors: string[] = [];
        const f = await startProjectOperationsFixture(image);
        let app: NestExpressApplication | undefined,
          origin = "";
        const identity: QaHttpIdentity = {
          authenticate: async (context) => {
            const token = context
              .switchToHttp()
              .getRequest<{ headers: { authorization?: string } }>().headers.authorization;
            const persona =
              token === "Bearer owner"
                ? "owner.local"
                : token === "Bearer admin" || token === "Bearer no-mfa"
                  ? "integration-admin.alpha"
                  : undefined;
            if (!persona) throw new UnauthorizedException();
            return async ({ scope, permission }) => ({
              ...(await authorizeLocalQaApi(
                f.source,
                { headers: {}, localPersonaKey: persona },
                scope.workspaceId,
                scope.projectId,
                permission,
              )),
              authentication: {
                contextRef: `verified:${persona}`,
                verifiedAt: new Date().toISOString(),
                ...(token !== "Bearer no-mfa" ? { stepUpAt: new Date().toISOString() } : {}),
              },
            });
          },
        };
        const boot = async () => {
          const application = new DurableProjectOperationsApplication(f.source);
          const suspend = application.suspend.bind(application);
          application.suspend = async (...args) => {
            try {
              return await suspend(...args);
            } catch (error) {
              errors.push(error instanceof Error ? error.message : String(error));
              throw error;
            }
          };
          app = await NestFactory.create<NestExpressApplication>(
            {
              module: OperationsProofModule,
              controllers: [ProjectOperationsController],
              providers: [
                QaSessionGuard,
                { provide: QA_DATA_SOURCE, useValue: f.source },
                { provide: QA_HTTP_IDENTITY, useValue: identity },
                { provide: PROJECT_OPERATIONS_HTTP_APPLICATION, useValue: application },
              ],
            },
            { logger: false, abortOnError: false },
          );
          await app.listen(0, "127.0.0.1");
          origin = await app.getUrl();
        };
        const send = async (
          path: string,
          body: unknown,
          key: string,
          version = 1,
          token = "admin",
          match = `"${version}"`,
        ) => {
          const response = await fetch(
            `${origin}/v1/workspaces/${f.scope.workspaceId}/projects/${f.scope.projectId}/operations/${path}`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
                "if-match": match,
                "idempotency-key": key,
              },
              body: JSON.stringify(body),
            },
          );
          return { status: response.status, body: await response.json() };
        };
        const guard = new TypeOrmProjectEffectGuard(f.source);
        try {
          await boot();
          await expect(guard.assertEffectsAllowed(f.scope)).resolves.toMatchObject({
            onboardingVersion: 1,
          });
          const sample = InMemoryDurableCommandStore.readyFixture().command();
          const pending = {
            ...sample,
            ...f.scope,
            id: randomUUID(),
            correlationId: randomUUID(),
            causationId: randomUUID(),
            bindingRef: f.bindingRef,
            profileRef: f.profileRef,
            actor: {
              kind: "HUMAN" as const,
              principalId: f.initial.actor.principalId,
              issuer: "fixture",
              subject: f.initial.actor.principalId,
            },
            status: "QUEUED" as const,
            outboxStatus: "READY" as const,
            effectIdempotencyKey: randomUUID(),
          };
          const commands = new TypeOrmCommandRepository(f.source);
          const rawApproval = createExactApproval({
            id: randomUUID(),
            ...f.scope,
            initiatorId: pending.actor.principalId,
            initiator: pending.actor,
            action: {
              actionKind: "EXTERNAL_COMMAND",
              actionId: pending.id,
              commandType: pending.commandType,
              capabilityKey: pending.capability.key,
              capabilityVersion: pending.capability.exactContractVersion,
              operation: pending.capability.operation,
            },
            target: pending.target,
            targetHash: pending.targetHash,
            payloadHash: pending.payloadHash,
            expectedState: pending.expectedExternalState,
            bindingRef: pending.bindingRef,
            profileRefs: [pending.profileRef],
            requiredPermission: "record.publish",
            separationOfDutyPolicy: "SELF_APPROVAL_FORBIDDEN",
            effectIdempotencyKey: pending.effectIdempotencyKey,
            expiresAt: new Date(Date.now() + 300_000),
            createdAt: new Date(),
          });
          const [owner] = (await f.source.query(
            "SELECT id FROM identities WHERE id<>$1 ORDER BY id LIMIT 1",
            [pending.actor.principalId],
          )) as { id: string }[];
          const consumedApproval = {
            ...decideApproval(rawApproval, {
              approverId: owner!.id,
              approverRole: "Operator",
              authorizationBasisHash: pending.initialAuthorizationBasisHash,
              now: new Date(),
            }),
            effectAuthorizationStatus: "CONSUMED" as const,
            consumedAt: new Date(),
          };
          await new TypeOrmApprovalRepository(f.source).insert(consumedApproval);
          await commands.insert({
            ...pending,
            approvalId: consumedApproval.id,
            effectAuthorizationStatus: "CONSUMED",
          });
          await new TypeOrmCommandOutboxRepository(f.source).insert({
            id: randomUUID(),
            commandId: pending.id,
            ...f.scope,
            state: "READY",
            availableAt: new Date(),
            attempts: 0,
            envelopeHash: pending.payloadHash,
            createdAt: new Date(),
          });
          const input = { incidentRef: "INC-HTTP", reason: "Contain failing integration" };
          expect(
            (await send("suspend", input, "weak-etag-request", 1, "admin", 'W/"1"')).status,
          ).toBe(400);
          const suspended = await send("suspend", input, "suspend-http-request");
          expect(suspended, errors.join("; ")).toMatchObject({
            status: 202,
            body: { state: "SUSPENDED", version: 2 },
          });
          await expect(guard.assertEffectsAllowed(f.scope)).rejects.toThrow(
            "PROJECT_EFFECTS_SUSPENDED",
          );
          expect(
            await commands.get(f.scope.workspaceId, f.scope.projectId, pending.id),
          ).toMatchObject({
            status: "CANCELLED",
            effectAuthorizationStatus: "INVALIDATED",
            outboxStatus: "DEAD",
          });
          expect(
            await f.source.query("SELECT state FROM command_outbox WHERE command_id=$1", [
              pending.id,
            ]),
          ).toEqual([{ state: "DEAD" }]);
          expect(
            await f.source.query("SELECT effect_authorization_state FROM approvals WHERE id=$1", [
              consumedApproval.id,
            ]),
          ).toEqual([{ effect_authorization_state: "INVALIDATED" }]);
          expect(await send("suspend", input, "suspend-http-request")).toEqual(suspended);
          expect(
            (
              await send(
                "suspend",
                { ...input, reason: "Different command" },
                "suspend-http-request",
              )
            ).status,
          ).toBe(409);
          expect(
            (
              await send(
                "resume",
                { stepUp: true, distinctOwnerApproval: true, probesFresh: true },
                "client-booleans-request",
                2,
              )
            ).status,
          ).toBe(400);
          const disposition = await send(
            "incident-dispositions",
            { incidentRef: input.incidentRef, outcome: "ACCEPTED", reason: "Failure investigated" },
            "incident-disposition-request",
            2,
          );
          expect(disposition.status).toBe(202);
          await expect(
            f.source.query(
              "UPDATE project_incident_dispositions SET outcome='REJECTED' WHERE disposition_id=$1",
              [disposition.body.resultRef.id],
            ),
          ).rejects.toThrow();
          const prepare = {
            incidentDispositionRef: disposition.body.resultRef,
            reason: "Resume after repair",
          };
          expect(
            (await send("resume-candidates", prepare, "no-mfa-prepare-request", 2, "no-mfa"))
              .status,
          ).toBe(403);
          const original = f.probes[0]!;
          const appendProbe = async (status: "AVAILABLE" | "UNAVAILABLE") => {
            const { contentHash: _hash, ...body } = original;
            void _hash;
            const probe = createSafeCapabilityProbe({
              ...body,
              probeId: randomUUID(),
              status,
              observedAt: new Date().toISOString(),
            });
            await new ProjectBindingRepository(f.source).appendCapabilityProbe(probe);
          };
          await appendProbe("UNAVAILABLE");
          expect(
            (await send("resume-candidates", prepare, "negative-probe-request", 2)).status,
          ).toBe(409);
          await appendProbe("AVAILABLE");
          const { contentHash: _optionalHash, ...optionalBody } = original;
          void _optionalHash;
          await new ProjectBindingRepository(f.source).appendCapabilityProbe(
            createSafeCapabilityProbe({
              ...optionalBody,
              probeId: randomUUID(),
              logicalRole: "SOURCE_CONTEXT",
              capabilityKey: "source-context.read",
              operation: "commit.read",
              status: "UNAVAILABLE",
              observedAt: new Date().toISOString(),
            }),
          );
          await f.source.query(
            "UPDATE connector_profile_headers SET current_published_version=NULL WHERE id=$1",
            [f.profileRef.id],
          );
          expect(
            (await send("resume-candidates", prepare, "retired-profile-request", 2)).status,
          ).toBe(409);
          await f.source.query(
            "UPDATE connector_profile_headers SET current_published_version=1 WHERE id=$1",
            [f.profileRef.id],
          );
          const candidate = await send("resume-candidates", prepare, "resume-candidate-request", 2);
          expect(candidate.status).toBe(202);
          expect(
            (
              await send(
                "approvals",
                { candidateRef: candidate.body.resultRef },
                "self-approval-request",
                2,
              )
            ).status,
          ).toBe(403);
          const approval = await send(
            "approvals",
            { candidateRef: candidate.body.resultRef },
            "owner-approval-request",
            2,
            "owner",
          );
          expect(approval.status).toBe(202);
          const resume = {
            incidentRef: input.incidentRef,
            ...prepare,
            freshProbeRefs: candidate.body.candidate.freshProbeRefs,
            actionCandidateRef: candidate.body.resultRef,
            approvalRef: approval.body.resultRef,
          };
          expect(
            (
              await send(
                "resume",
                {
                  ...resume,
                  approvalRef: {
                    ...approval.body.resultRef,
                    contentHash: `sha256:${"f".repeat(64)}`,
                  },
                },
                "wrong-approval-request",
                2,
              )
            ).status,
          ).toBe(409);
          await f.source.query(
            "UPDATE project_entitlements SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
            [f.scope.workspaceId, f.scope.projectId, f.initial.actor.principalId],
          );
          expect((await send("resume", resume, "revoked-initiator-request", 2)).status).toBe(403);
          await f.source.query(
            "UPDATE project_entitlements SET revoked_at=NULL WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
            [f.scope.workspaceId, f.scope.projectId, f.initial.actor.principalId],
          );
          await app!.close();
          app = undefined;
          await f.source.destroy();
          await f.source.initialize();
          await boot();
          const results = await Promise.all([
            send("resume", resume, "resume-a-request", 2),
            send("resume", resume, "resume-b-request", 2),
          ]);
          expect(results.map((r) => r.status).sort()).toEqual([202, 409]);
          const index = results.findIndex((r) => r.status === 202),
            key = index === 0 ? "resume-a-request" : "resume-b-request";
          expect(await send("resume", resume, key, 2)).toEqual(results[index]);
          await expect(guard.assertEffectsAllowed(f.scope, 3)).resolves.toMatchObject({
            operationalState: "ACTIVE",
          });
          expect(
            await f.source.query(
              "SELECT semantic_body FROM project_onboarding_revisions WHERE revision_id=$1",
              [f.initial.revisionId],
            ),
          ).toEqual([{ semantic_body: f.initial }]);
          expect(
            await f.source.query(
              "SELECT count(*)::int AS n FROM audit_events WHERE action='PROJECT_RESUMED'",
            ),
          ).toEqual([{ n: 1 }]);
          expect(
            await f.source.query("SELECT effect_authorization_state FROM approvals WHERE id=$1", [
              approval.body.resultRef.id,
            ]),
          ).toEqual([{ effect_authorization_state: "CONSUMED" }]);
          await f.source.query(
            "CREATE FUNCTION fail_operation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PROJECT_SUSPENDED' THEN RAISE EXCEPTION 'controlled audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_operation_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_operation_audit()",
          );
          expect((await send("suspend", input, "atomic-rollback-request", 3)).status).toBe(503);
          await expect(guard.assertEffectsAllowed(f.scope, 3)).resolves.toMatchObject({
            operationalState: "ACTIVE",
          });
          expect(
            await f.source.query(
              "SELECT count(*)::int AS n FROM project_onboarding_revisions WHERE workspace_id=$1 AND project_id=$2",
              [f.scope.workspaceId, f.scope.projectId],
            ),
          ).toEqual([{ n: 3 }]);
        } finally {
          await app?.close();
          await f.close();
        }
      },
      180_000,
    );
  },
);
