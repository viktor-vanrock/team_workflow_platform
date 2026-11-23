export type JiraCommandConfirmation =
  | Readonly<{
      status: "CONFIRMED";
      reasonCode: "AUTHORITATIVE_POST_READ_MATCH";
      externalRevisionToken: string;
    }>
  | Readonly<{
      status: "CONFLICT";
      reasonCode: "POST_READ_VALUE_MISMATCH" | "PROVIDER_CONFLICT";
      externalRevisionToken?: string;
    }>
  | Readonly<{ status: "AMBIGUOUS"; reasonCode: "POST_READ_UNAVAILABLE" }>;
export function confirmJiraCommand(
  input: Readonly<{
    requestedValueHash: string;
    postReadValueHash?: string;
    postReadRevisionToken?: string;
    providerStatus?: number;
  }>,
): JiraCommandConfirmation {
  if (input.providerStatus === 409)
    return Object.freeze({ status: "CONFLICT", reasonCode: "PROVIDER_CONFLICT" });
  if (!input.postReadValueHash || !input.postReadRevisionToken)
    return Object.freeze({ status: "AMBIGUOUS", reasonCode: "POST_READ_UNAVAILABLE" });
  if (input.postReadValueHash !== input.requestedValueHash)
    return Object.freeze({
      status: "CONFLICT",
      reasonCode: "POST_READ_VALUE_MISMATCH",
      externalRevisionToken: input.postReadRevisionToken,
    });
  return Object.freeze({
    status: "CONFIRMED",
    reasonCode: "AUTHORITATIVE_POST_READ_MATCH",
    externalRevisionToken: input.postReadRevisionToken,
  });
}
