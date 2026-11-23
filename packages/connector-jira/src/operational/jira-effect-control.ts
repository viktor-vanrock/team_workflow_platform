export type JiraEffectLookup =
  | Readonly<{ state: "FOUND"; externalEntityId: string }>
  | Readonly<{ state: "PROVEN_ABSENT" }>
  | Readonly<{ state: "UNKNOWN" }>
  | Readonly<{ state: "MULTIPLE"; candidates: readonly string[] }>;
export function lookupJiraEffect(
  matches: readonly string[],
  visibilityProven: boolean,
): JiraEffectLookup {
  const unique = [...new Set(matches)];
  if (unique.length === 1) return Object.freeze({ state: "FOUND", externalEntityId: unique[0]! });
  if (unique.length > 1)
    return Object.freeze({ state: "MULTIPLE", candidates: Object.freeze(unique) });
  return Object.freeze({ state: visibilityProven ? "PROVEN_ABSENT" : "UNKNOWN" });
}
export interface JiraFailureClassification {
  readonly category:
    | "AUTHENTICATION"
    | "PERMISSION"
    | "CONFLICT"
    | "RATE_LIMIT"
    | "TRANSIENT"
    | "VALIDATION"
    | "NOT_FOUND"
    | "MAPPING_DRIFT"
    | "AMBIGUOUS"
    | "SECURITY_SCOPE";
  readonly retryDisposition:
    "DO_NOT_RETRY" | "RETRY_AFTER" | "RECONCILE_BEFORE_RETRY" | "OPERATOR_DECISION";
  readonly retryAfterSeconds?: number;
}
export function classifyJiraResponse(
  status: number,
  headers: Readonly<Record<string, string>> = {},
): JiraFailureClassification {
  if (status === 401)
    return Object.freeze({ category: "AUTHENTICATION", retryDisposition: "DO_NOT_RETRY" });
  if (status === 403)
    return Object.freeze({ category: "PERMISSION", retryDisposition: "DO_NOT_RETRY" });
  if (status === 404)
    return Object.freeze({ category: "NOT_FOUND", retryDisposition: "DO_NOT_RETRY" });
  if (status === 409)
    return Object.freeze({ category: "CONFLICT", retryDisposition: "DO_NOT_RETRY" });
  if (status === 429)
    return Object.freeze({
      category: "RATE_LIMIT",
      retryDisposition: "RETRY_AFTER",
      retryAfterSeconds: Math.max(1, Number(headers["retry-after"] ?? 1)),
    });
  if (status >= 500)
    return Object.freeze({ category: "TRANSIENT", retryDisposition: "RECONCILE_BEFORE_RETRY" });
  return Object.freeze({ category: "VALIDATION", retryDisposition: "DO_NOT_RETRY" });
}
