export type GitLabRateHealthDecision = "AVAILABLE" | "BACKOFF" | "AUTH_DEGRADED" | "UNAVAILABLE";

export interface GitLabRateHealthInput {
  readonly operation: "READ" | "TRIGGER_POST_MARKED";
  readonly httpStatus: number;
  readonly retryAfterSeconds?: number;
  readonly attempt: number;
  readonly observedAt: string;
  readonly policy: Readonly<{
    maximumReadRetries: number;
    minimumBackoffMs: number;
    maximumBackoffMs: number;
  }>;
}

export interface GitLabRateHealthResult {
  readonly decision: GitLabRateHealthDecision;
  readonly retry: boolean;
  readonly terminal: boolean;
  readonly observedAt: string;
  readonly httpStatus: number;
  readonly backoffMs?: number;
  readonly nextEligibleAt?: string;
  readonly errorCode?: string;
}

function result(
  input: GitLabRateHealthInput,
  value: Omit<GitLabRateHealthResult, "observedAt" | "httpStatus">,
): GitLabRateHealthResult {
  return Object.freeze({
    ...value,
    observedAt: new Date(input.observedAt).toISOString(),
    httpStatus: input.httpStatus,
  });
}

export function decideGitLabRateHealth(input: GitLabRateHealthInput): GitLabRateHealthResult {
  const observedAt = Date.parse(input.observedAt);
  if (!Number.isFinite(observedAt)) throw new Error("GITLAB_RATE_OBSERVED_AT_INVALID");
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1)
    throw new Error("GITLAB_RATE_ATTEMPT_INVALID");
  if (
    !Number.isSafeInteger(input.policy.maximumReadRetries) ||
    input.policy.maximumReadRetries < 0 ||
    !Number.isSafeInteger(input.policy.minimumBackoffMs) ||
    input.policy.minimumBackoffMs < 1 ||
    !Number.isSafeInteger(input.policy.maximumBackoffMs) ||
    input.policy.maximumBackoffMs < input.policy.minimumBackoffMs
  ) {
    throw new Error("GITLAB_RATE_POLICY_INVALID");
  }
  if (input.httpStatus >= 200 && input.httpStatus < 300)
    return result(input, { decision: "AVAILABLE", retry: false, terminal: false });
  if (input.httpStatus === 401 || input.httpStatus === 403) {
    return result(input, {
      decision: "AUTH_DEGRADED",
      retry: false,
      terminal: true,
      errorCode: input.httpStatus === 401 ? "AUTHENTICATION_401" : "PERMISSION_403",
    });
  }
  if (input.operation === "TRIGGER_POST_MARKED") {
    return result(input, {
      decision: "UNAVAILABLE",
      retry: false,
      terminal: true,
      errorCode: "POST_MARKER_WRITE_RETRY_FORBIDDEN",
    });
  }
  const retryable =
    input.httpStatus === 429 ||
    input.httpStatus === 500 ||
    input.httpStatus === 502 ||
    input.httpStatus === 503 ||
    input.httpStatus === 504;
  if (!retryable)
    return result(input, {
      decision: "UNAVAILABLE",
      retry: false,
      terminal: true,
      errorCode: `HTTP_${input.httpStatus}_FINAL`,
    });
  if (input.attempt > input.policy.maximumReadRetries)
    return result(input, {
      decision: "UNAVAILABLE",
      retry: false,
      terminal: true,
      errorCode: "READ_RETRY_BUDGET_EXHAUSTED",
    });
  const exponential = input.policy.minimumBackoffMs * 2 ** (input.attempt - 1);
  if (
    input.retryAfterSeconds !== undefined &&
    (!Number.isFinite(input.retryAfterSeconds) ||
      input.retryAfterSeconds < 0 ||
      !Number.isSafeInteger(input.retryAfterSeconds * 1000))
  )
    return result(input, {
      decision: "UNAVAILABLE",
      retry: false,
      terminal: true,
      errorCode: "RETRY_AFTER_INVALID",
    });
  const hinted = (input.retryAfterSeconds ?? 0) * 1000;
  if (hinted > input.policy.maximumBackoffMs)
    return result(input, {
      decision: "UNAVAILABLE",
      retry: false,
      terminal: true,
      errorCode: "RETRY_AFTER_EXCEEDS_BUDGET",
    });
  const backoffMs = Math.max(Math.min(input.policy.maximumBackoffMs, exponential), hinted);
  return result(input, {
    decision: "BACKOFF",
    retry: true,
    terminal: false,
    backoffMs,
    nextEligibleAt: new Date(observedAt + backoffMs).toISOString(),
    errorCode: input.httpStatus === 429 ? "RATE_LIMIT_429" : `SERVER_${input.httpStatus}`,
  });
}
