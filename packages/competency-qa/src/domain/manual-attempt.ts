import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
} from "./primitives.ts";

export type QaManualAttemptResult =
  "PASS" | "ASSERTION_FAILED" | "INFRA_FAILED" | "TIMEOUT" | "CANCELLED" | "INCOMPLETE";

export interface QaManualAttempt {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly planItemId: string;
  readonly attemptNo: number;
  readonly state: "RUNNING" | "COMPLETED";
  readonly actor: QaHumanActor;
  readonly targetSnapshotHash: QaContentHash;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly result?: QaManualAttemptResult;
  readonly cancellationReason?: string;
  readonly notes?: string;
  readonly contentHash: QaContentHash;
  readonly resourceVersion: number;
}

type AttemptBody = Omit<QaManualAttempt, "contentHash">;

function hash(body: AttemptBody): QaContentHash {
  return qaAggregateSnapshotHash(body as never);
}

function bounded(value: string | undefined, code: string, maximum: number): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > maximum) throw new QaDomainError(code);
  return normalized;
}

export function startManualAttempt(
  input: Omit<QaManualAttempt, "schemaVersion" | "state" | "contentHash" | "resourceVersion">,
): QaManualAttempt {
  if (
    !input.id ||
    !input.workspaceId ||
    !input.projectId ||
    !input.workItemId ||
    !input.sessionId ||
    !input.planItemId ||
    input.attemptNo < 1 ||
    !Number.isInteger(input.attemptNo) ||
    !input.targetSnapshotHash.startsWith("sha256:") ||
    input.actor.kind !== "HUMAN"
  ) {
    throw new QaDomainError("QA_MANUAL_ATTEMPT_INVALID");
  }
  const body = Object.freeze({
    schemaVersion: 1 as const,
    ...structuredClone(input),
    state: "RUNNING" as const,
    resourceVersion: 1,
  });
  return Object.freeze({ ...body, contentHash: hash(body) });
}

export function finishManualAttempt(
  attempt: QaManualAttempt,
  input: Readonly<{
    actor: QaHumanActor;
    at: string;
    result: QaManualAttemptResult;
    cancellationReason?: string;
    notes?: string;
    expectedResourceVersion: number;
  }>,
): QaManualAttempt {
  if (attempt.resourceVersion !== input.expectedResourceVersion)
    throw new QaDomainError("QA_ATTEMPT_STALE_VERSION");
  if (attempt.state !== "RUNNING") throw new QaDomainError("QA_ATTEMPT_ALREADY_FINALIZED");
  if ((input.notes?.length ?? 0) > 4_000) throw new QaDomainError("QA_ATTEMPT_NOTES_INVALID");
  let cancellationReason: string | undefined;
  if (input.result === "CANCELLED")
    cancellationReason = bounded(
      input.cancellationReason,
      "QA_ATTEMPT_CANCELLATION_REASON_REQUIRED",
      2_000,
    );
  else if (input.cancellationReason !== undefined)
    throw new QaDomainError("QA_ATTEMPT_CANCELLATION_REASON_FORBIDDEN");
  const body = Object.freeze({
    ...attempt,
    state: "COMPLETED" as const,
    actor: structuredClone(input.actor),
    endedAt: input.at,
    result: input.result,
    ...(cancellationReason === undefined ? {} : { cancellationReason }),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    resourceVersion: attempt.resourceVersion + 1,
  });
  const { contentHash: previousContentHash, ...content } = body;
  if (!previousContentHash.startsWith("sha256:"))
    throw new QaDomainError("QA_MANUAL_ATTEMPT_HASH_INVALID");
  return Object.freeze({ ...content, contentHash: hash(content) });
}
