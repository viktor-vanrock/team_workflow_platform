export interface RetryDecision {
  readonly retryable: boolean;
  readonly terminalStatus: "RETRY_SCHEDULED" | "FAILED" | "CONFLICT";
  readonly delayMs: number;
  readonly reasonCode: string;
}
const retryable = new Set(["TIMEOUT", "RATE_LIMITED", "SERVER_ERROR", "NETWORK_ERROR"]);
const conflict = new Set(["EXPECTED_STATE_CONFLICT", "IDEMPOTENCY_CONFLICT"]);
export function classifyConnectorFailure(
  code: string,
  attempt: number,
  maxAttempts = 8,
): RetryDecision {
  if (conflict.has(code))
    return { retryable: false, terminalStatus: "CONFLICT", delayMs: 0, reasonCode: code };
  if (retryable.has(code) && attempt < maxAttempts)
    return {
      retryable: true,
      terminalStatus: "RETRY_SCHEDULED",
      delayMs: Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1)),
      reasonCode: code,
    };
  return { retryable: false, terminalStatus: "FAILED", delayMs: 0, reasonCode: code };
}
