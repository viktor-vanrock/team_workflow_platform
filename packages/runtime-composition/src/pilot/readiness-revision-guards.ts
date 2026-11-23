import type { EntityManager } from "typeorm";

import type {
  QaAuthorizationBasis,
  QaHumanActor,
  QaRequestInputRevision,
  QaScope,
} from "@awp/competency-qa/node";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import { validateConnectorCommandSnapshot } from "@awp/platform-core";
import { TypeOrmCommandRepository } from "@awp/platform-persistence-typeorm";

/** Call under the request lock in the same transaction as the input revision. */
export async function readQaRequestRevisionGuards(
  source: Pick<EntityManager, "query">,
  scope: QaScope,
  workItemId: string,
): Promise<
  Readonly<{
    hasSessions: boolean;
    readyDispatchState: "NONE" | "FAILED" | "DISPATCHED" | "CONFIRMED";
  }>
> {
  const [work] = (await source.query(
    "SELECT state FROM work_items WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
    [scope.workspaceId, scope.projectId, workItemId],
  )) as { state: string }[];
  if (!work) throw new Error("QA_REQUEST_NOT_FOUND");
  const [sessions] = (await source.query(
    "SELECT EXISTS(SELECT 1 FROM qa_test_sessions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3) AS present",
    [scope.workspaceId, scope.projectId, workItemId],
  )) as { present: boolean }[];
  const commands = (await source.query(
    `SELECT state,payload->'metadata'->>'effectInvocationStartedAt' AS invoked_at
    FROM connector_commands WHERE workspace_id=$1 AND project_id=$2
      AND capability_key='operational-work-item' AND operation='request.transition'
      AND payload->'metadata'->'source'->>'sourceWorkItemId'=$3
      AND payload->'value'->>'requestedNormalizedStatus'='READY' FOR UPDATE`,
    [scope.workspaceId, scope.projectId, workItemId],
  )) as { state: string; invoked_at: string | null }[];
  const hasSessions = sessions?.present === true;
  if (
    ["READY", "PLANNED", "IN_PROGRESS", "REVIEW", "BLOCKED", "DONE", "CANCELLED"].includes(
      work.state,
    ) ||
    commands.some((command) => command.state === "CONFIRMED")
  )
    return { hasSessions, readyDispatchState: "CONFIRMED" };
  // A released command or any unresolved invocation can still change the provider.
  // Terminal local failure alone is not proof that an uncertain write had no effect.
  if (
    commands.some(
      (command) =>
        command.invoked_at !== null ||
        !["AWAITING_APPROVAL", "FAILED", "CONFLICT", "CANCELLED"].includes(command.state),
    )
  )
    return { hasSessions, readyDispatchState: "DISPATCHED" };
  return {
    hasSessions,
    readyDispatchState: commands.some((command) =>
      ["FAILED", "CONFLICT", "CANCELLED"].includes(command.state),
    )
      ? "FAILED"
      : "NONE",
  };
}

/** Invalidates unreleased READY commands atomically with the new input pointer. */
export async function invalidateQaPendingReadiness(
  manager: EntityManager,
  current: QaRequestInputRevision,
  actor: QaHumanActor,
  basis: QaAuthorizationBasis,
): Promise<QaRequestInputRevision["invalidatedState"]> {
  const parameters = [current.workspaceId, current.projectId, current.workItemId];
  const assessments = (await manager.query(
    'SELECT assessment_id AS id,assessment_version AS version,content_hash AS "contentHash" FROM qa_readiness_assessments WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND input_revision_id=$4 ORDER BY assessment_version',
    [...parameters, current.inputRevisionId],
  )) as { id: string; version: number; contentHash: string }[];
  const waivers = (await manager.query(
    "SELECT waiver_id AS id,row_version AS version,content_hash AS \"contentHash\" FROM qa_waivers WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND content->'assessmentRef'->>'id'=ANY($4::text[]) ORDER BY waiver_id",
    [...parameters, assessments.map(({ id }) => id)],
  )) as { id: string; version: number; contentHash: string }[];
  const pending = (await manager.query(
    `SELECT id FROM connector_commands WHERE workspace_id=$1 AND project_id=$2
    AND capability_key='operational-work-item' AND operation='request.transition' AND state='AWAITING_APPROVAL'
    AND payload->'metadata'->'source'->>'sourceWorkItemId'=$3 AND payload->'value'->>'requestedNormalizedStatus'='READY' ORDER BY id FOR UPDATE`,
    parameters,
  )) as { id: string }[];
  const commands = new TypeOrmCommandRepository(manager.dataSource);
  for (const { id } of pending) {
    const command = await commands.get(current.workspaceId, current.projectId, id, manager);
    if (!command || command.effectInvocationStartedAt || command.outboxStatus !== "HELD")
      throw new Error("QA_READINESS_DISPATCH_IN_FLIGHT");
    const now = new Date();
    const invalidated = {
      ...command,
      status: "CANCELLED" as const,
      effectAuthorizationStatus: "INVALIDATED" as const,
      outboxStatus: "DEAD" as const,
      effectGateDecision: "DENIED" as const,
      effectGateReasonCode: "QA_REQUEST_INPUT_CHANGED",
      effectGateEvaluatedAt: now,
      effectAuthorizationBasis: basis,
      effectAuthorizationBasisHash: sha256(basis as unknown as JsonValue),
      rowVersion: command.rowVersion + 1,
      updatedAt: now,
    };
    validateConnectorCommandSnapshot(invalidated);
    await commands.save(invalidated, command.rowVersion, manager);
    await manager.query(
      "UPDATE command_outbox SET state='DEAD',lease_until=NULL,next_republish_at=NULL WHERE workspace_id=$1 AND project_id=$2 AND command_id=$3 AND state='HELD'",
      [current.workspaceId, current.projectId, id],
    );
    await manager.query(
      "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES(gen_random_uuid(),$1,$2,$3,$4,'qa.readiness.invalidate','DENIED','QA_REQUEST_INPUT_CHANGED',$5,$6,$7,$8,$9)",
      [
        current.workspaceId,
        current.projectId,
        now,
        actor,
        command.correlationId,
        command.causationId,
        basis,
        current.dataClassificationKey,
        { commandId: id, inputRevisionId: current.inputRevisionId },
      ],
    );
  }
  return {
    readinessAssessmentRefs: assessments.map(({ id, version, contentHash }) => ({
      assessmentId: id,
      version,
      contentHash,
    })),
    waiverRefs: waivers,
    pendingReadyCommandRefs: pending.map(({ id }) => ({ commandId: id })),
  };
}
