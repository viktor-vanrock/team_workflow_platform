import { buildQaDodAssessment, type QaDodAssessment } from "../domain/dod.ts";
import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  type QaExactReference,
} from "../domain/primitives.ts";

interface RequiredSlot {
  readonly key: string;
  readonly minimumSessionCount: number;
  readonly resolution: "REQUIRED" | "WAIVED";
  readonly carriedForwardSessionReviewRefs: readonly QaExactReference[];
}

interface SessionReviewInventory extends QaExactReference {
  readonly requirementKey: string;
  readonly evidenceComplete: boolean;
  readonly current: boolean;
  readonly evidenceManifestRef?: QaExactReference;
}

interface FindingInventory {
  readonly id: string;
  readonly disposition: string;
  readonly frozen: boolean;
  readonly reviewRef?: QaExactReference;
  readonly draftChain: readonly Readonly<{
    state: string;
    defectLinkRef?: QaExactReference;
    rejectedByHuman?: boolean;
  }>[];
}

export interface EvaluateQaDodInput {
  readonly assessmentId: string;
  readonly version?: number;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly expectedAggregateSnapshotHash: QaContentHash;
  readonly currentAggregateSnapshotHash: QaContentHash;
  readonly requiredSessionPlan: QaExactReference &
    Readonly<{ requiredSlots: readonly RequiredSlot[] }>;
  readonly sessionReviews: readonly SessionReviewInventory[];
  readonly verdict: QaExactReference &
    Readonly<{ state: string; matchesAggregate: boolean; residualRiskPresent: boolean }>;
  readonly findings: readonly FindingInventory[];
  readonly waivers: readonly QaExactReference[];
  readonly evidencePolicySatisfied: boolean;
  readonly rules: QaExactReference;
  readonly riskPolicyRef: QaExactReference;
  readonly evaluatedBy: string;
  readonly evaluatedAt: string;
}

export function evaluateQaDod(input: EvaluateQaDodInput): QaDodAssessment {
  const blockers = new Set<string>();
  if (input.expectedAggregateSnapshotHash !== input.currentAggregateSnapshotHash)
    blockers.add("AGGREGATE_CHANGED");
  for (const slot of input.requiredSessionPlan.requiredSlots) {
    if (slot.resolution === "WAIVED") continue;
    const direct = input.sessionReviews.filter(
      ({ requirementKey, current }) => requirementKey === slot.key && current,
    );
    const exactCarry = slot.carriedForwardSessionReviewRefs.filter((ref) =>
      input.sessionReviews.some(
        (review) =>
          review.id === ref.id &&
          review.version === ref.version &&
          review.contentHash === ref.contentHash &&
          review.current,
      ),
    );
    const covered = new Set([...direct, ...exactCarry].map(({ id }) => id)).size;
    if (covered < slot.minimumSessionCount) blockers.add("REQUIRED_SESSION_REVIEW_MISSING");
  }
  if (
    !input.evidencePolicySatisfied ||
    input.sessionReviews.some(({ evidenceComplete }) => !evidenceComplete)
  )
    blockers.add("NEGATIVE_EVIDENCE_INCOMPLETE");
  if (input.verdict.state !== "SIGNED" || !input.verdict.residualRiskPresent)
    blockers.add("VERDICT_UNSIGNED");
  if (!input.verdict.matchesAggregate) blockers.add("VERDICT_STALE");

  const findingOutcomeRefs: QaExactReference[] = [];
  for (const finding of input.findings) {
    if (!finding.frozen) {
      blockers.add("FINDING_UNRESOLVED");
      continue;
    }
    if (finding.reviewRef) findingOutcomeRefs.push(finding.reviewRef);
    if (finding.disposition !== "CREATE_DEFECT") {
      if (finding.draftChain.length > 0) blockers.add("DRAFT_PUBLICATION_UNRESOLVED");
      continue;
    }
    const head = finding.draftChain.at(-1);
    if (head?.state === "LINKED" && head.defectLinkRef) findingOutcomeRefs.push(head.defectLinkRef);
    else if (head?.state !== "REJECTED" || head.rejectedByHuman !== true)
      blockers.add("DRAFT_PUBLICATION_UNRESOLVED");
  }

  const inventory = Object.freeze({
    requiredSessionPlanRef: Object.freeze({
      id: input.requiredSessionPlan.id,
      version: input.requiredSessionPlan.version,
      contentHash: input.requiredSessionPlan.contentHash,
    }),
    verdictRef: Object.freeze({
      id: input.verdict.id,
      version: input.verdict.version,
      contentHash: input.verdict.contentHash,
    }),
    sessionReviewRefs: Object.freeze(
      input.sessionReviews
        .filter(({ current }) => current)
        .map(({ id, version, contentHash }) => ({ id, version, contentHash })),
    ),
    evidenceManifestRefs: Object.freeze(
      input.sessionReviews.flatMap(({ evidenceManifestRef }) =>
        evidenceManifestRef ? [evidenceManifestRef] : [],
      ),
    ),
    findingOutcomeRefs: Object.freeze(findingOutcomeRefs),
    waiverRefs: Object.freeze(structuredClone(input.waivers)),
  });
  return buildQaDodAssessment({
    assessmentId: input.assessmentId,
    version: input.version ?? 1,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workItemId: input.workItemId,
    state: blockers.size === 0 ? "READY_TO_CLOSE" : "BLOCKED",
    blockerCodes: Object.freeze([...blockers].sort()),
    warningCodes: Object.freeze([]),
    inventory,
    aggregateInputHash: qaAggregateSnapshotHash({
      inventory,
      currentAggregateSnapshotHash: input.currentAggregateSnapshotHash,
    } as never),
    ruleSetRef: input.rules,
    riskPolicyRef: input.riskPolicyRef,
    evaluatedBy: input.evaluatedBy,
    evaluatedAt: input.evaluatedAt,
  });
}
