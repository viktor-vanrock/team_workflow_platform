import type { EphemeralJiraSecretLease, JiraServiceAuthKind } from "@awp/platform-contracts";

function expired(expiresAt: string, now: Date): boolean {
  return Date.parse(expiresAt) <= now.getTime();
}

export function buildJiraAuthHeaders(
  kind: JiraServiceAuthKind,
  lease: EphemeralJiraSecretLease,
  now: Date,
): Readonly<Record<string, string>> {
  if (expired(lease.metadata.expiresAt, now)) throw new Error("JIRA_SECRET_LEASE_EXPIRED");
  return lease.use((bytes) => {
    const secret = new TextDecoder().decode(bytes);
    if (!secret) throw new Error("JIRA_SECRET_LEASE_EMPTY");
    const authorization =
      kind === "DC_SERVICE_2LO"
        ? `OAuth ${secret}`
        : kind === "CLOUD_SERVICE_API_TOKEN" ||
            kind === "DC_TECHNICAL_ACCOUNT_PAT" ||
            kind === "LOCAL_FAKE"
          ? `Bearer ${secret}`
          : `Basic ${secret}`;
    return Object.freeze({ authorization, accept: "application/json" });
  });
}

export function redactJiraHeaders(
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [
        key,
        /authorization|cookie|token/iu.test(key) ? "[REDACTED]" : value,
      ]),
    ),
  );
}
export const redactJiraAuth = redactJiraHeaders;
