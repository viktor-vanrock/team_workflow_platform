import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
} from "./primitives.ts";

export type QaObservationKind = "POSITIVE" | "NEGATIVE" | "AMBIGUOUS" | "INFORMATIONAL";
export type QaObservationSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface QaObservation {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly planItemId: string;
  readonly attemptId: string;
  readonly kind: QaObservationKind;
  readonly expectedOutcome: string;
  readonly actualOutcome: string;
  readonly severity: QaObservationSeverity;
  readonly notes?: string;
  readonly artifactIds: readonly string[];
  readonly correctsObservationRef?: Readonly<{ id: string; contentHash: QaContentHash }>;
  readonly correctionReason?: string;
  readonly actor: QaHumanActor;
  readonly observedAt: string;
  readonly contentHash: QaContentHash;
  readonly resourceVersion: 1;
}

export function createQaObservation(
  input: Omit<QaObservation, "schemaVersion" | "contentHash" | "resourceVersion" | "artifactIds"> &
    Readonly<{ artifactIds?: readonly string[] }>,
): QaObservation {
  const hasPredecessor = input.correctsObservationRef !== undefined;
  const hasReason = input.correctionReason !== undefined;
  if (hasPredecessor !== hasReason)
    throw new QaDomainError("QA_OBSERVATION_CORRECTION_PAIR_REQUIRED");
  if (hasReason && (!input.correctionReason!.trim() || input.correctionReason!.length > 2_000))
    throw new QaDomainError("QA_OBSERVATION_CORRECTION_REASON_INVALID");
  if (
    !input.id ||
    !input.expectedOutcome.trim() ||
    input.expectedOutcome.length > 4_000 ||
    !input.actualOutcome.trim() ||
    input.actualOutcome.length > 10_000 ||
    (input.notes?.length ?? 0) > 4_000
  )
    throw new QaDomainError("QA_OBSERVATION_INVALID");
  const body = Object.freeze({
    schemaVersion: 1 as const,
    ...structuredClone(input),
    artifactIds: Object.freeze([...(input.artifactIds ?? [])].sort()),
    resourceVersion: 1 as const,
  });
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}
