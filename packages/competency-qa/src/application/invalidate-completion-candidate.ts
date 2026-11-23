import type { EntityManager } from "typeorm";

import type { QaCompletionCandidateAggregate } from "../domain/completion.ts";
import { buildQaDodAssessment, type QaDodAssessment } from "../domain/dod.ts";
import {
  qaAggregateSnapshotHash,
  type QaExactReference,
  type QaWorkspaceContext,
} from "../domain/primitives.ts";
import { TypeOrmQaVerdictDodRepository } from "../persistence/verdict-dod.repository.ts";
import type { QaAdjudicativeMutationInvalidatorContribution } from "./qa-adjudicative-mutation-invalidator.ts";

export class QaCompletionCandidateStore {
  readonly #candidates = new Map<string, QaCompletionCandidateAggregate>();
  readonly #byWorkItem = new Map<string, string[]>();
  readonly #inFlight = new Map<string, string>();
  readonly #dod = new Map<string, QaDodAssessment[]>();
  readonly #confirmations: QaExactReference[] = [];

  add(candidate: QaCompletionCandidateAggregate): QaCompletionCandidateAggregate {
    const existing = this.#candidates.get(candidate.candidateId);
    if (existing) {
      if (existing.contentHash !== candidate.contentHash)
        throw new Error("QA_COMPLETION_IDEMPOTENCY_CONFLICT");
      return existing;
    }
    this.#candidates.set(candidate.candidateId, candidate);
    const ids = this.#byWorkItem.get(candidate.workItemId) ?? [];
    ids.push(candidate.candidateId);
    this.#byWorkItem.set(candidate.workItemId, ids);
    return candidate;
  }

