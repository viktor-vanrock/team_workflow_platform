import { type JsonValue, sha256 } from "@awp/platform-contracts";

export interface JiraIssueRead {
  readonly id: string;
  readonly key: string;
  readonly updated: string;
  readonly changelogId?: string;
  readonly fields: Readonly<{
    status: Readonly<{ id: string; name: string }>;
    blockReason?: Readonly<{ id: string; name: string }> | null;
    requester: Readonly<{ accountId: string }>;
    assignee?: Readonly<{ accountId: string }> | null;
    priority?: Readonly<{ id: string; name: string }> | null;
    duedate?: string | null;
  }>;
}
export function observeJiraIssue(
  issue: JiraIssueRead,
  mapping: Readonly<{
    status: Readonly<Record<string, string>>;
    blockReason?: Readonly<Record<string, string>>;
    priority?: Readonly<Record<string, string>>;
  }>,
) {
  const normalizedStatus = mapping.status[issue.fields.status.id];
  if (!normalizedStatus) throw new Error("JIRA_STATUS_MAPPING_REQUIRED");
  const blockReason = issue.fields.blockReason
    ? {
        rawId: issue.fields.blockReason.id,
        rawName: issue.fields.blockReason.name,
        normalizedReasonCode: mapping.blockReason?.[issue.fields.blockReason.id] ?? "UNMAPPED",
      }
    : null;
  const authority = {
    normalizedStatus,
    rawStatus: issue.fields.status,
    blockReason,
    requester: { externalPrincipalId: issue.fields.requester.accountId },
    assignee: issue.fields.assignee
      ? { externalPrincipalId: issue.fields.assignee.accountId }
      : null,
    priority: issue.fields.priority
      ? {
          rawId: issue.fields.priority.id,
          rawName: issue.fields.priority.name,
          normalizedKey: mapping.priority?.[issue.fields.priority.id] ?? "UNMAPPED",
        }
      : null,
    dueDate: issue.fields.duedate ?? null,
  };
  return Object.freeze({
    externalEntityId: issue.id,
    externalDisplayKey: issue.key,
    externalRevisionToken: `${issue.updated}:${issue.changelogId ?? sha256(authority as unknown as JsonValue)}`,
    authorityFieldsHash: sha256(authority as unknown as JsonValue),
    providerUpdatedAt: issue.updated,
    ...authority,
  });
}
