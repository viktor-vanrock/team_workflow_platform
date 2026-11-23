import { randomUUID } from "node:crypto";

import type { QaProjectEffectGuardPort } from "../application/session-start-guards.ts";
import type { QaManualAttempt } from "../domain/manual-attempt.ts";
import type { QaObservation } from "../domain/observation.ts";
import type { QaPlanItem } from "../domain/plan-item.ts";
import type { QaPlanItemResultRevision } from "../domain/plan-item-result.ts";
import { qaAggregateSnapshotHash, QaDomainError } from "../domain/primitives.ts";
import type { QaTargetSnapshotV2 } from "../domain/snapshots-v2.ts";
import type { QaTestSession } from "../domain/test-session.ts";
import type { QaQueryExecutor } from "./repository-helpers.ts";

const dbRows = <T>(value: unknown): readonly T[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly T[];
};

export interface ManualSessionAdmissionHook {
  /** Executes on the same transaction/query executor before the Session CAS. */
  admit(
    previous: QaTestSession,
    next: QaTestSession,
  ): Promise<
    | Readonly<{
        outcome: string;
        decisionRef?: Readonly<Record<string, unknown>>;
        replayed?: boolean;
        overrideCandidate?: Readonly<{
          actionId: string;
          approvalId: string;
          approvalSubjectHash: string;
          publicIntentHash: string;
          expiresAt: string;
        }>;
      }>
    | undefined
  >;
}

export class ManualExecutionUnitOfWork {
  constructor(
    private readonly source: QaQueryExecutor,
    private readonly admission?: ManualSessionAdmissionHook,
    private readonly effectGuard?: QaProjectEffectGuardPort,
  ) {}

