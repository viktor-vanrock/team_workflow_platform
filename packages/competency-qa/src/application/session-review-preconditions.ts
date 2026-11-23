import {
  attemptRequiresEvidence,
  planItemResultRequiresEvidence,
} from "../rules/evidence-policy.v1.ts";
import type { QaAutomationReviewReadiness } from "./automation-review-readiness.ts";

interface AttemptView {
  readonly attemptId: string;
  readonly planItemId: string;
  readonly attemptNo: number;
  readonly result:
    "PASS" | "ASSERTION_FAILED" | "INFRA_FAILED" | "TIMEOUT" | "CANCELLED" | "INCOMPLETE";
}
interface ObservationView {
  readonly observationId: string;
  readonly attemptId: string;
  readonly planItemId: string;
  readonly kind: "POSITIVE" | "NEGATIVE" | "AMBIGUOUS" | "INFORMATIONAL";
}
interface ResultView {
  readonly resultRevisionId: string;
  readonly planItemId: string;
  readonly result: "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN" | "INCONCLUSIVE";
  readonly attemptIds: readonly string[];
  readonly observationIds: readonly string[];
  readonly evidenceLinkIds?: readonly string[];
}
interface EvidenceView {
  readonly evidenceLinkId: string;
  readonly ownerType: "SESSION" | "PLAN_ITEM" | "ATTEMPT" | "OBSERVATION" | "RESULT" | "FINDING";
  readonly ownerId: string;
  readonly availability: "AVAILABLE" | "EXPIRED";
}

export function evaluateSessionReviewPreconditions(
  input: Readonly<{
    attempts: readonly AttemptView[];
    observations: readonly ObservationView[];
    results: readonly ResultView[];
    evidence: readonly EvidenceView[];
    waivers: readonly unknown[];
    findingLookup?: () => readonly unknown[];
    findingInventory?: readonly Readonly<{ stage: "FROZEN"; observationIds: readonly string[] }>[];
    automationReadiness?: QaAutomationReviewReadiness;
  }>,
): Readonly<{ reviewable: true } | { reviewable: false; code: string }> {
  if (input.automationReadiness && !input.automationReadiness.reviewable) {
    return Object.freeze({
      reviewable: false,
      code: input.automationReadiness.blockers[0]?.code ?? "QA_AUTOMATION_REVIEW_BLOCKED",
    });
  }
  let requiresFinding = false;
  const requiredNegativeObservationIds = new Set<string>();
  for (const result of input.results) {
    if (result.result === "NOT_RUN") continue;
    if (!result.attemptIds.length || !result.observationIds.length)
      return Object.freeze({ reviewable: false, code: "FINDING_REQUIRED" });
    const attempts = input.attempts.filter(({ attemptId }) =>
      result.attemptIds.includes(attemptId),
    );
    const observations = input.observations.filter(({ observationId }) =>
      result.observationIds.includes(observationId),
    );
    for (const attempt of attempts.filter(({ result: technical }) =>
      attemptRequiresEvidence(technical),
    )) {
      const coverage = observations.filter(
        (observation) =>
          observation.planItemId === attempt.planItemId &&
          observation.attemptId === attempt.attemptId &&
          (observation.kind === "NEGATIVE" || observation.kind === "AMBIGUOUS"),
      );
      if (!coverage.length) return Object.freeze({ reviewable: false, code: "FINDING_REQUIRED" });
      requiresFinding = true;
      for (const observation of coverage)
        requiredNegativeObservationIds.add(observation.observationId);
    }
    if (
      result.result === "PASS" &&
      !observations.some(
        (observation) =>
          observation.kind === "POSITIVE" &&
          attempts.some(
            (attempt) => attempt.attemptId === observation.attemptId && attempt.result === "PASS",
          ),
      )
    )
      return Object.freeze({ reviewable: false, code: "FINDING_REQUIRED" });
    if (["FAIL", "BLOCKED", "INCONCLUSIVE"].includes(result.result)) {
      const coverage = observations.filter(
        ({ kind }) => kind === "NEGATIVE" || kind === "AMBIGUOUS",
      );
      if (!coverage.length) return Object.freeze({ reviewable: false, code: "FINDING_REQUIRED" });
      requiresFinding = true;
      for (const observation of coverage)
        requiredNegativeObservationIds.add(observation.observationId);
    }
    if (attempts.some(({ result: technical }) => attemptRequiresEvidence(technical)))
      requiresFinding = true;
    if (requiresFinding && !input.findingInventory?.length)
      return Object.freeze({ reviewable: false, code: "FINDING_REQUIRED" });
    if (
      planItemResultRequiresEvidence(result.result) &&
      !input.evidence.some(
        ({ evidenceLinkId, ownerType, ownerId, availability }) =>
          availability === "AVAILABLE" &&
          ((result.evidenceLinkIds ?? []).includes(evidenceLinkId) ||
            (ownerType === "RESULT" && ownerId === result.resultRevisionId)),
      )
    )
      return Object.freeze({ reviewable: false, code: "QA_RESULT_EVIDENCE_REQUIRED" });
  }
  if (requiresFinding) {
    if (!input.findingInventory?.length)
      return Object.freeze({ reviewable: false, code: "FINDING_REQUIRED" });
    const covered = new Set(input.findingInventory.flatMap(({ observationIds }) => observationIds));
    if ([...requiredNegativeObservationIds].some((id) => !covered.has(id)))
      return Object.freeze({ reviewable: false, code: "FINDING_REQUIRED" });
  }
  return Object.freeze({ reviewable: true });
}
