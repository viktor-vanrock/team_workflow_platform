import type { QaAutomationTechnicalResult } from "../domain/automation-attempt.ts";
import type {
  QaFindingClassification,
  QaFindingDispositionDecision,
  QaFindingSeverity,
} from "../domain/finding.ts";
import type { QaFlakyDispositionBasis } from "../domain/plan-item-result.ts";
import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  type QaHumanActor,
} from "../domain/primitives.ts";

export interface QaAutomationReviewAttemptFact {
  readonly attemptId: string;
  readonly attemptNo: number;
  readonly resultId?: string;
  readonly resultContentHash?: QaContentHash;
  readonly outcome?: QaAutomationTechnicalResult;
  readonly status: "CREATED" | "TRIGGER_PENDING" | "RUNNING" | "TERMINAL";
  readonly commandState:
    "QUEUED" | "DISPATCHED" | "EXECUTING" | "CONFIRMED" | "CONFLICT" | "FAILED" | "CANCELLED";
  readonly retryDecision?: Readonly<{
    decision: "NOT_APPLICABLE" | "DENIED" | "SCHEDULED";
    contentHash: QaContentHash;
    successorAttemptId?: string;
  }>;
  readonly requiredArtifactsAvailable: boolean;
}

export interface QaAutomationReviewFindingFact {
  readonly findingId: string;
  readonly classification?: QaFindingClassification;
  readonly severity?: QaFindingSeverity;
  readonly stage: "DRAFT" | "CLASSIFIED" | "DISPOSED" | "FROZEN";
  readonly dispositionDecision?: QaFindingDispositionDecision;
  readonly classificationActorId?: string;
  readonly dispositionActorId?: string;
  readonly acceptedRiskActionLive?: boolean;
  readonly waiverActionLive?: boolean;
}

export interface QaAutomationRiskReviewerPolicy {
  readonly policyRef: string;
  readonly policyHash: QaContentHash;
  readonly highAndCriticalRequireDistinctReviewer: boolean;
  readonly waiverRequiresDistinctReviewer: boolean;
  readonly eligibleReviewerIds: readonly string[];
}

export interface QaAutomationReviewBlocker {
  readonly code:
    | "QA_AUTOMATION_ATTEMPT_SET_EMPTY"
    | "QA_AUTOMATION_ATTEMPT_SET_STALE"
    | "QA_AUTOMATION_ATTEMPT_SEQUENCE_GAPPED"
    | "QA_AUTOMATION_ATTEMPT_NONTERMINAL"
    | "QA_AUTOMATION_RESULT_MISSING"
    | "QA_AUTOMATION_RETRY_UNSETTLED"
    | "QA_AUTOMATION_RETRY_SUCCESSOR_UNSETTLED"
    | "QA_AUTOMATION_COMMAND_UNSETTLED"
    | "QA_AUTOMATION_ARTIFACT_EVIDENCE_UNAVAILABLE"
    | "FINDING_REQUIRED"
    | "QA_FINDING_TAXONOMY_INVALID"
    | "QA_FINDING_DISPOSITION_REQUIRED"
    | "QA_FINDING_ACCEPTED_RISK_APPROVAL_REQUIRED"
    | "QA_FINDING_WAIVER_APPROVAL_REQUIRED"
    | "QA_FLAKY_DISPOSITION_BASIS_REQUIRED"
    | "QA_FLAKY_DISPOSITION_SET_STALE"
    | "QA_RISK_REVIEWER_REQUIRED"
    | "QA_WAIVER_REVIEWER_REQUIRED"
    | "QA_VERIFIED_HUMAN_REQUIRED";
  readonly subjectId?: string;
}

export interface QaAutomationReviewReadiness {
  readonly reviewable: boolean;
  readonly attemptSetHash: QaContentHash;
  readonly maximumAttemptNo: number;
  readonly attemptCount: number;
  readonly resultSetHash: QaContentHash;
  readonly retryDecisionSetHash: QaContentHash;
  readonly reviewFlags: readonly "FLAKY_SUSPECTED"[];
  readonly blockers: readonly QaAutomationReviewBlocker[];
  readonly quarantineWarnings: readonly Readonly<{
    quarantineId: string;
    revisionId: string;
    revisionHash: QaContentHash;
    effectiveState: "ACTIVE" | "EXPIRED";
  }>[];
}

const taxonomy = new Set<QaFindingClassification>([
  "PRODUCT",
  "INFRA",
  "INCONCLUSIVE",
  "DUPLICATE",
  "ACCEPTED_RISK",
]);
const dispositions: Readonly<
  Record<QaFindingClassification, readonly QaFindingDispositionDecision[]>
