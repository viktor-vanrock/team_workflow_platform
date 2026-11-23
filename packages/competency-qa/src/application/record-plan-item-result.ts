import { randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import {
  createQaPlanItemResultRevision,
  type QaFlakyDispositionBasis,
  type QaPlanItemHumanResult,
} from "../domain/plan-item-result.ts";
import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
} from "../domain/primitives.ts";
import {
  InMemoryManualExecutionRepository,
  TypeOrmManualExecutionRepository,
} from "../persistence/manual-execution.repository.ts";
import { ManualExecutionUnitOfWork } from "../persistence/manual-execution.uow.ts";
import {
  attemptRequiresEvidence,
  planItemResultRequiresEvidence,
} from "../rules/evidence-policy.v1.ts";
import {
  evaluateQaAutomationReviewReadiness,
  type QaAutomationReviewReadiness,
  type QaAutomationRiskReviewerPolicy,
} from "./automation-review-readiness.ts";

const negativeObservation = (kind: string) => kind === "NEGATIVE" || kind === "AMBIGUOUS";

export function assertQaAutomationPlanItemResultReview(
  input: Readonly<{
    readiness: QaAutomationReviewReadiness;
    expectedAttemptSetHash: QaContentHash;
    result: QaPlanItemHumanResult;
    reviewFlags: readonly "FLAKY_SUSPECTED"[];
    flakyDispositionBasis?: QaFlakyDispositionBasis;
  }>,
): void {
  const blocker = input.readiness.blockers[0];
  if (!input.readiness.reviewable || blocker)
    throw new QaDomainError(blocker?.code ?? "QA_AUTOMATION_REVIEW_BLOCKED");
  if (input.readiness.attemptSetHash !== input.expectedAttemptSetHash)
    throw new QaDomainError("QA_AUTOMATION_ATTEMPT_SET_STALE");
  const expectedFlags = input.readiness.reviewFlags;
  if (
    expectedFlags.length !== input.reviewFlags.length ||
    expectedFlags.some((flag) => !input.reviewFlags.includes(flag))
  ) {
    throw new QaDomainError("QA_AUTOMATION_REVIEW_FLAGS_MISMATCH");
  }
  if (
    expectedFlags.includes("FLAKY_SUSPECTED") &&
    (input.result !== "PASS" || !input.flakyDispositionBasis)
  ) {
    throw new QaDomainError("QA_FLAKY_DISPOSITION_BASIS_REQUIRED");
  }
}

export class RecordPlanItemResultService {
  constructor(private readonly repository: InMemoryManualExecutionRepository) {}

