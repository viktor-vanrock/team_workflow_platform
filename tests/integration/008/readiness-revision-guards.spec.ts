import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { QaReadinessController } from "../../../apps/api/src/extensions/qa-readiness.controller.ts";
import { createLocalQaReadinessRuntime } from "../../../apps/api/src/local/local-qa-readiness-runtime.ts";
import {
  qaAggregateSnapshotHash,
  QaRequestInputRepository,
  QaRequestRepository,
  QaTypeOrmIntakeConfirmationWriter,
} from "../../../packages/competency-qa/src/node.ts";
import {
  type ConnectorCommand,
  externalCommandLifecycleContext,
  InMemoryDurableCommandStore,
} from "../../../packages/platform-core/src/index.ts";
import {
  TypeOrmCommandRepository,
  TypeOrmExternalCommandLifecycleUnitOfWork,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { localPersonaIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { makeCompleteReadinessInput } from "../../support/002-readiness-fixture.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  type Us3DatabaseFixture,
} from "../../support/002-us3-database.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

async function unstartedRequest(f: Us3DatabaseFixture, complete = false) {
  const workItemId = randomUUID();
  const current = (await new QaRequestInputRepository(f.source).get(f, f.workItemId, 1))!;
  const original = (await new QaRequestRepository(f.source).byWorkItem(f, f.workItemId))!;
  const full = makeCompleteReadinessInput().currentInput;
  const requester = {
    ...current.originalRequesterRef,
    principalId: localPersonaIds["requester.alpha"],
    subject: "requester.alpha",
  };
  const input = {
    ...(complete ? full : {}),
    ...current,
    ...(complete
      ? {
          originalRequesterRef: requester,
          responseChannelResolution: {
            ...full.responseChannelResolution,
            requesterPrincipal: requester,
          },
        }
      : {}),
    workItemId,
    inputRevisionId: randomUUID(),
    externalRequestRef: { ...current.externalRequestRef, id: workItemId },
  };
  input.contentHash = qaAggregateSnapshotHash(input as never);
  const extension = {
    ...original,
    workItemId,
    extensionId: randomUUID(),
    currentRequestInputRevisionRef: {
      id: input.inputRevisionId,
      version: 1,
      contentHash: input.contentHash,
    },
  };
  extension.contentHash = qaAggregateSnapshotHash(extension as never);
  await f.source.transaction(async (manager) => {
    await manager.query(
      "INSERT INTO work_items(id,workspace_id,project_id,work_type_definition_id,created_by,state,classification_key,created_at) SELECT $1,workspace_id,project_id,work_type_definition_id,created_by,'NEW',classification_key,now() FROM work_items WHERE workspace_id=$2 AND project_id=$3 AND id=$4",
      [workItemId, f.workspaceId, f.projectId, f.workItemId],
    );
    await new QaTypeOrmIntakeConfirmationWriter().persist(
      {
        transactionId: randomUUID(),
        native: manager,
        contributionKey: "qa.request-create.confirmation",
        idempotencyKey: workItemId,
      },
      { extension, initialInput: input },
    );
  });
  return workItemId;
}

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "008 persisted readiness revision guards",
  () => {
    it.each(POSTGRES_TEST_IMAGES)(
      "freezes sessions and effects and preserves revision CAS across restart on %s",
      async (postgresImage) => {
        const f = await startUs3DatabaseFixture({ postgresImage });
        // This revision-only proof must never use the transition broker.
        const controller = new QaReadinessController(
          f.source,
          createLocalQaReadinessRuntime(f.source),
        );
        const headers = new Map<string, string>();
        const revise = (workItemId: string, etag = 'W/"1"') =>
          controller.revise(
            f.request as never,
            f.workspaceId,
            f.projectId,
            workItemId,
            etag,
            {
              semanticInput: {
                goal: "Requester supplied missing acceptance details",
                blockers: [],
                dependencies: [],
              },
              changeReasonCode: "MISSING_INFO_SUPPLIED",
              reason: "Requester supplied missing acceptance details",
            },
            {
              setHeader: (key, value) => {
                headers.set(key, value);
              },
            },
          );
        try {
          await expect(revise(f.workItemId)).rejects.toThrow("QA_REQUEST_INPUT_FROZEN_READY");
          await f.source.query("UPDATE work_items SET state='NEW' WHERE id=$1", [f.workItemId]);
          await expect(revise(f.workItemId)).rejects.toThrow(
            "QA_REQUEST_INPUT_FROZEN_SESSION_EXISTS",
          );
          expect(
            await new QaRequestInputRepository(f.source).history(f, f.workItemId),
          ).toHaveLength(1);

          const editable = await unstartedRequest(f);
          expect(await revise(editable)).toMatchObject({ version: 2 });
          expect(headers.get("ETag")).toBe('W/"2"');
          await expect(revise(editable)).rejects.toThrow("QA_REQUEST_INPUT_STALE");
          await f.source.destroy();
          await f.source.initialize();
          expect(await revise(editable, 'W/"2"')).toMatchObject({ version: 3 });
          expect(headers.get("ETag")).toBe('W/"3"');

          const evaluated = await unstartedRequest(f);
          const response = {
            setHeader: (key: string, value: string) => {
              headers.set(key, value);
            },
          };
          const firstAssessment = await controller.assess(
            f.request as never,
            f.workspaceId,
            f.projectId,
            evaluated,
            'W/"1"',
            response,
          );
          expect(await new QaRequestRepository(f.source).byWorkItem(f, evaluated)).toMatchObject({
            resourceVersion: 2,
            latestReadinessAssessmentRef: {
              id: firstAssessment.assessmentId,
              version: 1,
              contentHash: firstAssessment.contentHash,
            },
          });
          const secondAssessment = await controller.assess(
            f.request as never,
            f.workspaceId,
            f.projectId,
            evaluated,
            'W/"2"',
            response,
          );
          expect(secondAssessment.version).toBe(2);
          expect(secondAssessment.requestInputRevisionRef).toEqual(
            firstAssessment.requestInputRevisionRef,
          );
          expect(secondAssessment.assessmentId).not.toBe(firstAssessment.assessmentId);
          expect(
            (await controller.history(f.request as never, f.workspaceId, f.projectId, evaluated))
              .items,
          ).toHaveLength(2);
          expect(await revise(evaluated, 'W/"3"')).toMatchObject({ version: 2 });
          expect(
            (await new QaRequestRepository(f.source).byWorkItem(f, evaluated))
              ?.latestReadinessAssessmentRef,
          ).toBeUndefined();

          for (const state of ["QUEUED", "DISPATCHED", "RETRY_SCHEDULED", "CONFIRMED"] as const) {
            const workItemId = await unstartedRequest(f);
            const base = InMemoryDurableCommandStore.readyFixture().command();
            const command: ConnectorCommand = {
              ...base,
              id: randomUUID(),
              workspaceId: f.workspaceId,
              projectId: f.projectId,
              actor: (await new QaRequestInputRepository(f.source).get(f, workItemId, 1))!
                .recordedBy,
              capability: {
                key: "operational-work-item",
                exactContractVersion: "1.0.0",
                operation: "request.transition",
                logicalRole: "QA_REQUEST_AUTHORITY",
              },
              commandType: "request.transition",
              payload: { requestedNormalizedStatus: "READY" },
              source: { sourceWorkItemId: workItemId },
              status: state,
              correlationId: randomUUID(),
              causationId: randomUUID(),
              effectIdempotencyKey: `awp:effect:${randomUUID()}`,
              clientRequestKey: randomUUID(),
              ...(state === "DISPATCHED"
                ? { outboxStatus: "ACKNOWLEDGED", effectInvocationStartedAt: new Date() }
                : {}),
              ...(state === "CONFIRMED"
                ? {
                    outboxStatus: "ACKNOWLEDGED",
                    terminalResult: {
                      outcome: "SUCCEEDED",
                      receipt: { normalizedStatus: "READY" },
                    },
                  }
                : {}),
            };
            await new TypeOrmCommandRepository(f.source).insert(command);
            await expect(revise(workItemId)).rejects.toThrow(
              state === "CONFIRMED"
                ? "QA_REQUEST_INPUT_FROZEN_READY"
                : "QA_READINESS_DISPATCH_IN_FLIGHT",
            );
            expect(
              await new QaRequestInputRepository(f.source).history(f, workItemId),
            ).toHaveLength(1);
          }
        } finally {
          await stopUs3DatabaseFixture(f);
        }
      },
      120_000,
    );

    it.each(POSTGRES_TEST_IMAGES)(
      "persists one held READY command, rolls back partial submission and rejects stale release on %s",
      async (postgresImage) => {
        const f = await startUs3DatabaseFixture({ postgresImage });
        const runtime = createLocalQaReadinessRuntime(f.source);
        const controller = new QaReadinessController(f.source, runtime);
        try {
          const workItemId = await unstartedRequest(f, true);
          const assessment = await controller.assess(
            f.request as never,
            f.workspaceId,
            f.projectId,
            workItemId,
            'W/"1"',
            f.response,
          );
          expect(assessment.state).toBe("READY");
          const confirm = () =>
            controller.confirm(f.request as never, f.workspaceId, f.projectId, workItemId);
          await f.source.query(
            "CREATE FUNCTION test_reject_ready_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_OUTBOX_WRITE_REJECTED'; END $$; CREATE TRIGGER test_ready_outbox BEFORE INSERT ON command_outbox FOR EACH ROW EXECUTE FUNCTION test_reject_ready_outbox()",
          );
          await expect(confirm()).rejects.toThrow("TEST_OUTBOX_WRITE_REJECTED");
          const count = async () =>
            (
              await f.source.query(
                "SELECT count(*)::int AS count FROM connector_commands WHERE payload->'metadata'->>'commandType'='qa.readiness.ready'",
              )
            )[0].count;
          expect(await count()).toBe(0);
          expect(
            (
              await f.source.query(
                "SELECT count(*)::int AS count FROM approvals WHERE subject->'action'->>'commandType'='qa.readiness.ready'",
              )
            )[0].count,
          ).toBe(0);
          await f.source.query(
            "DROP TRIGGER test_ready_outbox ON command_outbox; DROP FUNCTION test_reject_ready_outbox()",
          );
          const results = await Promise.all([confirm(), confirm(), confirm()]);
          expect(new Set(results.map(({ commandId }) => commandId)).size).toBe(1);
          expect(results.filter(({ replayed }) => !replayed)).toHaveLength(1);
          expect(results[0]).toMatchObject({ state: "READY_PENDING_SYNC", inputFrozen: false });
          expect(await count()).toBe(1);
          const command = (await new TypeOrmCommandRepository(f.source).get(
            f.workspaceId,
            f.projectId,
            results[0]!.commandId,
          ))!;
          expect(command).toMatchObject({
            status: "AWAITING_APPROVAL",
            outboxStatus: "HELD",
            actor: { kind: "HUMAN" },
            recoveryPolicy: "LOOKUP_REQUIRED",
          });
          expect(
            (await f.source.query("SELECT state FROM work_items WHERE id=$1", [workItemId]))[0]
              .state,
          ).toBe("NEW");
          expect(
            (
              await f.source.query("SELECT state FROM command_outbox WHERE command_id=$1", [
                command.id,
              ])
            )[0].state,
          ).toBe("HELD");
          await f.source.destroy();
          await f.source.initialize();
          expect(await confirm()).toMatchObject({ commandId: command.id, replayed: true });

          // Current facts are checked at consumption, after the immutable assessment was recorded.
          const lifecycle = new TypeOrmExternalCommandLifecycleUnitOfWork(f.source, [
            runtime.lifecycleContribution(),
          ]);
          let released = false;
          await lifecycle.execute(
            "APPROVAL_RELEASED",
            externalCommandLifecycleContext(command),
            async () => {
              released = true;
            },
          );
          expect(released).toBe(true);
          released = false;
          const revision = await controller.revise(
            f.request as never,
            f.workspaceId,
            f.projectId,
            workItemId,
            'W/"2"',
            {
              semanticInput: {
                goal: "Updated scope before approval",
                blockers: [],
                dependencies: [],
              },
              changeReasonCode: "REQUESTER_CORRECTION",
              reason: "Updated scope before approval",
            },
            f.response,
          );
          expect(revision.invalidatedState.pendingReadyCommandRefs).toEqual([
            { commandId: command.id },
          ]);
          expect(revision.invalidatedState.readinessAssessmentRefs).toEqual([
            {
              assessmentId: assessment.assessmentId,
              version: assessment.version,
              contentHash: assessment.contentHash,
            },
          ]);
          await expect(
            lifecycle.execute(
              "APPROVAL_RELEASED",
              externalCommandLifecycleContext(command),
              async () => {
                released = true;
              },
            ),
          ).rejects.toThrow("QA_READINESS_COMMAND_STALE");
          await expect(
            lifecycle.execute(
              "EFFECT_INVOCATION_STARTED",
              externalCommandLifecycleContext(command),
              async () => {
                released = true;
              },
            ),
          ).rejects.toThrow("QA_READINESS_COMMAND_STALE");
          expect(released).toBe(false);
          expect(
            (
              await f.source.query("SELECT state FROM command_outbox WHERE command_id=$1", [
                command.id,
              ])
            )[0].state,
          ).toBe("DEAD");

          const revokedItem = await unstartedRequest(f, true);
          await controller.assess(
            f.request as never,
            f.workspaceId,
            f.projectId,
            revokedItem,
            'W/"1"',
            f.response,
          );
          const pending = await controller.confirm(
            f.request as never,
            f.workspaceId,
            f.projectId,
            revokedItem,
          );
          const revokedCommand = (await new TypeOrmCommandRepository(f.source).get(
            f.workspaceId,
            f.projectId,
            pending.commandId,
          ))!;
          await f.source.query(
            "UPDATE project_entitlements SET revoked_at=now() WHERE workspace_id=$1 AND project_id=$2 AND principal_id=$3",
            [f.workspaceId, f.projectId, localPersonaIds["requester.alpha"]],
          );
          await expect(
            controller.confirm(f.request as never, f.workspaceId, f.projectId, revokedItem),
          ).rejects.toThrow("QA_READINESS_FACTS_CHANGED");
          await expect(
            lifecycle.execute(
              "APPROVAL_RELEASED",
              externalCommandLifecycleContext(revokedCommand),
              async () => {
                released = true;
              },
            ),
          ).rejects.toThrow("QA_READINESS_COMMAND_STALE");
          expect(released).toBe(false);
        } finally {
          await stopUs3DatabaseFixture(f);
        }
      },
      120_000,
    );
  },
);
