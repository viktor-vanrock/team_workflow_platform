import {
  createJiraDialect,
  JiraRestClient,
  type JiraTransport,
  planSourceLink,
  type RequestSubEffect,
} from "@awp/connector-jira";
import type { OperationalImmutableRef, OperationalRequestCreateInput } from "@awp/connector-sdk";
import { type JsonValue, sha256 } from "@awp/platform-contracts";

import type { QaJiraResolvedPins } from "./qa-command-materializer.ts";

type RecordValue = Readonly<Record<string, unknown>>;
type LinkDirection = "INWARD" | "OUTWARD";

const identifier = /^[A-Za-z0-9._-]+$/u;
const digest = /^sha256:[a-f0-9]{64}$/u;

export interface QaJiraSourceIssueObservation {
  readonly externalEntityId: string;
  readonly projectId: string;
  readonly issueTypeId: string;
  readonly providerUpdatedAt: string;
  readonly providerChangelogId?: string;
  readonly authorityFields: Readonly<{
    project: Readonly<{ id: string }>;
    issuetype: Readonly<{ id: string }>;
    updated: string;
  }>;
}

export interface QaJiraSourceLinkPolicy {
  readonly typeId: string;
  readonly direction: LinkDirection;
}

export interface QaJiraSourceContextPlan {
  readonly subEffects: readonly RequestSubEffect[];
  readonly issueLink?: QaJiraSourceLinkPolicy;
  readonly validatedSourceRef?: OperationalImmutableRef;
}

export interface PlanQaJiraRequestSourceContextInput {
  readonly resolved: QaJiraResolvedPins;
  readonly request: Pick<OperationalRequestCreateInput, "sourceRefs">;
  readonly effectMarker: string;
  readonly signal?: AbortSignal;
  readonly transport?: JiraTransport;
}

function record(value: unknown, code: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as RecordValue;
}

function requiredIdentifier(value: unknown, code: string): string {
  if (typeof value !== "string" || !identifier.test(value)) throw new Error(code);
  return value;
}

function requiredDate(value: unknown, code: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(code);
  return value;
}

function optionalIdentifier(value: unknown, code: string): string | undefined {
  return value === undefined || value === null || value === ""
    ? undefined
    : requiredIdentifier(value, code);
}

function exactIdentifierArray(value: unknown, code: string): readonly string[] {
  if (!Array.isArray(value) || value.length !== 1) throw new Error(code);
  const values = value.map((entry) => requiredIdentifier(entry, code));
  if (new Set(values).size !== values.length) throw new Error(code);
  return Object.freeze(values);
}

function sameRef(
  left: Readonly<{ id: string; version: number }>,
  right: Readonly<{ id: string; version: number }>,
): boolean {
  return left.id === right.id && left.version === right.version;
}

function nestedId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const id = (value as RecordValue).id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function lastChangelogId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const histories = (value as RecordValue).histories;
  if (!Array.isArray(histories)) return undefined;
  return histories
    .map((history) => {
      if (!history || typeof history !== "object" || Array.isArray(history)) return undefined;
      const id = (history as RecordValue).id;
      return typeof id === "string" && id.length > 0 ? id : undefined;
    })
    .filter((id): id is string => id !== undefined)
    .at(-1);
}

/**
 * Normalize only the immutable source fields used by the local SOURCE_CONTEXT
 * contract. Extra Jira fields are deliberately ignored and never enter Core.
 */
export function normalizeQaJiraSourceIssueObservation(
  document: unknown,
): QaJiraSourceIssueObservation {
  const issue = record(document, "JIRA_SOURCE_ISSUE_RESPONSE_INVALID");
  const fields = record(issue.fields ?? {}, "JIRA_SOURCE_ISSUE_FIELDS_INVALID");
  const externalEntityId = requiredIdentifier(issue.id, "JIRA_SOURCE_ISSUE_ID_INVALID");
  const projectId = requiredIdentifier(
    issue.projectId ?? nestedId(fields.project),
    "JIRA_SOURCE_ISSUE_PROJECT_INVALID",
  );
  const issueTypeId = requiredIdentifier(
    issue.issueTypeId ?? nestedId(fields.issuetype),
    "JIRA_SOURCE_ISSUE_TYPE_INVALID",
  );
  const providerUpdatedAt = requiredDate(
    issue.updated ?? fields.updated,
    "JIRA_SOURCE_ISSUE_UPDATED_INVALID",
  );
  const providerChangelogId = optionalIdentifier(
    issue.changelogId ?? lastChangelogId(issue.changelog),
    "JIRA_SOURCE_ISSUE_CHANGELOG_INVALID",
  );
  const authorityFields = Object.freeze({
    project: Object.freeze({ id: projectId }),
    issuetype: Object.freeze({ id: issueTypeId }),
    updated: providerUpdatedAt,
  });
  return Object.freeze({
    externalEntityId,
    projectId,
    issueTypeId,
    providerUpdatedAt,
    ...(providerChangelogId ? { providerChangelogId } : {}),
    authorityFields,
  });
}

