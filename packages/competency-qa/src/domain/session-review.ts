import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
} from "./primitives.ts";

export interface QaSessionReview {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: number;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly sessionOutcome: "PASSED" | "FAILED" | "BLOCKED" | "INCONCLUSIVE";
  readonly outcomeSummary: string;
  readonly adjudicativeManifestRevisionRef: Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
  readonly executionSetHash: QaContentHash;
  readonly resultSetHash: QaContentHash;
  readonly frozenFindingSetHash: QaContentHash;
  readonly flakyDispositionConfirmations: readonly unknown[];
  readonly reviewer: QaHumanActor;
  readonly authorizationBasisHash: QaContentHash;
  readonly reviewedAt: string;
  readonly contentHash: QaContentHash;
  readonly supersedesSessionReviewRef?: Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
  readonly supersessionReason?: string;
}

export function createQaSessionReview(
  input: Omit<QaSessionReview, "schemaVersion" | "contentHash">,
): QaSessionReview {
  if (
    !input.outcomeSummary.trim() ||
    input.outcomeSummary.length > 10_000 ||
    input.reviewer.kind !== "HUMAN"
  )
    throw new QaDomainError("QA_SESSION_REVIEW_INVALID");
  if (
    (input.version === 1 && (input.supersedesSessionReviewRef || input.supersessionReason)) ||
    (input.version > 1 && (!input.supersedesSessionReviewRef || !input.supersessionReason?.trim()))
  )
    throw new QaDomainError("QA_SESSION_REVIEW_CHAIN_INVALID");
  const body = Object.freeze({ schemaVersion: 1 as const, ...structuredClone(input) });
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}
