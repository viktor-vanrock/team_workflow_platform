import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  type QaExactReference,
} from "./primitives.ts";

export type QaDodState = "BLOCKED" | "READY_TO_CLOSE" | "SATISFIED";

export interface QaDodInventory {
  readonly requiredSessionPlanRef?: QaExactReference;
  readonly verdictRef?: QaExactReference;
  readonly sessionReviewRefs: readonly QaExactReference[];
  readonly evidenceManifestRefs: readonly QaExactReference[];
  readonly findingOutcomeRefs: readonly QaExactReference[];
  readonly waiverRefs: readonly QaExactReference[];
}

export interface QaDodAssessment {
  readonly assessmentId: string;
  readonly version: number;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly state: QaDodState;
  readonly blockerCodes: readonly string[];
  readonly warningCodes: readonly string[];
  readonly inventory: QaDodInventory;
  readonly aggregateInputHash: QaContentHash;
  readonly ruleSetRef: QaExactReference;
  readonly riskPolicyRef: QaExactReference;
  readonly evaluatedBy: string;
  readonly evaluatedAt: string;
  readonly contentHash: QaContentHash;
  readonly completionConfirmationRef?: QaExactReference;
}

export function buildQaDodAssessment(input: Omit<QaDodAssessment, "contentHash">): QaDodAssessment {
  return Object.freeze({
    ...structuredClone(input),
    contentHash: qaAggregateSnapshotHash(input as never),
  });
}
