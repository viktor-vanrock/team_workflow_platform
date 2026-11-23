export interface JiraNormalizedWebhook {
  readonly connectionId: string;
  readonly deliveryIdentity: string;
  readonly externalEntityId: string;
  readonly changelogId?: string;
  readonly rawBodyHash: string;
  readonly action: "AUTHORITATIVE_REREAD_REQUIRED";
}
export function normalizeJiraWebhook(
  input: Readonly<{
    connectionId: string;
    deliveryId?: string;
    canonicalBodyHash: string;
    event: unknown;
  }>,
): JiraNormalizedWebhook {
  if (!input.event || typeof input.event !== "object" || Array.isArray(input.event))
    throw new Error("JIRA_WEBHOOK_INVALID");
  const event = input.event as Record<string, unknown>;
  const issue = event.issue as Record<string, unknown> | undefined;
  const changelog = event.changelog as Record<string, unknown> | undefined;
  if (!issue?.id) throw new Error("JIRA_WEBHOOK_ISSUE_ID_REQUIRED");
  return Object.freeze({
    connectionId: input.connectionId,
    deliveryIdentity:
      input.deliveryId ?? `${issue.id}:${String(changelog?.id ?? input.canonicalBodyHash)}`,
    externalEntityId: String(issue.id),
    ...(changelog?.id ? { changelogId: String(changelog.id) } : {}),
    rawBodyHash: input.canonicalBodyHash,
    action: "AUTHORITATIVE_REREAD_REQUIRED",
  });
}
