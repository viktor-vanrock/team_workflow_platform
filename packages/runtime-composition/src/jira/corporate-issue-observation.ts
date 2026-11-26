import { type JiraIssueRead, observeJiraIssue } from "@awp/connector-jira";
import type {
  CompleteOperationalObservation,
  OperationalNormalizedAuthorityStatus,
} from "@awp/platform-core";

const allowed = new Set<OperationalNormalizedAuthorityStatus>([
  "NEW",
  "NEEDS_INFO",
  "READY",
  "PLANNED",
  "IN_PROGRESS",
  "REVIEW",
  "BLOCKED",
  "DONE",
  "CANCELLED",
]);
type RevisionRef = Readonly<{ id: string; version: number }>;

/** Read mappings from the existing qa-request-profile@1 contract, rejecting duplicate provider ids. */
export function corporateJiraObservationMappings(profile: Readonly<Record<string, unknown>>) {
  const collect = (
    value: unknown,
    idKey: string,
    valueKey: string,
  ): Readonly<Record<string, string>> => {
    if (!Array.isArray(value) || value.length === 0 || value.length > 64)
      throw new Error("CORPORATE_JIRA_PROFILE_MAPPING_REQUIRED");
    const entries: Array<[string, string]> = [];
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw new Error("CORPORATE_JIRA_PROFILE_MAPPING_INVALID");
      const record = item as Record<string, unknown>;
      const id = record[idKey],
        mapped = record[valueKey];
      if (
        typeof id !== "string" ||
        !id ||
        typeof mapped !== "string" ||
        !mapped ||
        entries.some(([existing]) => existing === id)
      )
        throw new Error("CORPORATE_JIRA_PROFILE_MAPPING_INVALID");
      entries.push([id, mapped]);
    }
    return Object.freeze(Object.fromEntries(entries));
  };
  if (profile.schemaVersion !== 1 || profile.logicalRole !== "QA_REQUEST_AUTHORITY")
    throw new Error("CORPORATE_JIRA_PROFILE_MAPPING_INVALID");
  const statusMapping = collect(profile.statusMappings, "rawStatusId", "normalizedStatus");
  if (
    Object.values(statusMapping).some(
      (value) => !allowed.has(value as OperationalNormalizedAuthorityStatus),
    )
  )
    throw new Error("CORPORATE_JIRA_STATUS_MAPPING_INVALID");
  const priorityMapping = collect(profile.priorityMappings, "priorityId", "normalizedKey");
  return Object.freeze({ statusMapping, priorityMapping });
}

/** Provider state becomes domain truth only through an explicit, server-resolved mapping. */
export function normalizeCorporateJiraObservation(
  input: Readonly<{
    issue: JiraIssueRead;
    statusMapping: Readonly<Record<string, string>>;
    priorityMapping?: Readonly<Record<string, string>>;
    blockReasonMapping?: Readonly<Record<string, string>>;
    expectedExternalEntityId: string;
    observationId: string;
    observedAt: string;
    source: "CREATE_READ_BACK" | "WEBHOOK_READ" | "RECONCILIATION_READ";
    profileRef: RevisionRef;
    mappingRef: RevisionRef;
    connectionRef: RevisionRef;
    adapterFamily: string;
    adapterContractVersion: string;
  }>,
): CompleteOperationalObservation {
  if (
    !input.issue ||
    input.issue.id !== input.expectedExternalEntityId ||
    !input.issue.key ||
    !input.observationId ||
    !input.issue.fields?.status?.id ||
    !input.issue.fields?.status?.name ||
    !input.issue.fields?.requester?.accountId ||
    !Number.isFinite(Date.parse(input.issue.updated)) ||
    !Number.isFinite(Date.parse(input.observedAt)) ||
    !input.adapterFamily ||
    !input.adapterContractVersion
  )
    throw new Error("CORPORATE_JIRA_OBSERVATION_INVALID");
  const observed = observeJiraIssue(input.issue, {
    status: input.statusMapping,
    ...(input.priorityMapping ? { priority: input.priorityMapping } : {}),
    ...(input.blockReasonMapping ? { blockReason: input.blockReasonMapping } : {}),
  });
  if (!allowed.has(observed.normalizedStatus as OperationalNormalizedAuthorityStatus))
    throw new Error("CORPORATE_JIRA_STATUS_MAPPING_INVALID");
  for (const ref of [input.profileRef, input.mappingRef, input.connectionRef])
    if (!ref.id || !Number.isSafeInteger(ref.version) || ref.version < 1)
      throw new Error("CORPORATE_JIRA_OBSERVATION_REF_INVALID");
  return Object.freeze({
    ...observed,
    normalizedStatus: observed.normalizedStatus as OperationalNormalizedAuthorityStatus,
    observationId: input.observationId,
    observedAt: input.observedAt,
    source: input.source,
    profileRef: input.profileRef,
    mappingRef: input.mappingRef,
    connectionRef: input.connectionRef,
    adapterFamily: input.adapterFamily,
    adapterContractVersion: input.adapterContractVersion,
    ...(input.issue.changelogId ? { providerChangelogId: input.issue.changelogId } : {}),
  });
}