/**
 * Deterministic immutable-ref convention shared by intake fixtures and the
 * effect-time authoritative source read. It mirrors Jira request read-back:
 * updated + changelog when available, otherwise updated + authority hash.
 */
export function qaJiraSourceRefFromObservation(
  observation: QaJiraSourceIssueObservation,
): OperationalImmutableRef {
  const contentHash = sha256(observation.authorityFields as JsonValue);
  return Object.freeze({
    kind: "JIRA_ISSUE",
    id: observation.externalEntityId,
    version: `${observation.providerUpdatedAt}:${observation.providerChangelogId ?? contentHash}`,
    contentHash,
  });
}

function sourceEntries(resolved: QaJiraResolvedPins) {
  const primary = resolved.entries[0];
  const source = resolved.entries[1];
  if (
    resolved.entries.length !== 2 ||
    primary?.pin.sequence !== 0 ||
    primary.pin.purpose !== "PRIMARY" ||
    primary.pin.logicalRole !== "QA_REQUEST_AUTHORITY" ||
    source?.pin.sequence !== 1 ||
    source.pin.purpose !== "AUXILIARY" ||
    source.pin.logicalRole !== "SOURCE_CONTEXT"
  )
    throw new Error("JIRA_SOURCE_CONTEXT_PIN_CHAIN_INVALID");
  if (
    !sameRef(primary.pin.connectionRef, source.pin.connectionRef) ||
    primary.pin.authorityNamespaceHash !== source.pin.authorityNamespaceHash ||
    primary.pin.adapterFamily !== source.pin.adapterFamily ||
    source.pin.adapterFamily !== resolved.adapterFamily ||
    primary.pin.adapterContractVersion !== source.pin.adapterContractVersion
  )
    throw new Error("JIRA_SOURCE_CONTEXT_SAME_CONNECTION_REQUIRED");
  return Object.freeze({ primary, source });
}

/** Resolve the selected native link tuple and prove it is auxiliary-allowlisted. */
export function resolveQaJiraSourceLinkPolicy(
  resolved: QaJiraResolvedPins,
): QaJiraSourceLinkPolicy {
  const { primary, source } = sourceEntries(resolved);
  const primaryProfile = primary.profileContent;
  const sourceProfile = source.profileContent;
  if (sourceProfile.logicalRole !== "SOURCE_CONTEXT")
    throw new Error("JIRA_SOURCE_CONTEXT_PROFILE_ROLE_INVALID");
  const policy = record(primaryProfile.sourceLinkPolicy, "JIRA_SOURCE_LINK_POLICY_REQUIRED");
  if (policy.strategy !== "NATIVE_SAME_AUTHORITY")
    throw new Error("JIRA_SOURCE_LINK_STRATEGY_UNSUPPORTED");
  const typeId = requiredIdentifier(policy.typeId, "JIRA_SOURCE_LINK_TYPE_INVALID");
  const direction = policy.direction;
  if (direction !== "INWARD" && direction !== "OUTWARD")
    throw new Error("JIRA_SOURCE_LINK_DIRECTION_INVALID");
  if (!Array.isArray(sourceProfile.jiraLinkTypes))
    throw new Error("JIRA_SOURCE_LINK_ALLOWLIST_REQUIRED");
  const allowed = sourceProfile.jiraLinkTypes.some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const link = entry as RecordValue;
    return link.typeId === typeId && link.direction === direction;
  });
  if (!allowed) throw new Error("JIRA_SOURCE_LINK_NOT_ALLOWLISTED");
  return Object.freeze({ typeId, direction });
}

function sourceScope(
  resolved: QaJiraResolvedPins,
): Readonly<{ projectId: string; issueTypeId: string }> {
  const { source } = sourceEntries(resolved);
  const projects = exactIdentifierArray(
    source.profileContent.allowedProjectIds,
    "JIRA_SOURCE_PROJECT_SCOPE_NOT_EXACT",
  );
  const issueTypes = exactIdentifierArray(
    source.profileContent.allowedIssueTypeIds,
    "JIRA_SOURCE_ISSUE_TYPE_SCOPE_NOT_EXACT",
  );
  return Object.freeze({ projectId: projects[0]!, issueTypeId: issueTypes[0]! });
}

