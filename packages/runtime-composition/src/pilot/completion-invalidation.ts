import { randomUUID } from "node:crypto";

import type { EntityManager } from "typeorm";

import {
  createQaTypeOrmCompletionInvalidator,
  qaAggregateSnapshotHash,
} from "@awp/competency-qa/node";
import {
  type Approval,
  validateApprovalSnapshot,
  validateConnectorCommandSnapshot,
} from "@awp/platform-core";
import { TypeOrmCommandRepository } from "@awp/platform-persistence-typeorm";

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => {
  const array = value as unknown[];
  return (Array.isArray(array[0]) ? array[0] : array) as Row[];
};
const denied = () => new Error("QA_COMPLETION_CANCELLATION_DENIED");

/** Cancels Core authority and QA proof on the caller's bound transaction. */
export function createDurableQaCompletionInvalidator(manager: EntityManager) {
  return createQaTypeOrmCompletionInvalidator(
    manager,
    async (context, workItemId, candidate, reason) => {
      if (
        !manager.queryRunner?.isTransactionActive ||
        context.scope.kind !== "PROJECT" ||
        !context.authorizationBasis
      )
        throw denied();
      const { workspaceId, projectId } = context.scope;
      const now = new Date();
      const approvalRef = candidate.approvalRef;
      let commandId: string | undefined;
      if (approvalRef) {
        const [stored] = rows(
          await manager.query(
            "SELECT * FROM approvals WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
            [workspaceId, projectId, approvalRef.id],
          ),
        );
        const repository = new TypeOrmCommandRepository(manager.dataSource);
        const command = stored
          ? await repository.get(workspaceId, projectId, String(stored.action_id), manager)
          : undefined;
        if (
          !stored ||
          !command ||
          command.source.sourceWorkItemId !== workItemId ||
          command.commandType !== "qa.completion.done" ||
          command.effectInvocationStartedAt ||
          command.attemptCount ||
          !["AWAITING_APPROVAL", "QUEUED"].includes(command.status)
        )
          throw denied();
        const expected = (
          command.expectedExternalState as {
            qaCompletion?: { candidateRef?: { id?: string; contentHash?: string } };
          }
        ).qaCompletion?.candidateRef;
        if (
          expected?.id !== candidate.candidateId ||
          expected.contentHash !== candidate.contentHash ||
          approvalRef.subjectHash !== stored.subject_hash ||
          command.approvalId !== stored.id
        )
          throw denied();
        commandId = command.id;
        const cancelled = {
          ...command,
          status: "CANCELLED" as const,
          effectAuthorizationStatus: "INVALIDATED" as const,
          outboxStatus: "DEAD" as const,
          effectGateDecision: "DENIED" as const,
          effectGateReasonCode: reason,
          effectGateEvaluatedAt: now,
          effectAuthorizationBasis: context.authorizationBasis,
          effectAuthorizationBasisHash: qaAggregateSnapshotHash(
            context.authorizationBasis as never,
          ),
          rowVersion: command.rowVersion + 1,
          updatedAt: now,
        };
        validateConnectorCommandSnapshot(cancelled);
        await repository.save(cancelled, command.rowVersion, manager);
        const [outbox] = rows(
          await manager.query(
            "UPDATE command_outbox SET state='DEAD',lease_until=NULL,next_republish_at=NULL WHERE workspace_id=$1 AND project_id=$2 AND command_id=$3 AND state IN('HELD','READY','LEASED','ENQUEUED') RETURNING id",
            [workspaceId, projectId, command.id],
          ),
        );
        if (!outbox) throw denied();
        const approval = stored.subject as Approval;
        if (
          approval.subjectHash !== stored.subject_hash ||
          approval.action.actionId !== command.id ||
          approval.action.actionKind !== "EXTERNAL_COMMAND" ||
          !["PENDING", "APPROVED"].includes(approval.decisionStatus)
        )
          throw denied();
        const invalidated =
          approval.decisionStatus === "PENDING"
            ? {
                ...approval,
                decisionStatus: "CANCELLED" as const,
                effectAuthorizationStatus: "NOT_AUTHORIZED" as const,
                resourceVersion: approval.resourceVersion + 1,
              }
            : {
                ...approval,
                effectAuthorizationStatus: "INVALIDATED" as const,
                invalidationReason: "EXPECTED_STATE_CHANGED" as const,
                invalidatedAt: now,
                resourceVersion: approval.resourceVersion + 1,
              };
        validateApprovalSnapshot(invalidated);
        const [changed] = rows(
          await manager.query(
            "UPDATE approvals SET subject=$4,decision_state=$5,effect_authorization_state=$6,row_version=$7 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND row_version=$8 RETURNING id",
            [
              workspaceId,
              projectId,
              approval.id,
              invalidated,
              invalidated.decisionStatus,
              invalidated.effectAuthorizationStatus,
              invalidated.resourceVersion,
              stored.row_version,
            ],
          ),
        );
        if (!changed) throw denied();
      }
      const [work] = rows(
        await manager.query(
          "SELECT classification_key FROM work_items WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
          [workspaceId, projectId, workItemId],
        ),
      );
      if (!work) throw denied();
      await manager.query(
        "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,$4,$5,'qa.completion.invalidate','SUCCEEDED',$6,$7,$8,$9,$10,$11)",
        [
          randomUUID(),
          workspaceId,
          projectId,
          now,
          context.actor,
          reason,
          context.correlationId,
          context.causationId,
          context.authorizationBasis,
          work.classification_key,
          {
            values: {
              workItemId,
              candidateId: candidate.candidateId,
              ...(commandId ? { commandId } : {}),
            },
            versionRefs: [],
          },
        ],
      );
    },
  );
}
