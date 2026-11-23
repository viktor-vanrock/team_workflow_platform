import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
} from "./primitives.ts";

export type QaPlanItemHumanResult = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN" | "INCONCLUSIVE";

export interface QaFlakyDispositionBasis {
  readonly findingId: string;
  readonly findingState: "DISPOSED";
  readonly disposedFindingReviewRef: Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
  readonly activeMembershipSetHash: QaContentHash;
  readonly failedAttemptRefs: readonly Readonly<{ id: string; contentHash: QaContentHash }>[];
  readonly failedAttemptSetHash: QaContentHash;
  readonly flakyObservationRefs: readonly Readonly<{
    id: string;
    attemptId: string;
    membershipId: string;
    contentHash: QaContentHash;
  }>[];
  readonly flakyObservationSetHash: QaContentHash;
  readonly policyRef: Readonly<{ key: string; version: string; contentHash: QaContentHash }>;
}

export interface QaPlanItemResultRevision {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: number;
  readonly previousRevisionRef?: Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
  readonly correctionReason?: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly planItemId: string;
  readonly attemptMembershipMode: "ALL_FINALIZED_CONTIGUOUS";
  readonly consideredAttemptRefs: readonly Readonly<{ id: string; contentHash: QaContentHash }>[];
  readonly consideredAttemptSetHash: QaContentHash;
  readonly observationMembershipMode: "ALL_CURRENT_LEAVES";
  readonly consideredObservationRefs: readonly Readonly<{
    id: string;
    contentHash: QaContentHash;
  }>[];
  readonly consideredObservationSetHash: QaContentHash;
  readonly maximumAttemptNo: number;
  readonly reviewFlags: readonly "FLAKY_SUSPECTED"[];
  readonly result: QaPlanItemHumanResult;
  readonly actualOutcome: string;
  readonly decisionReason: string;
  readonly evidenceLinkIds: readonly string[];
  readonly evidenceLinkSetHash: QaContentHash;
  readonly waiverRef?: Readonly<{ id: string; contentHash: QaContentHash }>;
  readonly flakyDispositionBasis?: QaFlakyDispositionBasis;
  readonly contentHash: QaContentHash;
  readonly recordedBy: QaHumanActor;
  readonly recordedAt: string;
}

export function createQaPlanItemResultRevision(
  input: Omit<
    QaPlanItemResultRevision,
    | "schemaVersion"
    | "contentHash"
    | "attemptMembershipMode"
    | "observationMembershipMode"
    | "evidenceLinkSetHash"
  >,
): QaPlanItemResultRevision {
  const previous = input.previousRevisionRef !== undefined;
  const correction = input.correctionReason !== undefined;
  if (
    (input.version === 1 && (previous || correction)) ||
    (input.version > 1 && (!previous || !correction))
  )
    throw new QaDomainError("QA_RESULT_REVISION_CHAIN_INVALID");
  if (
    !input.actualOutcome.trim() ||
    input.actualOutcome.length > 10_000 ||
    !input.decisionReason.trim() ||
    input.decisionReason.length > 4_000
  )
    throw new QaDomainError("QA_RESULT_DECISION_INVALID");
  const evidenceLinkIds = Object.freeze([...new Set(input.evidenceLinkIds)].sort());
  const flaky = input.reviewFlags.includes("FLAKY_SUSPECTED");
  if ((input.flakyDispositionBasis !== undefined) !== (flaky && input.result === "PASS"))
    throw new QaDomainError("QA_FLAKY_DISPOSITION_BASIS_INVALID");
  if (input.flakyDispositionBasis) {
    const basis = input.flakyDispositionBasis;
    if (
      !basis.failedAttemptRefs.length ||
      !basis.flakyObservationRefs.length ||
      basis.findingState !== "DISPOSED"
    )
      throw new QaDomainError("QA_FLAKY_DISPOSITION_BASIS_INVALID");
    if (
      qaAggregateSnapshotHash(basis.failedAttemptRefs as never) !== basis.failedAttemptSetHash ||
      qaAggregateSnapshotHash(basis.flakyObservationRefs as never) !== basis.flakyObservationSetHash
    )
      throw new QaDomainError("QA_FLAKY_DISPOSITION_SET_HASH_INVALID");
  }
  const body = Object.freeze({
    schemaVersion: 1 as const,
    ...structuredClone(input),
    evidenceLinkIds,
    attemptMembershipMode: "ALL_FINALIZED_CONTIGUOUS" as const,
    observationMembershipMode: "ALL_CURRENT_LEAVES" as const,
    evidenceLinkSetHash: qaAggregateSnapshotHash(evidenceLinkIds as never),
  });
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}