  async persistTargetSnapshotV2(snapshot: QaTargetSnapshotV2): Promise<void> {
    await this.source.query(
      `INSERT INTO qa_target_snapshots_v2(snapshot_id,version,workspace_id,project_id,work_item_id,session_id,mode,semantic_body,captured_at,content_hash)
       VALUES($1,1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        snapshot.snapshotId,
        snapshot.workspaceId,
        snapshot.projectId,
        snapshot.workItemId,
        snapshot.sessionId,
        snapshot.mode,
        JSON.stringify(snapshot),
        snapshot.capturedAt,
        snapshot.contentHash,
      ],
    );
  }
  async persistTransition(
    previous: QaTestSession,
    next: QaTestSession,
  ): Promise<
    Readonly<{
      persisted: boolean;
      admission?: Awaited<ReturnType<ManualSessionAdmissionHook["admit"]>>;
    }>
  > {
    if (next.resourceVersion !== previous.resourceVersion + 1 || next.id !== previous.id)
      throw new QaDomainError("QA_SESSION_TRANSITION_INVALID");
    const enteringConsumingState =
      new Set(["RUNNING", "REVIEW_REQUIRED"]).has(next.state) &&
      (previous.state === "BLOCKED" ||
        !new Set(["RUNNING", "REVIEW_REQUIRED"]).has(previous.state));
    if (enteringConsumingState) {
      await this.effectGuard?.assertEffectsAllowed({
        workspaceId: next.workspaceId,
        projectId: next.projectId,
      });
      if (!this.admission) throw new QaDomainError("QA_SESSION_CAPACITY_ADMISSION_REQUIRED");
      const admission = await this.admission.admit(previous, next);
      // Denials are durable decisions in the same transaction. They deliberately
      // stop before the Session CAS instead of throwing and rolling the decision back.
      if (admission?.outcome === "DENIED") return Object.freeze({ persisted: false, admission });
      const updated = await this.persistSession(previous, next);
      return Object.freeze({ persisted: true, ...(admission ? { admission } : {}), ...updated });
    }
    await this.persistSession(previous, next);
    return Object.freeze({ persisted: true });
  }

  private async persistSession(
    previous: QaTestSession,
    next: QaTestSession,
  ): Promise<Readonly<Record<string, never>>> {
    const updated = await this.source.query(
      `UPDATE qa_test_sessions SET state=$1,owner_id=$2,required_capabilities=$3,target_snapshot=$4,target_hash=$5,scope_snapshot=$6,scope_hash=$7,structure_revision=$8,structure_hash=$9,ready_against_structure_hash=$10,resource_version=$11,content=$12,ready_at=$13,started_at=$14,blocked_at=$15,cancelled_at=$16,blocked_from=$17,cancelled_from=$18,state_reason=$19,completed_at=$20,latest_session_review_id=$21,session_outcome=$22,adjudicative_manifest_revision_id=$23 WHERE session_id=$24 AND workspace_id=$25 AND project_id=$26 AND mode='MANUAL' AND resource_version=$27 RETURNING session_id`,
      [
        next.state,
        next.ownerId,
        JSON.stringify(next.requiredCapabilities),
        JSON.stringify(next.targetSnapshot),
        next.targetSnapshot.contentHash,
        JSON.stringify(next.scopeSnapshot),
        next.scopeSnapshot.contentHash,
        next.structureRevision,
        next.structureHash,
        next.readyAgainstStructureHash,
        next.resourceVersion,
        JSON.stringify(next),
        next.readyAt ?? null,
        next.startedAt ?? null,
        next.blockedAt ?? null,
        next.cancelledAt ?? null,
        next.blockedFrom ?? null,
        next.cancelledFrom ?? null,
        next.stateReason ?? null,
        next.completedAt ?? null,
        next.latestSessionReviewId ?? null,
        next.sessionOutcome ?? null,
        next.adjudicativeManifestRevisionId ?? null,
        next.id,
        next.workspaceId,
        next.projectId,
        previous.resourceVersion,
      ],
    );
    const rows = dbRows<unknown>(updated);
    if (rows.length === 0) throw new QaDomainError("QA_SESSION_STALE_VERSION");
    return Object.freeze({});
  }

  async replacePlanItems(
    previous: QaTestSession,
    next: QaTestSession,
    items: readonly QaPlanItem[],
  ): Promise<void> {
    if (
      next.structureRevision !== previous.structureRevision + 1 ||
      next.planItemSetHash === previous.planItemSetHash ||
      items.length === 0
    )
      throw new QaDomainError("QA_PLAN_ITEM_STRUCTURE_MUTATION_INVALID");
    await this.source.query("SELECT set_config('awp.qa_structure_mutation','allowed',true)");
    await this.source.query(
      "DELETE FROM qa_plan_items WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3",
      [previous.workspaceId, previous.projectId, previous.id],
    );
    for (const item of items) {
      const definitionHash =
        "snapshotHash" in item.definition
          ? item.definition.snapshotHash
          : item.definition.contentHash;
      await this.source.query(
        `INSERT INTO qa_plan_items(plan_item_id,workspace_id,project_id,work_item_id,session_id,ordinal,state,mode,title,instructions,expected_outcome,definition_ref,definition_hash,content_hash,content,resource_version,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'PLANNED','MANUAL',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          item.id,
          item.workspaceId,
          item.projectId,
          item.workItemId,
          item.sessionId,
          item.ordinal,
          item.title,
          item.instructions ?? null,
          item.expectedOutcome,
          JSON.stringify(item.definition),
          definitionHash,
          item.contentHash,
          JSON.stringify(item),
          item.resourceVersion,
          JSON.stringify(item.createdBy),
          item.createdAt,
          item.updatedAt,
        ],
      );
    }
    await this.persistTransition(previous, next);
  }

  async persistAttemptStart(
    attempt: QaManualAttempt,
    expectedSessionVersion: number,
  ): Promise<number> {
    await this.source.query("SELECT set_config('awp.qa_execution_mutation','allowed',true)");
    const identityRows = dbRows<Readonly<{ attempt_no: number | string }>>(
      await this.source.query(
        `
      INSERT INTO qa_attempt_identities(
        attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,mode,attempt_no,
        target_snapshot_hash,scope_snapshot_hash,trigger_kind,initiator_kind,initiator_principal_id,
        authorization_basis_hash,correlation_id,causation_id,created_at,identity_content_hash
      )
      SELECT $1,$2,$3,$4,$5,$6,'MANUAL',$7,$8,session.scope_hash,'HUMAN_MANUAL','HUMAN',$9,$10,$11,$11,$12,$10
      FROM qa_test_sessions session
      WHERE session.workspace_id=$2 AND session.project_id=$3 AND session.session_id=$5 AND session.mode='MANUAL'
      RETURNING attempt_no
    `,
        [
          attempt.id,
          attempt.workspaceId,
          attempt.projectId,
          attempt.workItemId,
          attempt.sessionId,
          attempt.planItemId,
          attempt.attemptNo,
          attempt.targetSnapshotHash,
          attempt.actor.principalId,
          attempt.contentHash,
          `manual:${attempt.id}`,
          attempt.startedAt,
        ],
      ),
    );
    if (identityRows.length !== 1 || Number(identityRows[0]!.attempt_no) !== attempt.attemptNo) {
      throw new QaDomainError("QA_MANUAL_ATTEMPT_IDENTITY_INVALID");
    }
    await this.source.query(
      `INSERT INTO qa_manual_attempts(attempt_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,attempt_no,state,target_snapshot_hash,actor,started_at,content_hash,content,resource_version) VALUES($1,$2,$3,$4,$5,$6,$7,'RUNNING',$8,$9,$10,$11,$12,$13)`,
      [
        attempt.id,
        attempt.workspaceId,
        attempt.projectId,
        attempt.workItemId,
        attempt.sessionId,
        attempt.planItemId,
        attempt.attemptNo,
        attempt.targetSnapshotHash,
        JSON.stringify(attempt.actor),
        attempt.startedAt,
        attempt.contentHash,
        JSON.stringify(attempt),
        attempt.resourceVersion,
      ],
    );
    const itemHash = qaAggregateSnapshotHash({
      planItemId: attempt.planItemId,
      state: "RUNNING",
      attemptId: attempt.id,
    } as never);
    const itemRows = dbRows<unknown>(
      await this.source.query(
        "UPDATE qa_plan_items SET state='RUNNING',resource_version=resource_version+1,content_hash=$1,content=content||jsonb_build_object('state','RUNNING','resourceVersion',resource_version+1),updated_at=$2 WHERE workspace_id=$3 AND project_id=$4 AND session_id=$5 AND plan_item_id=$6 AND state IN('PLANNED','RUNNING') RETURNING plan_item_id",
        [
          itemHash,
          attempt.startedAt,
          attempt.workspaceId,
          attempt.projectId,
          attempt.sessionId,
          attempt.planItemId,
        ],
      ),
    );
    if (itemRows.length === 0) throw new QaDomainError("QA_PLAN_ITEM_EXECUTION_CLOSED");
    return await this.#advanceSession(attempt, expectedSessionVersion);
  }

  async persistAttemptCompletion(
    previous: QaManualAttempt,
    next: QaManualAttempt,
    expectedSessionVersion: number,
  ): Promise<number> {
    const rows = dbRows<unknown>(
      await this.source.query(
        `UPDATE qa_manual_attempts SET state='COMPLETED',actor=$1,ended_at=$2,result=$3,cancellation_reason=$4,notes=$5,content_hash=$6,content=$7,resource_version=$8 WHERE workspace_id=$9 AND project_id=$10 AND attempt_id=$11 AND state='RUNNING' AND resource_version=$12 RETURNING attempt_id`,
        [
          JSON.stringify(next.actor),
          next.endedAt,
          next.result,
          next.cancellationReason ?? null,
          next.notes ?? null,
          next.contentHash,
          JSON.stringify(next),
          next.resourceVersion,
          next.workspaceId,
          next.projectId,
          next.id,
          previous.resourceVersion,
        ],
      ),
    );
    if (rows.length === 0) throw new QaDomainError("QA_ATTEMPT_STALE_VERSION");
    return await this.#advanceSession(next, expectedSessionVersion);
  }

  async persistObservation(
    observation: QaObservation,
    expectedSessionVersion: number,
    sessionMode: "MANUAL" | "AUTOMATED" = "MANUAL",
  ): Promise<number> {
    await this.source.query(
      `INSERT INTO qa_observations(observation_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,attempt_id,kind,expected_outcome,actual_outcome,severity,notes,artifact_ids,corrects_observation_id,corrects_content_hash,correction_reason,actor,observed_at,content_hash,content,resource_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,1)`,
      [
        observation.id,
        observation.workspaceId,
        observation.projectId,
        observation.workItemId,
        observation.sessionId,
        observation.planItemId,
        observation.attemptId,
        observation.kind,
        observation.expectedOutcome,
        observation.actualOutcome,
        observation.severity,
        observation.notes ?? null,
        JSON.stringify(observation.artifactIds),
        observation.correctsObservationRef?.id ?? null,
        observation.correctsObservationRef?.contentHash ?? null,
        observation.correctionReason ?? null,
        JSON.stringify(observation.actor),
        observation.observedAt,
        observation.contentHash,
        JSON.stringify(observation),
      ],
    );
    return await this.#advanceSession(observation, expectedSessionVersion, sessionMode);
  }

  async persistResult(
    result: QaPlanItemResultRevision,
    expectedSessionVersion: number,
    sessionMode: "MANUAL" | "AUTOMATED" = "MANUAL",
  ): Promise<number> {
    await this.source.query("SELECT set_config('awp.qa_execution_mutation','allowed',true)");
    const flaky = result.flakyDispositionBasis;
    await this.source.query(
      `INSERT INTO qa_plan_item_result_revisions(result_revision_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,version,previous_revision_id,previous_version,previous_content_hash,correction_reason,result,attempt_set_hash,observation_set_hash,maximum_attempt_no,review_flags,evidence_link_set_hash,waiver_id,flaky_finding_id,flaky_disposed_review_id,flaky_disposed_review_version,flaky_disposed_review_content_hash,flaky_membership_set_hash,flaky_failed_attempt_set_hash,flaky_observation_set_hash,flaky_policy_key,flaky_policy_version,flaky_policy_hash,actual_outcome,decision_reason,content_hash,content,recorded_by,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34)`,
      [
        result.id,
        result.workspaceId,
        result.projectId,
        result.workItemId,
        result.sessionId,
        result.planItemId,
        result.version,
        result.previousRevisionRef?.id ?? null,
        result.previousRevisionRef?.version ?? null,
        result.previousRevisionRef?.contentHash ?? null,
        result.correctionReason ?? null,
        result.result,
        result.consideredAttemptSetHash,
        result.consideredObservationSetHash,
        result.maximumAttemptNo,
        JSON.stringify(result.reviewFlags),
        result.evidenceLinkSetHash,
        result.waiverRef?.id ?? null,
        flaky?.findingId ?? null,
        flaky?.disposedFindingReviewRef.id ?? null,
        flaky?.disposedFindingReviewRef.version ?? null,
        flaky?.disposedFindingReviewRef.contentHash ?? null,
        flaky?.activeMembershipSetHash ?? null,
        flaky?.failedAttemptSetHash ?? null,
        flaky?.flakyObservationSetHash ?? null,
        flaky?.policyRef.key ?? null,
        flaky?.policyRef.version ?? null,
        flaky?.policyRef.contentHash ?? null,
        result.actualOutcome,
        result.decisionReason,
        result.contentHash,
        JSON.stringify(result),
        JSON.stringify(result.recordedBy),
        result.recordedAt,
      ],
    );
    for (const [index, ref] of result.consideredAttemptRefs.entries())
      await this.source.query(
        "INSERT INTO qa_plan_item_result_attempt_memberships(membership_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,result_revision_id,attempt_id,ordinal,attempt_content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          randomUUID(),
          result.workspaceId,
          result.projectId,
          result.workItemId,
          result.sessionId,
          result.planItemId,
          result.id,
          ref.id,
          index + 1,
          ref.contentHash,
        ],
      );
    for (const [index, ref] of result.consideredObservationRefs.entries()) {
      const rows = dbRows<Readonly<{ attempt_id: string }>>(
        await this.source.query(
          "SELECT attempt_id FROM qa_observations WHERE workspace_id=$1 AND project_id=$2 AND observation_id=$3",
          [result.workspaceId, result.projectId, ref.id],
        ),
      );
      if (!rows[0]) throw new QaDomainError("QA_OBSERVATION_NOT_FOUND");
      await this.source.query(
        "INSERT INTO qa_plan_item_result_observation_memberships(membership_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,result_revision_id,observation_id,attempt_id,ordinal,observation_content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          randomUUID(),
          result.workspaceId,
          result.projectId,
          result.workItemId,
          result.sessionId,
          result.planItemId,
          result.id,
          ref.id,
          rows[0].attempt_id,
          index + 1,
          ref.contentHash,
        ],
      );
    }
    for (const [index, ref] of (flaky?.flakyObservationRefs ?? []).entries())
      await this.source.query(
        "INSERT INTO qa_plan_item_result_flaky_observation_memberships(membership_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,result_revision_id,finding_id,finding_membership_id,failed_attempt_id,observation_id,ordinal) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [
          randomUUID(),
          result.workspaceId,
          result.projectId,
          result.workItemId,
          result.sessionId,
          result.planItemId,
          result.id,
          flaky!.findingId,
          ref.membershipId,
          ref.attemptId,
          ref.id,
          index + 1,
        ],
      );
    for (const [index, evidenceLinkId] of result.evidenceLinkIds.entries()) {
      const rows = dbRows<Readonly<{ content_hash: string }>>(
        await this.source.query(
          "SELECT content_hash FROM qa_evidence_artifact_links WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 AND evidence_link_id=$4",
          [result.workspaceId, result.projectId, result.sessionId, evidenceLinkId],
        ),
      );
      if (!rows[0]) throw new QaDomainError("QA_RESULT_EVIDENCE_LINK_INVALID");
      await this.source.query(
        "INSERT INTO qa_plan_item_result_evidence_memberships(membership_id,workspace_id,project_id,work_item_id,session_id,plan_item_id,result_revision_id,evidence_link_id,ordinal,evidence_link_content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          randomUUID(),
          result.workspaceId,
          result.projectId,
          result.workItemId,
          result.sessionId,
          result.planItemId,
          result.id,
          evidenceLinkId,
          index + 1,
          rows[0].content_hash,
        ],
      );
    }
    const state = result.result === "NOT_RUN" ? "WAIVED" : "TERMINAL";
    const itemHash = qaAggregateSnapshotHash({
      planItemId: result.planItemId,
      state,
      latestResultRevisionRef: {
        id: result.id,
        version: result.version,
        contentHash: result.contentHash,
      },
    } as never);
    const itemRows = dbRows<unknown>(
      await this.source.query(
        "UPDATE qa_plan_items SET state=$1,latest_result_revision_id=$2,waiver_id=$3,resource_version=resource_version+1,content_hash=$4,content=content||jsonb_build_object('state',$1::text,'latestResultRevisionRef',jsonb_build_object('id',$2::text,'version',$5::integer,'contentHash',$6::text),'resourceVersion',resource_version+1),updated_at=$7 WHERE workspace_id=$8 AND project_id=$9 AND session_id=$10 AND plan_item_id=$11 AND state IN('RUNNING','TERMINAL','PLANNED') RETURNING plan_item_id",
        [
          state,
          result.id,
          result.waiverRef?.id ?? null,
          itemHash,
          result.version,
          result.contentHash,
          result.recordedAt,
          result.workspaceId,
          result.projectId,
          result.sessionId,
          result.planItemId,
        ],
      ),
    );
    if (itemRows.length === 0) throw new QaDomainError("QA_PLAN_ITEM_EXECUTION_CLOSED");
    return await this.#advanceSession(result, expectedSessionVersion, sessionMode);
  }

  async #advanceSession(
    value: Readonly<{ workspaceId: string; projectId: string; sessionId: string }>,
    expectedSessionVersion: number,
    sessionMode: "MANUAL" | "AUTOMATED" = "MANUAL",
  ): Promise<number> {
    const rows = dbRows<Readonly<{ resource_version: number | string }>>(
      await this.source.query(
        "UPDATE qa_test_sessions SET resource_version=resource_version+1,content=content||jsonb_build_object('resourceVersion',resource_version+1) WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 AND mode=$4 AND resource_version=$5 RETURNING resource_version",
        [value.workspaceId, value.projectId, value.sessionId, sessionMode, expectedSessionVersion],
      ),
    );
    if (rows.length === 0) throw new QaDomainError("QA_SESSION_STALE_VERSION");
    return Number(rows[0]!.resource_version);
  }
}
