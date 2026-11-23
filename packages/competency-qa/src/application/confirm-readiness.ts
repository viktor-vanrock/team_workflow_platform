import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
} from "../domain/primitives.ts";
import {
  type QaReadinessAssessment,
  qaReadinessAssessmentRef,
  type QaReadinessSyncState,
} from "../domain/readiness.ts";
import { assertActiveExactDorWaiver, type QaDorWaiver } from "../domain/waiver.ts";

export interface QaReadyTransitionCandidate {
  readonly id: string;
  readonly assessmentRef: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
  readonly inputRef: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
  readonly inputFingerprint: QaContentHash;
  readonly actor: QaHumanActor;
  readonly confirmedAt: string;
  readonly state: "AWAITING_APPROVAL";
  readonly contentHash: QaContentHash;
}

const same = (
  a: { id: string; version: number; contentHash: QaContentHash },
  b: { id: string; version: number; contentHash: QaContentHash },
) => a.id === b.id && a.version === b.version && a.contentHash === b.contentHash;

export function confirmQaReadiness(
  input: Readonly<{
    assessment: QaReadinessAssessment;
    currentInputRef: { id: string; version: number; contentHash: QaContentHash };
    actor: QaHumanActor;
    confirmedAt: string;
    waiver?: QaDorWaiver;
  }>,
): QaReadyTransitionCandidate {
  if (!same(input.assessment.requestInputRevisionRef, input.currentInputRef))
    throw new QaDomainError("QA_READINESS_STALE_INPUT");
  if (input.assessment.state === "NEEDS_INFO") throw new QaDomainError("QA_READINESS_BLOCKED");
  if (input.assessment.state === "READY_WITH_WAIVER") {
    if (!input.waiver) throw new QaDomainError("QA_READINESS_WAIVER_REQUIRED");
    assertActiveExactDorWaiver(input.waiver, {
      scope: input.assessment.scope,
      assessmentRef: qaReadinessAssessmentRef(input.assessment),
      inputFingerprint: input.assessment.inputFingerprint,
      at: input.confirmedAt,
    });
  }
  const body = Object.freeze({
    id: `ready:${input.assessment.assessmentId}`,
    assessmentRef: qaReadinessAssessmentRef(input.assessment),
    inputRef: structuredClone(input.currentInputRef),
    inputFingerprint: input.assessment.inputFingerprint,
    actor: structuredClone(input.actor),
    confirmedAt: input.confirmedAt,
    state: "AWAITING_APPROVAL" as const,
  });
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}

export function projectReadinessSync(
  candidate: QaReadyTransitionCandidate,
  outcome: Readonly<
    | { state: "PENDING" }
    | { state: "FAILED"; code: string }
    | { state: "CONFIRMED"; externalVersion: string; normalizedStatus: string; confirmedAt: string }
  >,
): Readonly<{
  state: QaReadinessSyncState;
  candidateRef: { id: string; contentHash: QaContentHash };
  inputFrozen: boolean;
  errorCode?: string;
  externalVersion?: string;
}> {
  if (outcome.state === "PENDING")
    return Object.freeze({
      state: "READY_PENDING_SYNC",
      candidateRef: { id: candidate.id, contentHash: candidate.contentHash },
      inputFrozen: false,
    });
  if (outcome.state === "FAILED")
    return Object.freeze({
      state: "SYNC_ERROR",
      candidateRef: { id: candidate.id, contentHash: candidate.contentHash },
      inputFrozen: false,
      errorCode: outcome.code,
    });
  if (outcome.normalizedStatus !== "READY")
    throw new QaDomainError("QA_READY_CONFIRMATION_STATE_MISMATCH");
  return Object.freeze({
    state: "READY",
    candidateRef: { id: candidate.id, contentHash: candidate.contentHash },
    inputFrozen: true,
    externalVersion: outcome.externalVersion,
  });
}