> = Object.freeze({
  PRODUCT: Object.freeze<QaFindingDispositionDecision[]>(["CREATE_DEFECT", "DEFERRED", "WAIVED"]),
  INFRA: Object.freeze<QaFindingDispositionDecision[]>(["NOT_A_BUG", "DEFERRED", "WAIVED"]),
  INCONCLUSIVE: Object.freeze<QaFindingDispositionDecision[]>(["DEFERRED", "WAIVED"]),
  DUPLICATE: Object.freeze<QaFindingDispositionDecision[]>(["DUPLICATE"]),
  ACCEPTED_RISK: Object.freeze<QaFindingDispositionDecision[]>(["ACCEPTED_RISK"]),
});
const terminalCommands = new Set<QaAutomationReviewAttemptFact["commandState"]>([
  "CONFIRMED",
  "CONFLICT",
  "FAILED",
  "CANCELLED",
]);

function exactRefs(
  refs: readonly Readonly<{ id: string; contentHash: QaContentHash }>[],
): QaContentHash {
  return qaAggregateSnapshotHash(
    [...refs].sort((left, right) => left.id.localeCompare(right.id)) as never,
  );
}

function flakyBasisCurrent(
  basis: QaFlakyDispositionBasis,
  failed: readonly Readonly<{ id: string; contentHash: QaContentHash }>[],
  findings: readonly QaAutomationReviewFindingFact[],
): boolean {
  const expected = [...failed].sort((left, right) => left.id.localeCompare(right.id));
  const supplied = [...basis.failedAttemptRefs].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const finding = findings.find(({ findingId }) => findingId === basis.findingId);
  return (
    basis.findingState === "DISPOSED" &&
    finding?.stage === "DISPOSED" &&
    exactRefs(expected) === basis.failedAttemptSetHash &&
    exactRefs(supplied) === basis.failedAttemptSetHash &&
    expected.length === supplied.length &&
    expected.every(
      (ref, index) =>
        ref.id === supplied[index]?.id && ref.contentHash === supplied[index]?.contentHash,
    ) &&
    qaAggregateSnapshotHash(basis.flakyObservationRefs as never) === basis.flakyObservationSetHash
  );
}

