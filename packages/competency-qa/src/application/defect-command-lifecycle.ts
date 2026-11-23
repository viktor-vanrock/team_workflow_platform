import type { EntityManager } from "typeorm";

import type {
  ExternalCommandLifecycleContribution,
  ExternalCommandLifecyclePhase,
  ExternalCommandLifecycleTransaction,
  PackLifecycleDelta,
  ScopedExternalCommandContext,
} from "@awp/competency-sdk";

import { qaAggregateSnapshotHash, QaDomainError } from "../domain/primitives.ts";

export interface QaDefectCommandLifecycleStore {
  apply(
    transaction: ExternalCommandLifecycleTransaction,
    input: Readonly<{
      phase: ExternalCommandLifecyclePhase;
      command: ScopedExternalCommandContext;
    }>,
  ): Promise<Readonly<{ replayed: boolean }>>;
}

export class TypeOrmQaDefectCommandLifecycleStore implements QaDefectCommandLifecycleStore {
  async apply(
    transaction: ExternalCommandLifecycleTransaction,
    input: Readonly<{
      phase: ExternalCommandLifecyclePhase;
      command: ScopedExternalCommandContext;
    }>,
  ): Promise<Readonly<{ replayed: boolean }>> {
    const manager = transaction.native as EntityManager;
    const command = input.command;
    const raw = (await manager.query(
      "SELECT * FROM qa_defect_drafts WHERE workspace_id=$1 AND project_id=$2 AND (approval_ref->>'id'=$3 OR command_ref->>'id'=$4) ORDER BY version DESC LIMIT 1 FOR UPDATE",
      [command.workspaceId, command.projectId, command.approvalId ?? "", command.commandId],
    )) as readonly unknown[];
    const draft = (Array.isArray(raw[0]) ? raw[0][0] : raw[0]) as
      Readonly<Record<string, unknown>> | undefined;
    if (!draft) throw new QaDomainError("QA_DEFECT_DRAFT_NOT_FOUND");
    const state = String(draft.state);
    let target: string, fields: Readonly<{ sql: string; params: readonly unknown[] }>;
    if (input.phase === "APPROVAL_REJECTED") {
      target = "INVALIDATED";
      if (state === target) return { replayed: true };
      if (state !== "AWAITING_APPROVAL")
        throw new QaDomainError("QA_DEFECT_LIFECYCLE_STATE_INVALID");
      fields = {
        sql: "terminal_from_state='AWAITING_APPROVAL',invalidation_reason='APPROVAL_REJECTED'",
        params: [],
      };
    } else if (input.phase === "APPROVAL_RELEASED") {
      target = "AUTHORIZED";
      if (state === target) return { replayed: true };
      if (state !== "AWAITING_APPROVAL")
        throw new QaDomainError("QA_DEFECT_LIFECYCLE_STATE_INVALID");
      fields = { sql: "terminal_from_state=NULL", params: [] };
    } else if (input.phase === "EFFECT_INVOCATION_STARTED") {
      target = "DISPATCHED";
      if (state === target) return { replayed: true };
      if (state !== "AUTHORIZED") throw new QaDomainError("QA_DEFECT_LIFECYCLE_STATE_INVALID");
      fields = {
        sql: "command_ref=$1,effect_key_hash=$2",
        params: [
          JSON.stringify({ id: command.commandId }),
          qaAggregateSnapshotHash(command.effectIdempotencyKey as never),
        ],
      };
    } else {
      target = "FAILED";
      if (state === target) return { replayed: true };
      if (
        !["DRAFT", "READY_FOR_APPROVAL", "AWAITING_APPROVAL", "AUTHORIZED", "DISPATCHED"].includes(
          state,
        )
      )
        throw new QaDomainError("QA_DEFECT_LIFECYCLE_STATE_INVALID");
      fields = {
        sql: `terminal_from_state='${state}',failure_code='EXTERNAL_COMMAND_FAILED',terminal_reason='Generic command reached terminal failure'`,
        params: [],
      };
    }
    await manager.query(
      `UPDATE qa_defect_drafts SET state='${target}',${fields.sql},resource_version=resource_version+1,updated_at=clock_timestamp() WHERE defect_draft_id=$${fields.params.length + 1}`,
      [...fields.params, draft.defect_draft_id],
    );
    return { replayed: false };
  }
}

export function createQaDefectCommandLifecycleContribution(
  store: QaDefectCommandLifecycleStore,
): ExternalCommandLifecycleContribution {
  return Object.freeze({
    key: "qa.defect-create-command-lifecycle",
    order: 2350,
    matches: (input: ScopedExternalCommandContext) =>
      input.capabilityKey === "operational-work-item" &&
      input.capabilityVersion === "1.0.0" &&
      input.operation === "defect.create" &&
      input.source.sourceWorkItemId !== undefined,
    apply: async (
      phase: ExternalCommandLifecyclePhase,
      command: ScopedExternalCommandContext,
      transaction: ExternalCommandLifecycleTransaction,
    ): Promise<PackLifecycleDelta> => {
      const result = await store.apply(transaction, { phase, command });
      return Object.freeze({
        idempotencyKey: `${command.commandId}:${phase}`,
        replayed: result.replayed,
        events: Object.freeze([]),
        audit: Object.freeze([]),
      });
    },
  });
}
