import type { QaCompletionCandidateAggregate } from "../domain/completion.ts";
import { QaDomainError } from "../domain/primitives.ts";

export interface QaCompletionReadContext {
  readonly scope: Readonly<{ kind: "PROJECT"; workspaceId: string; projectId: string }>;
  readonly actor: unknown;
  readonly correlationId: string;
  readonly causationId: string;
  readonly profileRef: Readonly<{ id: string; version: number }>;
  readonly classification: Readonly<{ key: string; rank: number }>;
  readonly signal: AbortSignal;
}

export interface QaCompletionReadTarget {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly entityKind: "REQUEST";
  readonly authorityScopeKey: string;
  readonly externalEntityId: string;
}

export interface QaCompletionReadResult {
  readonly operation: "request.transition";
  readonly normalizedStatus: "READY" | "DONE";
  readonly effectId: string;
  readonly completionSummaryReceipt?: Readonly<{ id: string; contentHash: `sha256:${string}` }>;
  readonly [key: string]: unknown;
}

export async function reconcileQaCompletion(
  input: Readonly<{
    candidate: QaCompletionCandidateAggregate;
    context: QaCompletionReadContext;
    target: QaCompletionReadTarget;
    effectIdempotencyKey: string;
    readByEffect: (
      context: QaCompletionReadContext,
      target: QaCompletionReadTarget,
      effectIdempotencyKey: string,
    ) => Promise<QaCompletionReadResult | undefined>;
  }>,
): Promise<QaCompletionReadResult | undefined> {
  if (
    input.candidate.state !== "DISPATCHED" ||
    input.candidate.effectKeyHash === undefined ||
    input.candidate.bindingRef.id.length === 0
  ) {
    throw new QaDomainError("QA_COMPLETION_RECONCILIATION_STATE_INVALID");
  }
  const result = await input.readByEffect(input.context, input.target, input.effectIdempotencyKey);
  if (result === undefined) return undefined;
  if (
    result.operation !== "request.transition" ||
    result.normalizedStatus !== "DONE" ||
    result.effectId !== input.effectIdempotencyKey ||
    result.completionSummaryReceipt?.contentHash !== input.candidate.summary.contentHash
  )
    throw new QaDomainError("QA_COMPLETION_RECONCILIATION_RESULT_INVALID");
  return result;
}
