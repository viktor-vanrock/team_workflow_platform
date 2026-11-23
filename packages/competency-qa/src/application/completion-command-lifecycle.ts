import type { EntityManager } from "typeorm";

import type {
  ExternalCommandLifecycleContribution,
  ExternalCommandLifecyclePhase,
  ExternalCommandLifecycleTransaction,
  PackLifecycleDelta,
  ScopedExternalCommandContext,
} from "@awp/competency-sdk";

import { qaAggregateSnapshotHash, QaDomainError } from "../domain/primitives.ts";

type Row = Record<string, unknown>;
const exactRefMatches = (
  stored: unknown,
  actual: Readonly<{ id: string; version: number }>,
): boolean => {
  const value = typeof stored === "string" ? (JSON.parse(stored) as Row) : (stored as Row);
  return String(value?.id) === actual.id && Number(value?.version) === actual.version;
};
const first = (value: unknown): Row | undefined => {
  const rows = Array.isArray(value) && Array.isArray(value[0]) ? value[0] : value;
  return Array.isArray(rows) ? (rows[0] as Row | undefined) : undefined;
};

export class TypeOrmQaCompletionCommandLifecycleStore {
  async apply(
    transaction: ExternalCommandLifecycleTransaction,
    input: Readonly<{
      phase: ExternalCommandLifecyclePhase;
      command: ScopedExternalCommandContext;
    }>,
  ): Promise<Readonly<{ replayed: boolean }>> {
    const manager = transaction.native as EntityManager;
    const command = input.command;
    const candidate = first(
      await manager.query(
        "SELECT * FROM qa_completion_candidates WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND (approval_ref->>'id'=$4 OR command_ref->>'id'=$5) ORDER BY candidate_number DESC LIMIT 1 FOR UPDATE",
        [
          command.workspaceId,
          command.projectId,
          command.source.sourceWorkItemId,
          command.approvalId ?? "",
          command.commandId,
        ],
      ),
    );
    if (!candidate) throw new QaDomainError("QA_COMPLETION_CANDIDATE_NOT_FOUND");
    const state = String(candidate.state);
    const candidateId = String(candidate.candidate_id);
    const approvalRef =
      typeof candidate.approval_ref === "string"
        ? (JSON.parse(candidate.approval_ref) as Row)
        : (candidate.approval_ref as Row | null);
    const profileRefs =
      typeof candidate.profile_refs === "string"
        ? (JSON.parse(candidate.profile_refs) as Row[])
        : (candidate.profile_refs as Row[]);
    if (
      command.source.sourceWorkItemId !== candidate.work_item_id ||
      !exactRefMatches(candidate.binding_ref, command.bindingRef) ||
      command.profileRefs.length !== 1 ||
      profileRefs.length !== 1 ||
      !exactRefMatches(profileRefs[0], command.profileRefs[0]!) ||
      ((state !== "CANDIDATE" || command.approvalId !== undefined) &&
        String(approvalRef?.id ?? "") !== (command.approvalId ?? ""))
    )
      throw new QaDomainError("QA_COMPLETION_COMMAND_CHAIN_MISMATCH");
    if (input.phase === "APPROVAL_REJECTED") {
      if (state === "REJECTED") return { replayed: true };
      if (state !== "AWAITING_APPROVAL")
        throw new QaDomainError("QA_COMPLETION_LIFECYCLE_STATE_INVALID");
      await manager.query(
        "UPDATE qa_completion_candidates SET state='REJECTED',terminal_from_state='AWAITING_APPROVAL',terminal_reason='APPROVAL_REJECTED',resource_version=resource_version+1 WHERE candidate_id=$1",
        [candidateId],
      );
      return { replayed: false };
    }
    if (input.phase === "APPROVAL_RELEASED") {
      if (state === "AUTHORIZED") return { replayed: true };
      if (state !== "AWAITING_APPROVAL")
        throw new QaDomainError("QA_COMPLETION_LIFECYCLE_STATE_INVALID");
      const approval = first(
        await manager.query(
          "SELECT approver_id,subject_hash,decision_state,effect_authorization_state,expires_at FROM approvals WHERE id=$1 AND workspace_id=$2 AND project_id=$3 FOR UPDATE",
          [command.approvalId, command.workspaceId, command.projectId],
        ),
      );
      const initiatedBy =
        typeof candidate.initiated_by === "string"
          ? (JSON.parse(candidate.initiated_by) as Row)
          : (candidate.initiated_by as Row);
      if (
        !approval?.approver_id ||
        approval.decision_state !== "APPROVED" ||
        approval.effect_authorization_state !== "CONSUMED" ||
        Date.parse(String(approval.expires_at)) <= Date.now() ||
        String(approval.subject_hash) !==
          String(approvalRef?.subjectHash ?? approvalRef?.subject_hash) ||
        String(approval.approver_id) === String(initiatedBy.principalId ?? initiatedBy.principal_id)
      )
        throw new QaDomainError("QA_COMPLETION_APPROVER_DISTINCT_REQUIRED");
      await manager.query(
        "UPDATE qa_completion_candidates SET state='AUTHORIZED',approved_by=$1,approved_authorization_basis_hash=$2,approved_at=clock_timestamp(),resource_version=resource_version+1 WHERE candidate_id=$3",
        [approval.approver_id, approval.subject_hash, candidateId],
      );
      return { replayed: false };
    }
    if (input.phase === "EFFECT_INVOCATION_STARTED") {
      if (state === "DISPATCHED") return { replayed: true };
      if (state !== "AUTHORIZED") throw new QaDomainError("QA_COMPLETION_LIFECYCLE_STATE_INVALID");
      const installed = first(
        await manager.query(
          "UPDATE qa_request_extensions SET completion_in_flight_candidate_id=$1,completion_dispatch_guard=jsonb_build_object('state','DISPATCHED','candidateId',$1,'commandId',$2),resource_version=resource_version+1,updated_at=clock_timestamp() WHERE workspace_id=$3 AND project_id=$4 AND work_item_id=$5 AND completion_in_flight_candidate_id IS NULL AND adjudicative_aggregate_hash=$6 RETURNING extension_id",
          [
            candidateId,
            command.commandId,
            command.workspaceId,
            command.projectId,
            command.source.sourceWorkItemId,
            candidate.aggregate_snapshot_hash,
          ],
        ),
      );
      if (!installed) throw new QaDomainError("QA_COMPLETION_AGGREGATE_STALE");
      await manager.query(
        "UPDATE qa_completion_candidates SET state='DISPATCHED',command_ref=$1,effect_key_hash=$2,dispatched_at=clock_timestamp(),resource_version=resource_version+1 WHERE candidate_id=$3 AND state='AUTHORIZED'",
        [
          JSON.stringify({ id: command.commandId }),
          qaAggregateSnapshotHash(command.effectIdempotencyKey as never),
          candidateId,
        ],
      );
      return { replayed: false };
    }
    if (state === "FAILED") return { replayed: true };
    if (state !== "DISPATCHED") throw new QaDomainError("QA_COMPLETION_LIFECYCLE_STATE_INVALID");
    await manager.query(
      "UPDATE qa_completion_candidates SET state='FAILED',terminal_from_state='DISPATCHED',failure_code='EXTERNAL_COMMAND_FAILED',terminal_reason='Generic command reached terminal failure',resource_version=resource_version+1 WHERE candidate_id=$1",
      [candidateId],
    );
    await manager.query(
      "UPDATE qa_request_extensions SET completion_in_flight_candidate_id=NULL,completion_dispatch_guard=jsonb_build_object('state','OPEN'),resource_version=resource_version+1,updated_at=clock_timestamp() WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND completion_in_flight_candidate_id=$4",
      [command.workspaceId, command.projectId, command.source.sourceWorkItemId, candidateId],
    );
    return { replayed: false };
  }
}

export function createQaCompletionCommandLifecycleContribution(
  store = new TypeOrmQaCompletionCommandLifecycleStore(),
): ExternalCommandLifecycleContribution {
  return Object.freeze({
    key: "qa.completion-command-lifecycle",
    order: 2450,
    matches: (input: ScopedExternalCommandContext) =>
      input.commandType === "qa.completion.done" &&
      input.capabilityKey === "operational-work-item" &&
      input.capabilityVersion === "1.0.0" &&
      input.operation === "request.transition" &&
      input.source.sourceWorkItemId !== undefined,
    apply: async (
      phase: ExternalCommandLifecyclePhase,
      command: ScopedExternalCommandContext,
      transaction: ExternalCommandLifecycleTransaction,
    ): Promise<PackLifecycleDelta> => {
      const result = await store.apply(transaction, { phase, command });
      return Object.freeze({
        idempotencyKey: transaction.idempotencyKey,
        replayed: result.replayed,
        events: Object.freeze([]),
        audit: Object.freeze([]),
      });
    },
  });
}