  async record(
    input: Readonly<{
      sessionId: string;
      planItemId: string;
      result: QaPlanItemHumanResult;
      actualOutcome: string;
      decisionReason: string;
      reviewFlags?: readonly "FLAKY_SUSPECTED"[];
      evidenceLinkIds?: readonly string[];
      waiverRef?: Readonly<{ id: string; contentHash: QaContentHash }>;
      flakyDispositionBasis?: QaFlakyDispositionBasis;
      previousRevisionRef?: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
      correctionReason?: string;
      actor: QaHumanActor;
      expectedSessionVersion: number;
      expectedMaximumAttemptNo: number;
      expectedAttemptSetHash: QaContentHash;
      expectedObservationSetHash: QaContentHash;
      at: string;
    }>,
  ) {
    return await this.repository.locked(() => {
      const session = this.repository.assertSession(input.sessionId, input.expectedSessionVersion);
      if (session.state === "COMPLETED")
        throw new QaDomainError("QA_SESSION_REVIEWED_EXECUTION_FROZEN");
      const item = this.repository.planItem(input.planItemId);
      if (item.state === "WAIVED") throw new QaDomainError("QA_PLAN_ITEM_EXECUTION_CLOSED");
      const snapshot = this.repository.snapshot(item.id);
      const attemptHistory = this.repository.attempts(item.id);
      if (attemptHistory.some(({ state }) => state === "RUNNING"))
        throw new QaDomainError("QA_RESULT_RUNNING_ATTEMPT");
      if (
        snapshot.maximumAttemptNo !== input.expectedMaximumAttemptNo ||
        snapshot.attemptSetHash !== input.expectedAttemptSetHash ||
        snapshot.observationSetHash !== input.expectedObservationSetHash
      )
        throw new QaDomainError("QA_RESULT_EXPECTED_SET_STALE");
      if (snapshot.attempts.some((attempt, index) => attempt.attemptNo !== index + 1))
        throw new QaDomainError("QA_RESULT_ATTEMPT_SEQUENCE_GAPPED");
      const existing = snapshot.resultRevisions;
      if (
        existing.length === 0 &&
        (input.previousRevisionRef !== undefined || input.correctionReason !== undefined)
      )
        throw new QaDomainError("QA_RESULT_INITIAL_PREDECESSOR_FORBIDDEN");
      if (existing.length > 0) {
        const previous = existing.at(-1)!;
        if (
          !input.previousRevisionRef ||
          input.previousRevisionRef.id !== previous.id ||
          input.previousRevisionRef.version !== previous.version ||
          input.previousRevisionRef.contentHash !== previous.contentHash ||
          !input.correctionReason?.trim()
        )
          throw new QaDomainError("QA_RESULT_SUPERSESSION_PREDECESSOR_REQUIRED");
      }
      if (input.result === "NOT_RUN") {
        if (snapshot.attempts.length || snapshot.observations.length || !input.waiverRef)
          throw new QaDomainError("QA_RESULT_NOT_RUN_WAIVER_REQUIRED");
      } else {
        if (!snapshot.attempts.length) throw new QaDomainError("QA_RESULT_ATTEMPT_SET_EMPTY");
        if (!snapshot.observations.length)
          throw new QaDomainError("QA_RESULT_OBSERVATION_SET_EMPTY");
        if (input.waiverRef) throw new QaDomainError("QA_RESULT_WAIVER_FORBIDDEN");
      }
      for (const attempt of snapshot.attempts.filter(
        ({ result }) => result !== undefined && attemptRequiresEvidence(result),
      )) {
        if (
          !snapshot.observations.some(
            (observation) =>
              observation.attemptId === attempt.id && negativeObservation(observation.kind),
          )
        )
          throw new QaDomainError("FINDING_REQUIRED");
      }
      if (
        ["FAIL", "BLOCKED", "INCONCLUSIVE"].includes(input.result) &&
        !snapshot.observations.some(({ kind }) => negativeObservation(kind))
      )
        throw new QaDomainError("FINDING_REQUIRED");
      if (
        input.result === "PASS" &&
        !snapshot.observations.some(
          (observation) =>
            observation.kind === "POSITIVE" &&
            snapshot.attempts.some(
              (attempt) => attempt.id === observation.attemptId && attempt.result === "PASS",
            ),
        )
      )
        throw new QaDomainError("QA_RESULT_PASS_SOURCE_REQUIRED");
      const failedThenPassed =
        snapshot.attempts.some(({ result }) => result === "ASSERTION_FAILED") &&
        snapshot.attempts.some(({ result }) => result === "PASS");
      const flags = Object.freeze([...(input.reviewFlags ?? [])]);
      if (failedThenPassed && !flags.includes("FLAKY_SUSPECTED"))
        throw new QaDomainError("QA_FLAKY_FLAG_REQUIRED");
      if (
        flags.includes("FLAKY_SUSPECTED") &&
        input.result !== "INCONCLUSIVE" &&
        !(input.result === "PASS" && input.flakyDispositionBasis)
      )
        throw new QaDomainError("QA_FLAKY_DISPOSITION_BASIS_REQUIRED");
      if (
        (planItemResultRequiresEvidence(input.result) ||
          snapshot.attempts.some(
            ({ result }) => result !== undefined && attemptRequiresEvidence(result),
          )) &&
        !input.evidenceLinkIds?.length
      )
        throw new QaDomainError("QA_RESULT_EVIDENCE_REQUIRED");
      const result = createQaPlanItemResultRevision({
        id: randomUUID(),
        version: existing.length + 1,
        ...(input.previousRevisionRef === undefined
          ? {}
          : { previousRevisionRef: input.previousRevisionRef }),
        ...(input.correctionReason === undefined
          ? {}
          : { correctionReason: input.correctionReason }),
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        workItemId: session.workItemId,
        sessionId: session.id,
        planItemId: item.id,
        consideredAttemptRefs: snapshot.attempts.map(({ id, contentHash }) => ({
          id,
          contentHash,
        })),
        consideredAttemptSetHash: snapshot.attemptSetHash,
        consideredObservationRefs: snapshot.observations
          .map(({ id, contentHash }) => ({ id, contentHash }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        consideredObservationSetHash: snapshot.observationSetHash,
        maximumAttemptNo: snapshot.maximumAttemptNo,
        reviewFlags: flags,
        result: input.result,
        actualOutcome: input.actualOutcome,
        decisionReason: input.decisionReason,
        evidenceLinkIds: input.evidenceLinkIds ?? [],
        ...(input.waiverRef === undefined ? {} : { waiverRef: input.waiverRef }),
        ...(input.flakyDispositionBasis
          ? { flakyDispositionBasis: input.flakyDispositionBasis }
          : {}),
        recordedBy: input.actor,
        recordedAt: input.at,
      });
      this.repository.saveResult(result);
      this.repository.updatePlanItem({
        ...item,
        state: input.result === "NOT_RUN" ? "WAIVED" : "TERMINAL",
        latestResultRevisionRef: {
          id: result.id,
          version: result.version,
          contentHash: result.contentHash,
        },
      });
      return Object.freeze({ result, session: this.repository.advanceSession() });
    });
  }
}

export class TypeOrmRecordPlanItemResultService {
  constructor(private readonly source: DataSource) {}
  async record(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      sessionId: string;
      planItemId: string;
      result: QaPlanItemHumanResult;
      actualOutcome: string;
      decisionReason: string;
      reviewFlags?: readonly "FLAKY_SUSPECTED"[];
      evidenceLinkIds?: readonly string[];
      waiverRef?: Readonly<{ id: string; contentHash: QaContentHash }>;
      flakyDispositionBasis?: QaFlakyDispositionBasis;
      previousRevisionRef?: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
      correctionReason?: string;
      actor: QaHumanActor;
      expectedSessionVersion: number;
      expectedMaximumAttemptNo: number;
      expectedAttemptSetHash: QaContentHash;
      expectedObservationSetHash: QaContentHash;
      at: string;
    }>,
  ) {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `qa-session:${input.workspaceId}:${input.projectId}:${input.sessionId}`,
      ]);
      const scope = { workspaceId: input.workspaceId, projectId: input.projectId };
      const repository = new TypeOrmManualExecutionRepository(manager);
      const session = await repository.session(scope, input.sessionId);
      if (!session) throw new QaDomainError("QA_SESSION_NOT_FOUND");
      if (session.resourceVersion !== input.expectedSessionVersion)
        throw new QaDomainError("QA_SESSION_STALE_VERSION");
      if (session.state === "COMPLETED")
        throw new QaDomainError("QA_SESSION_REVIEWED_EXECUTION_FROZEN");
      const item = await repository.planItem(scope, input.sessionId, input.planItemId);
      if (!item || item.state === "WAIVED")
        throw new QaDomainError("QA_PLAN_ITEM_EXECUTION_CLOSED");
      const snapshot = await repository.snapshot(scope, input.planItemId);
      const allAttempts = await repository.attempts(scope, input.planItemId);
      if (allAttempts.some(({ state }) => state === "RUNNING"))
        throw new QaDomainError("QA_RESULT_RUNNING_ATTEMPT");
      if (
        snapshot.maximumAttemptNo !== input.expectedMaximumAttemptNo ||
        snapshot.attemptSetHash !== input.expectedAttemptSetHash ||
        snapshot.observationSetHash !== input.expectedObservationSetHash
      )
        throw new QaDomainError("QA_RESULT_EXPECTED_SET_STALE");
      if (snapshot.attempts.some((attempt, index) => attempt.attemptNo !== index + 1))
        throw new QaDomainError("QA_RESULT_ATTEMPT_SEQUENCE_GAPPED");
      const previous = snapshot.resultRevisions.at(-1);
      if (!previous && (input.previousRevisionRef || input.correctionReason))
        throw new QaDomainError("QA_RESULT_INITIAL_PREDECESSOR_FORBIDDEN");
      if (
        previous &&
        (!input.previousRevisionRef ||
          input.previousRevisionRef.id !== previous.id ||
          input.previousRevisionRef.version !== previous.version ||
          input.previousRevisionRef.contentHash !== previous.contentHash ||
          !input.correctionReason?.trim())
      )
        throw new QaDomainError("QA_RESULT_SUPERSESSION_PREDECESSOR_REQUIRED");
      if (input.result === "NOT_RUN") {
        if (snapshot.attempts.length || snapshot.observations.length || !input.waiverRef)
          throw new QaDomainError("QA_RESULT_NOT_RUN_WAIVER_REQUIRED");
        const waivers = (await manager.query(
          "SELECT state,waiver_kind,content_hash,expires_at,work_item_id FROM qa_waivers WHERE waiver_id=$1 AND workspace_id=$2 AND project_id=$3",
          [input.waiverRef.id, input.workspaceId, input.projectId],
        )) as readonly Readonly<{
          state: string;
          waiver_kind: string;
          content_hash: string;
          expires_at: Date | string;
          work_item_id: string;
        }>[];
        const waiver = (Array.isArray(waivers[0]) ? waivers[0][0] : waivers[0]) as
          | Readonly<{
              state: string;
              waiver_kind: string;
              content_hash: string;
              expires_at: Date | string;
              work_item_id: string;
            }>
          | undefined;
        if (
          !waiver ||
          waiver.state !== "APPROVED" ||
          waiver.waiver_kind !== "PLAN_ITEM" ||
          waiver.content_hash !== input.waiverRef.contentHash ||
          waiver.work_item_id !== session.workItemId ||
          Date.parse(String(waiver.expires_at)) <= Date.parse(input.at)
        )
          throw new QaDomainError("QA_PLAN_ITEM_WAIVER_NOT_LIVE");
      } else if (!snapshot.attempts.length || !snapshot.observations.length)
        throw new QaDomainError(
          !snapshot.attempts.length
            ? "QA_RESULT_ATTEMPT_SET_EMPTY"
            : "QA_RESULT_OBSERVATION_SET_EMPTY",
        );
      for (const attempt of snapshot.attempts.filter(
        ({ result }) => result !== undefined && attemptRequiresEvidence(result),
      ))
        if (
          !snapshot.observations.some(
            (observation) =>
              observation.attemptId === attempt.id && negativeObservation(observation.kind),
          )
        )
          throw new QaDomainError("FINDING_REQUIRED");
      if (
        ["FAIL", "BLOCKED", "INCONCLUSIVE"].includes(input.result) &&
        !snapshot.observations.some(({ kind }) => negativeObservation(kind))
      )
        throw new QaDomainError("FINDING_REQUIRED");
      if (
        input.result === "PASS" &&
        !snapshot.observations.some(
          (observation) =>
            observation.kind === "POSITIVE" &&
            snapshot.attempts.some(
              (attempt) => attempt.id === observation.attemptId && attempt.result === "PASS",
            ),
        )
      )
        throw new QaDomainError("QA_RESULT_PASS_SOURCE_REQUIRED");
      const failedThenPassed =
        snapshot.attempts.some(({ result }) => result === "ASSERTION_FAILED") &&
        snapshot.attempts.some(({ result }) => result === "PASS");
      const flags = Object.freeze([...(input.reviewFlags ?? [])]);
      if (failedThenPassed && !flags.includes("FLAKY_SUSPECTED"))
        throw new QaDomainError("QA_FLAKY_FLAG_REQUIRED");
      if (
        flags.includes("FLAKY_SUSPECTED") &&
        input.result !== "INCONCLUSIVE" &&
        !(input.result === "PASS" && input.flakyDispositionBasis)
      )
        throw new QaDomainError("QA_FLAKY_DISPOSITION_BASIS_REQUIRED");
      if (input.flakyDispositionBasis) {
        const basis = input.flakyDispositionBasis;
        const reviewRows = (await manager.query(
          "SELECT f.state,f.current_review_revision_id,r.version,r.content_hash,r.active_membership_set_hash,r.policy_ref FROM qa_findings f JOIN qa_finding_review_revisions r ON r.finding_review_revision_id=f.current_review_revision_id WHERE f.workspace_id=$1 AND f.project_id=$2 AND f.work_item_id=$3 AND f.session_id=$4 AND f.finding_id=$5 FOR UPDATE OF f,r",
          [
            input.workspaceId,
            input.projectId,
            session.workItemId,
            input.sessionId,
            basis.findingId,
          ],
        )) as readonly unknown[];
        const review = (Array.isArray(reviewRows[0]) ? reviewRows[0][0] : reviewRows[0]) as
          | Readonly<{
              state: string;
              current_review_revision_id: string;
              version: number | string;
              content_hash: string;
              active_membership_set_hash: string;
              policy_ref: unknown;
            }>
          | undefined;
        if (
          !review ||
          review.state !== "DISPOSED" ||
          review.current_review_revision_id !== basis.disposedFindingReviewRef.id ||
          Number(review.version) !== basis.disposedFindingReviewRef.version ||
          review.content_hash !== basis.disposedFindingReviewRef.contentHash ||
          review.active_membership_set_hash !== basis.activeMembershipSetHash
        )
          throw new QaDomainError("QA_FLAKY_FINDING_BASIS_STALE");
        const failed = snapshot.attempts
          .filter(({ result }) => result === "ASSERTION_FAILED")
          .map(({ id, contentHash }) => ({ id, contentHash }));
        if (
          qaAggregateSnapshotHash(failed as never) !== basis.failedAttemptSetHash ||
          failed
            .map(({ id }) => id)
            .sort()
            .join("\n") !==
            basis.failedAttemptRefs
              .map(({ id }) => id)
              .sort()
              .join("\n")
        )
          throw new QaDomainError("QA_FLAKY_FAILED_ATTEMPT_SET_STALE");
        const membershipRows = (await manager.query(
          "SELECT fo.membership_id,o.observation_id,o.attempt_id,o.content_hash,o.kind,o.plan_item_id FROM qa_finding_observations fo JOIN qa_observations o ON o.observation_id=fo.observation_id AND o.workspace_id=fo.workspace_id AND o.project_id=fo.project_id WHERE fo.workspace_id=$1 AND fo.project_id=$2 AND fo.finding_id=$3 AND fo.state='ACTIVE' ORDER BY o.observation_id",
          [input.workspaceId, input.projectId, basis.findingId],
        )) as readonly unknown[];
        const members = (
          Array.isArray(membershipRows[0]) ? membershipRows[0] : membershipRows
        ) as readonly Readonly<{
          membership_id: string;
          observation_id: string;
          attempt_id: string;
          content_hash: QaContentHash;
          kind: string;
          plan_item_id: string;
        }>[];
        const valid = members
          .filter(
            (row) =>
              row.plan_item_id === input.planItemId &&
              failed.some(({ id }) => id === row.attempt_id) &&
              (row.kind === "NEGATIVE" || row.kind === "AMBIGUOUS"),
          )
          .map((row) => ({
            id: row.observation_id,
            attemptId: row.attempt_id,
            membershipId: row.membership_id,
            contentHash: row.content_hash,
          }));
        if (
          qaAggregateSnapshotHash(valid as never) !== basis.flakyObservationSetHash ||
          valid.map(({ id }) => id).join("\n") !==
            basis.flakyObservationRefs
              .map(({ id }) => id)
              .sort()
              .join("\n")
        )
          throw new QaDomainError("QA_FLAKY_OBSERVATION_SET_STALE");
      }
      if (
        (planItemResultRequiresEvidence(input.result) ||
          snapshot.attempts.some(
            ({ result }) => result !== undefined && attemptRequiresEvidence(result),
          )) &&
        !input.evidenceLinkIds?.length
      )
        throw new QaDomainError("QA_RESULT_EVIDENCE_REQUIRED");
      const result = createQaPlanItemResultRevision({
        id: randomUUID(),
        version: snapshot.resultRevisions.length + 1,
        ...(input.previousRevisionRef ? { previousRevisionRef: input.previousRevisionRef } : {}),
        ...(input.correctionReason ? { correctionReason: input.correctionReason } : {}),
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        workItemId: session.workItemId,
        sessionId: input.sessionId,
        planItemId: input.planItemId,
        consideredAttemptRefs: snapshot.attempts.map(({ id, contentHash }) => ({
          id,
          contentHash,
        })),
        consideredAttemptSetHash: snapshot.attemptSetHash,
        consideredObservationRefs: snapshot.observations
          .map(({ id, contentHash }) => ({ id, contentHash }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        consideredObservationSetHash: snapshot.observationSetHash,
        maximumAttemptNo: snapshot.maximumAttemptNo,
        reviewFlags: flags,
        result: input.result,
        actualOutcome: input.actualOutcome,
        decisionReason: input.decisionReason,
        evidenceLinkIds: input.evidenceLinkIds ?? [],
        ...(input.waiverRef ? { waiverRef: input.waiverRef } : {}),
        ...(input.flakyDispositionBasis
          ? { flakyDispositionBasis: input.flakyDispositionBasis }
          : {}),
        recordedBy: input.actor,
        recordedAt: input.at,
      });
      const sessionResourceVersion = await new ManualExecutionUnitOfWork(manager).persistResult(
        result,
        input.expectedSessionVersion,
      );
      return Object.freeze({ result, sessionResourceVersion });
    });
  }

  async recordAutomated(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      sessionId: string;
      planItemId: string;
      result: QaPlanItemHumanResult;
      actualOutcome: string;
      decisionReason: string;
      reviewFlags?: readonly "FLAKY_SUSPECTED"[];
      evidenceLinkIds?: readonly string[];
      flakyDispositionBasis?: QaFlakyDispositionBasis;
      actor: QaHumanActor;
      expectedSessionVersion: number;
      expectedAttemptSetHash: QaContentHash;
      riskReviewerPolicy: QaAutomationRiskReviewerPolicy;
      at: string;
    }>,
  ) {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `qa-session:${input.workspaceId}:${input.projectId}:${input.sessionId}`,
      ]);
      const sessionRows = (await manager.query(
        `
SELECT work_item_id,state,mode,resource_version
FROM qa_test_sessions
WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3
FOR UPDATE`,
        [input.workspaceId, input.projectId, input.sessionId],
      )) as readonly unknown[];
      const session = (Array.isArray(sessionRows[0]) ? sessionRows[0][0] : sessionRows[0]) as
        | Readonly<{
            work_item_id: string;
            state: string;
            mode: string;
            resource_version: string | number;
          }>
        | undefined;
      if (!session || session.mode !== "AUTOMATED")
        throw new QaDomainError("QA_AUTOMATED_SESSION_NOT_FOUND");
      if (session.state !== "REVIEW_REQUIRED")
        throw new QaDomainError("QA_SESSION_REVIEW_STATE_INVALID");
      if (Number(session.resource_version) !== input.expectedSessionVersion)
        throw new QaDomainError("QA_SESSION_STALE_VERSION");
      const itemRows = (await manager.query(
        `
SELECT state,latest_result_revision_id
FROM qa_plan_items
WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 AND plan_item_id=$4
FOR UPDATE`,
        [input.workspaceId, input.projectId, input.sessionId, input.planItemId],
      )) as readonly unknown[];
      const item = (Array.isArray(itemRows[0]) ? itemRows[0][0] : itemRows[0]) as
        | Readonly<{
            state: string;
            latest_result_revision_id: string | null;
          }>
        | undefined;
      if (!item) throw new QaDomainError("QA_PLAN_ITEM_NOT_FOUND");
      if (item.state === "TERMINAL" || item.latest_result_revision_id)
        throw new QaDomainError("QA_PLAN_ITEM_EXECUTION_CLOSED");

      const attemptQuery = (await manager.query(
        `
SELECT attempt.attempt_id,attempt.attempt_no,attempt.current_status,attempt.terminal_result_id,
       result.content_hash AS result_content_hash,result.technical_outcome,
       retry.decision AS retry_decision,retry.content_hash AS retry_content_hash,retry.successor_attempt_id,
       command.state AS command_state,
       CASE WHEN EXISTS(
         SELECT 1 FROM qa_automation_artifact_memberships membership
         JOIN artifact_references artifact ON artifact.workspace_id=membership.workspace_id
           AND artifact.project_id=membership.project_id AND artifact.id=membership.artifact_reference_id
         WHERE membership.attempt_id=attempt.attempt_id
           AND membership.availability_at_result='AVAILABLE' AND artifact.availability='AVAILABLE'
       ) THEN true ELSE false END AS required_artifacts_available
FROM qa_automation_attempts attempt
LEFT JOIN qa_automation_attempt_results result ON result.attempt_id=attempt.attempt_id
LEFT JOIN qa_automation_retry_decisions retry ON retry.attempt_id=attempt.attempt_id
LEFT JOIN connector_commands command ON command.id=attempt.connector_command_id
WHERE attempt.workspace_id=$1 AND attempt.project_id=$2 AND attempt.session_id=$3 AND attempt.plan_item_id=$4
ORDER BY attempt.attempt_no
FOR UPDATE OF attempt`,
        [input.workspaceId, input.projectId, input.sessionId, input.planItemId],
      )) as readonly unknown[];
      const attemptRows = (
        Array.isArray(attemptQuery[0]) ? attemptQuery[0] : attemptQuery
      ) as readonly Readonly<Record<string, unknown>>[];

      const findingQuery = (await manager.query(
        `
SELECT finding.finding_id,finding.state,review.stage,review.classification,review.severity,
       review.disposition_decision,review.classification_actor,review.disposition_actor,
       review.accepted_risk_action_ref,review.waiver_action_ref
FROM qa_findings finding
LEFT JOIN qa_finding_review_revisions review ON review.finding_review_revision_id=finding.current_review_revision_id
WHERE finding.workspace_id=$1 AND finding.project_id=$2 AND finding.session_id=$3
ORDER BY finding.finding_id
FOR UPDATE OF finding`,
        [input.workspaceId, input.projectId, input.sessionId],
      )) as readonly unknown[];
      const findingRows = (
        Array.isArray(findingQuery[0]) ? findingQuery[0] : findingQuery
      ) as readonly Readonly<Record<string, unknown>>[];
      const actorId = (value: unknown): string | undefined => {
        const parsed =
          typeof value === "string"
            ? (JSON.parse(value) as Readonly<Record<string, unknown>>)
            : (value as Readonly<Record<string, unknown>> | null);
        return parsed && typeof parsed.principalId === "string" ? parsed.principalId : undefined;
      };
      const readiness = evaluateQaAutomationReviewReadiness({
        actor: input.actor,
        attempts: attemptRows.map((row) => ({
          attemptId: String(row.attempt_id),
          attemptNo: Number(row.attempt_no),
          ...(row.terminal_result_id ? { resultId: String(row.terminal_result_id) } : {}),
          ...(row.result_content_hash
            ? { resultContentHash: String(row.result_content_hash) as QaContentHash }
            : {}),
          ...(row.technical_outcome
            ? {
                outcome: String(row.technical_outcome) as
                  | "PASS"
                  | "ASSERTION_FAILED"
                  | "INFRA_FAILED"
                  | "TIMEOUT"
                  | "CANCELLED"
                  | "INCOMPLETE",
              }
            : {}),
          status: String(row.current_status) as
            "CREATED" | "TRIGGER_PENDING" | "RUNNING" | "TERMINAL",
          commandState: String(row.command_state) as
            | "QUEUED"
            | "DISPATCHED"
            | "EXECUTING"
            | "CONFIRMED"
            | "CONFLICT"
            | "FAILED"
            | "CANCELLED",
          ...(row.retry_decision
            ? {
                retryDecision: {
                  decision: String(row.retry_decision) as "NOT_APPLICABLE" | "DENIED" | "SCHEDULED",
                  contentHash: String(row.retry_content_hash) as QaContentHash,
                  ...(row.successor_attempt_id
                    ? { successorAttemptId: String(row.successor_attempt_id) }
                    : {}),
                },
              }
            : {}),
          requiredArtifactsAvailable: row.required_artifacts_available === true,
        })),
        expectedAttemptSetHash: input.expectedAttemptSetHash,
        findings: findingRows.map((row) => ({
          findingId: String(row.finding_id),
          ...(row.classification
            ? {
                classification: String(row.classification) as
                  "PRODUCT" | "INFRA" | "INCONCLUSIVE" | "DUPLICATE" | "ACCEPTED_RISK",
              }
            : {}),
          ...(row.severity
            ? { severity: String(row.severity) as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" }
            : {}),
          stage: String(row.stage ?? row.state) as "DRAFT" | "CLASSIFIED" | "DISPOSED" | "FROZEN",
          ...(row.disposition_decision
            ? {
                dispositionDecision: String(row.disposition_decision) as
                  | "CREATE_DEFECT"
                  | "DUPLICATE"
                  | "NOT_A_BUG"
                  | "ACCEPTED_RISK"
                  | "DEFERRED"
                  | "WAIVED",
              }
            : {}),
          ...(actorId(row.classification_actor)
            ? { classificationActorId: actorId(row.classification_actor)! }
            : {}),
          ...(actorId(row.disposition_actor)
            ? { dispositionActorId: actorId(row.disposition_actor)! }
            : {}),
          acceptedRiskActionLive:
            row.accepted_risk_action_ref !== null && row.accepted_risk_action_ref !== undefined,
          waiverActionLive: row.waiver_action_ref !== null && row.waiver_action_ref !== undefined,
        })),
        ...(input.flakyDispositionBasis
          ? { flakyDispositionBasis: input.flakyDispositionBasis }
          : {}),
        riskReviewerPolicy: input.riskReviewerPolicy,
      });
      assertQaAutomationPlanItemResultReview({
        readiness,
        expectedAttemptSetHash: input.expectedAttemptSetHash,
        result: input.result,
        reviewFlags: input.reviewFlags ?? [],
        ...(input.flakyDispositionBasis
          ? { flakyDispositionBasis: input.flakyDispositionBasis }
          : {}),
      });

      const observationQuery = (await manager.query(
        `
SELECT observation_id,content_hash
FROM qa_observations observation
WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 AND plan_item_id=$4
  AND NOT EXISTS(SELECT 1 FROM qa_observations successor WHERE successor.corrects_observation_id=observation.observation_id)
ORDER BY observation_id`,
        [input.workspaceId, input.projectId, input.sessionId, input.planItemId],
      )) as readonly unknown[];
      const observations = (
        Array.isArray(observationQuery[0]) ? observationQuery[0] : observationQuery
      ) as readonly Readonly<{ observation_id: string; content_hash: QaContentHash }>[];
      if (observations.length === 0) throw new QaDomainError("QA_RESULT_OBSERVATION_SET_EMPTY");
      const attemptRefs = attemptRows.map((row) =>
        Object.freeze({
          id: String(row.attempt_id),
          contentHash: String(row.result_content_hash) as QaContentHash,
        }),
      );
      const observationRefs = observations.map((row) =>
        Object.freeze({ id: row.observation_id, contentHash: row.content_hash }),
      );
      const result = createQaPlanItemResultRevision({
        id: randomUUID(),
        version: 1,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        workItemId: session.work_item_id,
        sessionId: input.sessionId,
        planItemId: input.planItemId,
        consideredAttemptRefs: attemptRefs,
        consideredAttemptSetHash: readiness.attemptSetHash,
        consideredObservationRefs: observationRefs,
        consideredObservationSetHash: qaAggregateSnapshotHash(observationRefs as never),
        maximumAttemptNo: readiness.maximumAttemptNo,
        reviewFlags: Object.freeze([...(input.reviewFlags ?? [])]),
        result: input.result,
        actualOutcome: input.actualOutcome,
        decisionReason: input.decisionReason,
        evidenceLinkIds: input.evidenceLinkIds ?? [],
        ...(input.flakyDispositionBasis
          ? { flakyDispositionBasis: input.flakyDispositionBasis }
          : {}),
        recordedBy: input.actor,
        recordedAt: input.at,
      });
      const sessionResourceVersion = await new ManualExecutionUnitOfWork(manager).persistResult(
        result,
        input.expectedSessionVersion,
        "AUTOMATED",
      );
      return Object.freeze({ result, readiness, sessionResourceVersion });
    });
  }
}