export function evaluateQaAutomationReviewReadiness(
  input: Readonly<{
    actor: QaHumanActor;
    attempts: readonly QaAutomationReviewAttemptFact[];
    expectedAttemptSetHash?: QaContentHash;
    findings: readonly QaAutomationReviewFindingFact[];
    flakyDispositionBasis?: QaFlakyDispositionBasis;
    riskReviewerPolicy: QaAutomationRiskReviewerPolicy;
    quarantineWarnings?: readonly Readonly<{
      quarantineId: string;
      revisionId: string;
      revisionHash: QaContentHash;
      effectiveState: "ACTIVE" | "EXPIRED";
    }>[];
  }>,
): QaAutomationReviewReadiness {
  const attempts = [...input.attempts].sort(
    (left, right) =>
      left.attemptNo - right.attemptNo || left.attemptId.localeCompare(right.attemptId),
  );
  const attemptRefs = attempts.map(({ attemptId: id, resultContentHash }) => ({
    id,
    contentHash:
      resultContentHash ??
      qaAggregateSnapshotHash({ attemptId: id, resultState: "MISSING" } as never),
  }));
  const attemptSetHash = qaAggregateSnapshotHash(attemptRefs as never);
  const resultSetHash = qaAggregateSnapshotHash(
    attempts.flatMap(({ resultId, resultContentHash }) =>
      resultId && resultContentHash ? [{ id: resultId, contentHash: resultContentHash }] : [],
    ) as never,
  );
  const retryDecisionSetHash = qaAggregateSnapshotHash(
    attempts.flatMap(({ attemptId, retryDecision }) =>
      retryDecision ? [{ attemptId, contentHash: retryDecision.contentHash }] : [],
    ) as never,
  );
  const blockers: QaAutomationReviewBlocker[] = [];
  const block = (code: QaAutomationReviewBlocker["code"], subjectId?: string) =>
    blockers.push(Object.freeze({ code, ...(subjectId === undefined ? {} : { subjectId }) }));

  if (
    input.actor.kind !== "HUMAN" ||
    !input.actor.principalId ||
    !input.actor.issuer ||
    !input.actor.subject
  )
    block("QA_VERIFIED_HUMAN_REQUIRED");
  if (attempts.length === 0) block("QA_AUTOMATION_ATTEMPT_SET_EMPTY");
  if (input.expectedAttemptSetHash !== undefined && input.expectedAttemptSetHash !== attemptSetHash)
    block("QA_AUTOMATION_ATTEMPT_SET_STALE");
  if (attempts.some((attempt, index) => attempt.attemptNo !== index + 1))
    block("QA_AUTOMATION_ATTEMPT_SEQUENCE_GAPPED");

  for (const attempt of attempts) {
    if (attempt.status !== "TERMINAL")
      block("QA_AUTOMATION_ATTEMPT_NONTERMINAL", attempt.attemptId);
    if (!attempt.resultId || !attempt.resultContentHash || !attempt.outcome)
      block("QA_AUTOMATION_RESULT_MISSING", attempt.attemptId);
    if (!attempt.retryDecision) block("QA_AUTOMATION_RETRY_UNSETTLED", attempt.attemptId);
    if (!terminalCommands.has(attempt.commandState))
      block("QA_AUTOMATION_COMMAND_UNSETTLED", attempt.attemptId);
    if (!attempt.requiredArtifactsAvailable)
      block("QA_AUTOMATION_ARTIFACT_EVIDENCE_UNAVAILABLE", attempt.attemptId);
    if (attempt.retryDecision?.decision === "SCHEDULED") {
      const successor = attempts.find(
        ({ attemptId }) => attemptId === attempt.retryDecision?.successorAttemptId,
      );
      if (
        !successor ||
        successor.status !== "TERMINAL" ||
        !successor.resultId ||
        !successor.retryDecision
      ) {
        block("QA_AUTOMATION_RETRY_SUCCESSOR_UNSETTLED", attempt.attemptId);
      }
    }
  }

  const needsFinding = attempts.some(
    ({ outcome }) => outcome !== undefined && outcome !== "PASS" && outcome !== "CANCELLED",
  );
  if (needsFinding && input.findings.length === 0) block("FINDING_REQUIRED");
  const eligibleReviewers = new Set(input.riskReviewerPolicy.eligibleReviewerIds);
  for (const finding of input.findings) {
    if (!finding.classification || !taxonomy.has(finding.classification)) {
      block("QA_FINDING_TAXONOMY_INVALID", finding.findingId);
      continue;
    }
    if (
      !finding.dispositionDecision ||
      !dispositions[finding.classification].includes(finding.dispositionDecision) ||
      !["DISPOSED", "FROZEN"].includes(finding.stage)
    ) {
      block("QA_FINDING_DISPOSITION_REQUIRED", finding.findingId);
      continue;
    }
    if (finding.classification === "ACCEPTED_RISK" && !finding.acceptedRiskActionLive)
      block("QA_FINDING_ACCEPTED_RISK_APPROVAL_REQUIRED", finding.findingId);
    if (finding.dispositionDecision === "WAIVED" && !finding.waiverActionLive)
      block("QA_FINDING_WAIVER_APPROVAL_REQUIRED", finding.findingId);
    const distinct =
      input.actor.principalId !== finding.classificationActorId &&
      input.actor.principalId !== finding.dispositionActorId;
    const reviewerEligible = eligibleReviewers.has(input.actor.principalId);
    if (
      input.riskReviewerPolicy.highAndCriticalRequireDistinctReviewer &&
      ["HIGH", "CRITICAL"].includes(finding.severity ?? "") &&
      (!distinct || !reviewerEligible)
    ) {
      block("QA_RISK_REVIEWER_REQUIRED", finding.findingId);
    }
    if (
      input.riskReviewerPolicy.waiverRequiresDistinctReviewer &&
      finding.dispositionDecision === "WAIVED" &&
      (!distinct || !reviewerEligible)
    ) {
      block("QA_WAIVER_REVIEWER_REQUIRED", finding.findingId);
    }
  }

  const failedAssertions = attempts
    .filter(({ outcome }) => outcome === "ASSERTION_FAILED")
    .flatMap(({ attemptId: id, resultContentHash: contentHash }) =>
      contentHash ? [{ id, contentHash }] : [],
    );
  const passedAfterAssertion = attempts.some(
    (attempt) =>
      attempt.outcome === "PASS" &&
      failedAssertions.some(
        ({ id }) =>
          attempts.find(({ attemptId }) => attemptId === id)!.attemptNo < attempt.attemptNo,
      ),
  );
  const reviewFlags = passedAfterAssertion
    ? Object.freeze(["FLAKY_SUSPECTED"] as const)
    : Object.freeze([] as const);
  if (passedAfterAssertion) {
    if (!input.flakyDispositionBasis) block("QA_FLAKY_DISPOSITION_BASIS_REQUIRED");
    else if (!flakyBasisCurrent(input.flakyDispositionBasis, failedAssertions, input.findings))
      block("QA_FLAKY_DISPOSITION_SET_STALE", input.flakyDispositionBasis.findingId);
  }

  return Object.freeze({
    reviewable: blockers.length === 0,
    attemptSetHash,
    maximumAttemptNo: attempts.at(-1)?.attemptNo ?? 0,
    attemptCount: attempts.length,
    resultSetHash,
    retryDecisionSetHash,
    reviewFlags,
    blockers: Object.freeze(blockers),
    quarantineWarnings: Object.freeze([...(input.quarantineWarnings ?? [])]),
  });
}
