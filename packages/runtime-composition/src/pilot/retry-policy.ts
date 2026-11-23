import { GitLabTransportError } from "@awp/connector-gitlab";
import { JiraTransportError } from "@awp/connector-jira";
import { MattermostTransportError } from "@awp/connector-mattermost";

export type PilotFailure = Readonly<{
  kind:
    | "AUTHENTICATION"
    | "PERMISSION"
    | "RATE_LIMIT"
    | "TRANSIENT"
    | "CONFLICT"
    | "BUSINESS"
    | "CANCELLED"
    | "UNKNOWN";
  code: string;
  retryAfterSeconds?: number;
}>;
export type PilotEffectCertainty =
  | "NOT_DISPATCHED"
  | "POSSIBLY_APPLIED"
  | "CONFIRMED_APPLIED"
  | "CONFIRMED_NOT_APPLIED"
  | "DIVERGENT"
  | "UNRESOLVED";
export interface PilotRetryInput {
  readonly operation: "READ" | "WRITE";
  /** Derived from the existing durable effect ledger, never from a caller's claim. */
  readonly certainty: PilotEffectCertainty;
  readonly failure: PilotFailure;
  /** Total attempts of this original operation, including the failed invocation. */
  readonly attempt: number;
  readonly firstAttemptAt: string;
  readonly now: string;
  readonly policy: Readonly<{
    maximumAttempts: number;
    minimumBackoffMs: number;
    maximumBackoffMs: number;
    maximumElapsedMs: number;
  }>;
}
export interface PilotRetryDecision {
  readonly action:
    | "STOP"
    | "RETRY_ORIGINAL"
    | "RECONCILE_ONLY"
    | "CONFIRM_OBSERVED"
    | "CONTROLLED_ACTION"
    | "QUARANTINE";
  readonly reasonCode: string;
  readonly nextEligibleAt?: string;
  readonly delayMs?: number;
}

export function classifyPilotHttpFailure(status: number, retryAfterSeconds?: number): PilotFailure {
  if (!Number.isSafeInteger(status) || status < 400 || status > 599)
    return Object.freeze({ kind: "UNKNOWN", code: "UNCLASSIFIED_FAILURE" });
  const kind =
    status === 401
      ? "AUTHENTICATION"
      : status === 403
        ? "PERMISSION"
        : status === 429
          ? "RATE_LIMIT"
          : status === 409 || status === 412
            ? "CONFLICT"
            : [408, 500, 502, 503, 504].includes(status)
              ? "TRANSIENT"
              : "BUSINESS";
  return Object.freeze({
    kind,
    code: `HTTP_${status}`,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  });
}

/** Only adapter-classified transport failures may retry. A generic TypeError can be a code bug. */
export function classifyPilotFailure(error: unknown): PilotFailure {
  if (
    error instanceof GitLabTransportError ||
    error instanceof JiraTransportError ||
    error instanceof MattermostTransportError
  ) {
    if (
      /^(?:GITLAB|JIRA|MATTERMOST)_HTTP_[45][0-9]{2}$/u.test(error.code) &&
      error.status !== undefined &&
      error.code.endsWith(`_${error.status}`)
    )
      return classifyPilotHttpFailure(error.status, error.retryAfterSeconds);
    if (
      [
        "GITLAB_NETWORK_ERROR",
        "GITLAB_TIMEOUT",
        "JIRA_NETWORK_ERROR",
        "JIRA_TIMEOUT",
        "MATTERMOST_NETWORK_ERROR",
        "MATTERMOST_TIMEOUT",
      ].includes(error.code)
    )
      return Object.freeze({ kind: "TRANSIENT", code: error.code });
    if (["GITLAB_CANCELLED", "JIRA_CANCELLED"].includes(error.code))
      return Object.freeze({ kind: "CANCELLED", code: error.code });
    return Object.freeze({ kind: "UNKNOWN", code: "UNCLASSIFIED_FAILURE" });
  }
  if (error instanceof Error && /^MATTERMOST_HTTP_[45][0-9]{2}$/u.test(error.message))
    return classifyPilotHttpFailure(Number(error.message.slice(-3)));
  return Object.freeze({ kind: "UNKNOWN", code: "UNCLASSIFIED_FAILURE" });
}

