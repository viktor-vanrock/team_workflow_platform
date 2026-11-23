import { QaDomainError } from "../domain/primitives.ts";

export type QaCompletionWaiverKind = "PLAN_ITEM" | "SESSION" | "REQUIRED_SESSION";

export function requestCompletionWaiver(
  input: Readonly<{
    kind: QaCompletionWaiverKind;
    attempted: boolean;
    negative: boolean;
    zeroExecutionCancelled?: boolean;
    reason: string;
    remainingRequiredSessions: number;
  }>,
): Readonly<{ kind: QaCompletionWaiverKind; reason: string }> {
  if (
    !(["PLAN_ITEM", "SESSION", "REQUIRED_SESSION"] as const).includes(input.kind) ||
    !input.reason.trim() ||
    input.attempted ||
    input.negative
  ) {
    throw new QaDomainError("QA_COMPLETION_WAIVER_FORBIDDEN");
  }
  if (input.kind === "SESSION" && input.zeroExecutionCancelled !== true)
    throw new QaDomainError("QA_SESSION_WAIVER_ZERO_EXECUTION_REQUIRED");
  if (input.kind === "REQUIRED_SESSION" && input.remainingRequiredSessions <= 1)
    throw new QaDomainError("QA_LAST_REQUIRED_SESSION_WAIVER_FORBIDDEN");
  return Object.freeze({ kind: input.kind, reason: input.reason });
}