async function authoritativeSourceRead(
  resolved: QaJiraResolvedPins,
  externalEntityId: string,
  transport: JiraTransport,
  signal?: AbortSignal,
): Promise<QaJiraSourceIssueObservation> {
  const { source } = sourceEntries(resolved);
  const connection = source.connectionContent;
  const endpoint = connection.endpoint;
  if (typeof endpoint !== "string" || endpoint.length === 0)
    throw new Error("JIRA_SOURCE_ENDPOINT_REQUIRED");
  if (connection.environmentScope !== "LOCAL")
    throw new Error("JIRA_SOURCE_LOCAL_CONNECTION_REQUIRED");
  if (
    connection.adapterFamily !== source.pin.adapterFamily ||
    connection.adapterContractVersion !== source.pin.adapterContractVersion
  )
    throw new Error("JIRA_SOURCE_ADAPTER_PIN_MISMATCH");
  const baseUrl = new URL(endpoint);
  const client = new JiraRestClient({
    baseUrl: baseUrl.href,
    environment: "LOCAL",
    allowedOrigins: [baseUrl.origin],
    allowedLocalHostnames: [baseUrl.hostname],
    transport,
  });
  const dialect = createJiraDialect(resolved.adapterFamily);
  const query = new URLSearchParams({ fields: "project,issuetype,updated", expand: "changelog" });
  const response = await client.request({
    method: "GET",
    path: `${dialect.issuePath(externalEntityId)}?${query}`,
    ...(signal ? { signal } : {}),
  });
  try {
    return normalizeQaJiraSourceIssueObservation(await response.json());
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("JIRA_SOURCE_")) throw error;
    throw new Error("JIRA_SOURCE_ISSUE_RESPONSE_INVALID", { cause: error });
  }
}

const emptyPlan: QaJiraSourceContextPlan = Object.freeze({
  subEffects: Object.freeze([] as RequestSubEffect[]),
});

function exactSourceReference(
  request: Pick<OperationalRequestCreateInput, "sourceRefs">,
): OperationalImmutableRef | undefined {
  const sourceRefs = request.sourceRefs ?? [];
  if (sourceRefs.length === 0) return undefined;
  if (sourceRefs.length !== 1 || sourceRefs[0]?.kind !== "JIRA_ISSUE") {
    throw new Error("JIRA_SOURCE_REFERENCE_EXACTLY_ONE_REQUIRED");
  }
  const sourceRef = sourceRefs[0];
  requiredIdentifier(sourceRef.id, "JIRA_SOURCE_REFERENCE_ID_INVALID");
  if (!sourceRef.version) throw new Error("JIRA_SOURCE_REFERENCE_VERSION_INVALID");
  if (!digest.test(sourceRef.contentHash)) throw new Error("JIRA_SOURCE_REFERENCE_HASH_INVALID");
  return sourceRef;
}

/**
 * Build the immutable source sub-effect plan without reading mutable Jira
 * state. The authoritative version/hash check is deliberately separate so a
 * caller can place it immediately before the first central issue create.
 *
 * This split is important for recovery: after the central issue exists, a
 * retry must reconcile the already-authorized immutable link plan even if the
 * source issue has since acquired a newer Jira revision.
 */
export function prepareQaJiraRequestSourceContext(
  input: Pick<PlanQaJiraRequestSourceContextInput, "resolved" | "request" | "effectMarker">,
): QaJiraSourceContextPlan {
  const sourceRef = exactSourceReference(input.request);
  if (!sourceRef) return emptyPlan;
  const issueLink = resolveQaJiraSourceLinkPolicy(input.resolved);
  // Validate the pinned source scope as part of planning even though its
  // mutable provider observation is checked only by the pre-create guard.
  sourceScope(input.resolved);
  const link = planSourceLink({
    sameAuthority: true,
    sourceExternalEntityId: sourceRef.id,
    effectMarker: input.effectMarker,
  });
  const requiredLink: RequestSubEffect = Object.freeze({
    ...link,
    required: true,
    payload: Object.freeze({
      ...link.payload,
      typeId: issueLink.typeId,
      direction: issueLink.direction,
    }),
  });
  return Object.freeze({
    subEffects: Object.freeze([requiredLink]),
    issueLink,
  });
}

/**
 * Build required source sub-effects before central Jira create is allowed.
 * The function performs only an exact allowlisted GET; every invalid, stale or
 * out-of-scope reference fails before the caller can invoke create service.
 */
export async function planQaJiraRequestSourceContext(
  input: PlanQaJiraRequestSourceContextInput,
): Promise<QaJiraSourceContextPlan> {
  const sourceRef = exactSourceReference(input.request);
  if (!sourceRef) return emptyPlan;
  const prepared = prepareQaJiraRequestSourceContext(input);
  const scope = sourceScope(input.resolved);
  const observation = await authoritativeSourceRead(
    input.resolved,
    sourceRef.id,
    input.transport ?? fetch,
    input.signal,
  );
  if (observation.externalEntityId !== sourceRef.id)
    throw new Error("JIRA_SOURCE_ISSUE_ID_MISMATCH");
  if (observation.projectId !== scope.projectId)
    throw new Error("JIRA_SOURCE_PROJECT_OUT_OF_SCOPE");
  if (observation.issueTypeId !== scope.issueTypeId)
    throw new Error("JIRA_SOURCE_ISSUE_TYPE_OUT_OF_SCOPE");
  const authoritativeRef = qaJiraSourceRefFromObservation(observation);
  if (sourceRef.version !== authoritativeRef.version)
    throw new Error("JIRA_SOURCE_REFERENCE_VERSION_STALE");
  if (sourceRef.contentHash !== authoritativeRef.contentHash)
    throw new Error("JIRA_SOURCE_REFERENCE_HASH_STALE");
  return Object.freeze({
    ...prepared,
    validatedSourceRef: authoritativeRef,
  });
}