  candidate(id: string): QaCompletionCandidateAggregate | undefined {
    return this.#candidates.get(id);
  }
  current(workItemId: string): QaCompletionCandidateAggregate | undefined {
    return (this.#byWorkItem.get(workItemId) ?? []).map((id) => this.#candidates.get(id)!).at(-1);
  }
  installInFlight(candidate: QaCompletionCandidateAggregate): void {
    if (candidate.state !== "DISPATCHED") throw new Error("QA_COMPLETION_IN_FLIGHT_STATE_INVALID");
    const current = this.#inFlight.get(candidate.workItemId);
    if (current && current !== candidate.candidateId)
      throw new Error("QA_COMPLETION_IN_FLIGHT_CONFLICT");
    this.#inFlight.set(candidate.workItemId, candidate.candidateId);
  }
  releaseInFlight(candidate: QaCompletionCandidateAggregate): void {
    if (this.#inFlight.get(candidate.workItemId) === candidate.candidateId)
      this.#inFlight.delete(candidate.workItemId);
  }
  inFlight(workItemId: string): string | undefined {
    return this.#inFlight.get(workItemId);
  }
  appendDod(assessment: QaDodAssessment): void {
    const values = this.#dod.get(assessment.workItemId) ?? [];
    values.push(assessment);
    this.#dod.set(assessment.workItemId, values);
  }
  latestDodAssessment(workItemId: string): QaDodAssessment | undefined {
    return this.#dod.get(workItemId)?.at(-1);
  }
  addConfirmation(ref: QaExactReference): void {
    if (!this.#confirmations.some(({ id }) => id === ref.id)) this.#confirmations.push(ref);
  }
  finalConfirmations(): readonly QaExactReference[] {
    return Object.freeze(structuredClone(this.#confirmations));
  }
}

export function createQaCompletionInvalidator(
  store: QaCompletionCandidateStore,
): QaAdjudicativeMutationInvalidatorContribution {
  return Object.freeze({
    key: "qa.completion-candidate-invalidator",
    order: 2030,
    invalidatePending: async (context: QaWorkspaceContext, workItemId: string, reason: string) => {
      const candidate = store.current(workItemId);
      if (
        !candidate ||
        candidate.state === "INVALIDATED" ||
        candidate.state === "REJECTED" ||
        candidate.state === "FAILED" ||
        candidate.state === "CONFIRMED"
      )
        return;
      candidate.invalidate(reason);
      const now = new Date().toISOString();
      store.appendDod(
        buildQaDodAssessment({
          assessmentId: `dod:block:${candidate.candidateId}:${candidate.resourceVersion}`,
          version: 1,
          workspaceId: candidate.workspaceId,
          projectId: candidate.projectId,
          workItemId,
          state: "BLOCKED",
          blockerCodes: Object.freeze([reason]),
          warningCodes: Object.freeze([]),
          inventory: Object.freeze({
            sessionReviewRefs: Object.freeze([]),
            evidenceManifestRefs: Object.freeze([]),
            findingOutcomeRefs: Object.freeze([]),
            waiverRefs: Object.freeze([]),
          }),
          aggregateInputHash: qaAggregateSnapshotHash({
            previous: candidate.aggregateSnapshotHash,
            reason,
          } as never),
          ruleSetRef: {
            id: "qa.dod.rules",
            version: 1,
            contentHash: qaAggregateSnapshotHash({ id: "qa.dod.rules", version: "1.0.0" } as never),
          },
          riskPolicyRef: {
            id: "qa.risk.policy",
            version: 1,
            contentHash: qaAggregateSnapshotHash({ id: "qa.risk.policy", version: 1 } as never),
          },
          evaluatedBy: context.actor.principalId,
          evaluatedAt: now,
        }),
      );
    },
  });
}

const dbRows = (value: unknown): readonly Record<string, unknown>[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Record<string, unknown>[];
};
const dbJson = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

export type QaPendingCompletionCancellation = (
  context: QaWorkspaceContext,
  workItemId: string,
  candidate: Readonly<{
    candidateId: string;
    contentHash: string;
    approvalRef?: Readonly<{ id: string; subjectHash: string }>;
  }>,
  reason: string,
) => Promise<void>;

/** Same-transaction invalidation; Core effects must be cancelled by the composed owner. */
export function createQaTypeOrmCompletionInvalidator(
  manager: EntityManager,
  cancelPending?: QaPendingCompletionCancellation,
): QaAdjudicativeMutationInvalidatorContribution {
  return Object.freeze({
    key: "qa.completion-candidate-typeorm-invalidator",
    order: 2030,
    invalidatePending: async (context: QaWorkspaceContext, workItemId: string, reason: string) => {
      if (!manager.queryRunner?.isTransactionActive || context.scope.kind !== "PROJECT")
        throw new Error("QA_COMPLETION_INVALIDATION_TRANSACTION_REQUIRED");
      const scope = [context.scope.workspaceId, context.scope.projectId, workItemId];
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `qa-request:${scope.join(":")}`,
      ]);
      const [extension] = dbRows(
        await manager.query(
          "SELECT e.completion_in_flight_candidate_id,e.completion_dispatch_guard,w.normalized_status FROM qa_request_extensions e JOIN work_items w ON w.workspace_id=e.workspace_id AND w.project_id=e.project_id AND w.id=e.work_item_id WHERE e.workspace_id=$1 AND e.project_id=$2 AND e.work_item_id=$3 FOR UPDATE OF e,w",
          scope,
        ),
      );
      if (!extension) throw new Error("QA_REQUEST_NOT_FOUND");
      if (
        extension.normalized_status === "DONE" ||
        (extension.completion_dispatch_guard as { state?: string } | null)?.state === "DONE_FROZEN"
      )
        throw new Error("QA_WORK_ITEM_DONE");
      if (
        extension.completion_in_flight_candidate_id ||
        (extension.completion_dispatch_guard as { state?: string } | null)?.state === "DISPATCHED"
      )
        throw new Error("QA_COMPLETION_IN_FLIGHT");
      const candidate = dbRows(
        await manager.query(
          "SELECT * FROM qa_completion_candidates WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND state IN('CANDIDATE','AWAITING_APPROVAL','AUTHORIZED','DISPATCHED') ORDER BY candidate_number DESC LIMIT 1 FOR UPDATE",
          scope,
        ),
      )[0];
      if (!candidate) return;
      if (candidate.state === "DISPATCHED") throw new Error("QA_COMPLETION_IN_FLIGHT");
      const readyRef = dbJson<QaExactReference>(candidate.ready_to_close_dod_ref);
      const [ready] = dbRows(
        await manager.query(
          "SELECT * FROM qa_dod_assessments WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND assessment_id=$4 AND version=$5 AND content_hash=$6 AND state='READY_TO_CLOSE'",
          [...scope, readyRef.id, readyRef.version, readyRef.contentHash],
        ),
      );
      if (!ready) throw new Error("QA_COMPLETION_INVALIDATION_PROOF_REQUIRED");
      const previous = buildQaDodAssessment({
        assessmentId: String(ready.assessment_id),
        version: Number(ready.version),
        workspaceId: context.scope.workspaceId,
        projectId: context.scope.projectId,
        workItemId,
        state: "READY_TO_CLOSE",
        blockerCodes: dbJson(ready.blocker_codes),
        warningCodes: dbJson(ready.warning_codes),
        inventory: dbJson(ready.inventory),
        aggregateInputHash: ready.aggregate_input_hash,
        ruleSetRef: dbJson(ready.rule_set_ref),
        riskPolicyRef: dbJson(ready.risk_policy_ref),
        evaluatedBy: String(ready.evaluated_by),
        evaluatedAt: (ready.evaluated_at instanceof Date
          ? ready.evaluated_at
          : new Date(String(ready.evaluated_at))
        ).toISOString(),
      } as Omit<QaDodAssessment, "contentHash">);
      if (previous.contentHash !== ready.content_hash)
        throw new Error("QA_COMPLETION_INVALIDATION_PROOF_REQUIRED");
      const approvalRef = candidate.approval_ref
        ? dbJson<{ id: string; subjectHash: string }>(candidate.approval_ref)
        : undefined;
      if (approvalRef && !cancelPending)
        throw new Error("QA_COMPLETION_CANCELLATION_PORT_REQUIRED");
      await cancelPending?.(
        context,
        workItemId,
        {
          candidateId: String(candidate.candidate_id),
          contentHash: String(candidate.content_hash),
          ...(approvalRef ? { approvalRef } : {}),
        },
        reason,
      );
      const priorState = String(candidate.state);
      const changed = dbRows(
        await manager.query(
          "UPDATE qa_completion_candidates SET state='INVALIDATED',terminal_from_state=$1,terminal_reason=$2,resource_version=resource_version+1 WHERE candidate_id=$3 AND state=$1 RETURNING candidate_id",
          [priorState, reason, candidate.candidate_id],
        ),
      )[0];
      if (!changed) return;
      const latest = dbRows(
        await manager.query(
          "SELECT COALESCE(max(version),0) AS version FROM qa_dod_assessments WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3",
          [candidate.workspace_id, candidate.project_id, workItemId],
        ),
      )[0];
      const assessment = buildQaDodAssessment({
        assessmentId: `dod:block:${String(candidate.candidate_id)}:${Number(candidate.resource_version) + 1}`,
        version: Number(latest?.version ?? 0) + 1,
        workspaceId: String(candidate.workspace_id),
        projectId: String(candidate.project_id),
        workItemId,
        state: "BLOCKED",
        blockerCodes: [reason === "QA_VERDICT_CHANGED" ? "VERDICT_STALE" : reason],
        warningCodes: previous.warningCodes,
        inventory: previous.inventory,
        aggregateInputHash: previous.aggregateInputHash,
        ruleSetRef: previous.ruleSetRef,
        riskPolicyRef: previous.riskPolicyRef,
        evaluatedBy: context.actor.principalId,
        evaluatedAt: new Date().toISOString(),
      });
      await new TypeOrmQaVerdictDodRepository(manager).appendDod(assessment);
      await manager.query(
        "UPDATE qa_request_extensions SET latest_dod_assessment_id=$1,resource_version=resource_version+1,updated_at=clock_timestamp() WHERE workspace_id=$2 AND project_id=$3 AND work_item_id=$4",
        [assessment.assessmentId, assessment.workspaceId, assessment.projectId, workItemId],
      );
    },
  });
}