/** Scheduling advice only. The worker must reload current guards before an original retry.
 * This policy owns no command/effect identity and never constructs a replacement command. */
export function decidePilotRetry(input: PilotRetryInput): PilotRetryDecision {
  const now = Date.parse(input.now),
    started = Date.parse(input.firstAttemptAt),
    p = input.policy;
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(started) ||
    started > now ||
    !Number.isSafeInteger(input.attempt) ||
    input.attempt < 1 ||
    !Number.isSafeInteger(p.maximumAttempts) ||
    p.maximumAttempts < 1 ||
    p.maximumAttempts > 100 ||
    !Number.isSafeInteger(p.minimumBackoffMs) ||
    p.minimumBackoffMs < 1 ||
    !Number.isSafeInteger(p.maximumBackoffMs) ||
    p.maximumBackoffMs < p.minimumBackoffMs ||
    p.maximumBackoffMs > 86_400_000 ||
    !Number.isSafeInteger(p.maximumElapsedMs) ||
    p.maximumElapsedMs < p.minimumBackoffMs ||
    p.maximumElapsedMs > 604_800_000 ||
    !["READ", "WRITE"].includes(input.operation) ||
    ![
      "NOT_DISPATCHED",
      "POSSIBLY_APPLIED",
      "CONFIRMED_APPLIED",
      "CONFIRMED_NOT_APPLIED",
      "DIVERGENT",
      "UNRESOLVED",
    ].includes(input.certainty)
  )
    throw new Error("PILOT_RETRY_INPUT_INVALID");
  const decision = (action: PilotRetryDecision["action"], reasonCode: string): PilotRetryDecision =>
    Object.freeze({ action, reasonCode });
  if (input.operation === "WRITE") {
    if (input.certainty === "POSSIBLY_APPLIED")
      return decision("RECONCILE_ONLY", "EFFECT_CONFIRMATION_REQUIRED");
    if (input.certainty === "CONFIRMED_APPLIED")
      return decision("CONFIRM_OBSERVED", "EFFECT_ALREADY_APPLIED");
    if (input.certainty === "DIVERGENT") return decision("CONTROLLED_ACTION", "EFFECT_DIVERGENT");
    if (input.certainty === "UNRESOLVED") return decision("QUARANTINE", "EFFECT_UNRESOLVED");
  }
  if (!["RATE_LIMIT", "TRANSIENT"].includes(input.failure.kind))
    return decision("STOP", input.failure.code);
  if (input.attempt >= p.maximumAttempts) return decision("STOP", "RETRY_BUDGET_EXHAUSTED");
  const hint = input.failure.retryAfterSeconds;
  if (
    hint !== undefined &&
    (!Number.isFinite(hint) || hint < 0 || !Number.isSafeInteger(hint * 1000))
  )
    return decision("STOP", "RETRY_AFTER_INVALID");
  // Retry-After is a minimum, never cap it into an earlier retry. Oversized hints stop this budget.
  const delayMs = Math.max(
    Math.min(p.maximumBackoffMs, p.minimumBackoffMs * 2 ** Math.min(30, input.attempt - 1)),
    (hint ?? 0) * 1000,
  );
  if (delayMs > p.maximumBackoffMs) return decision("STOP", "RETRY_AFTER_EXCEEDS_BUDGET");
  if (now - started + delayMs >= p.maximumElapsedMs)
    return decision("STOP", "RETRY_WINDOW_EXHAUSTED");
  return Object.freeze({
    action: "RETRY_ORIGINAL",
    reasonCode: input.failure.code,
    delayMs,
    nextEligibleAt: new Date(now + delayMs).toISOString(),
  });
}
