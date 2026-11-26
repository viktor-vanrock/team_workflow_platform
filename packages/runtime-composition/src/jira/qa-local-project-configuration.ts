import type { DataSource, EntityManager } from "typeorm";

import { qaAggregateSnapshotHash } from "@awp/competency-qa/node";

import { integrationConfigurationHash } from "../onboarding/configuration-hash.ts";
import { localSeedIds } from "../seed/local-seed.ts";
import { qaJiraLocalSeedRefs } from "../seed/qa-jira-local-seed.ts";
import { qaLocalSeedIds } from "../seed/qa-local-seed.ts";
import { jiraMappingRuntimeContent } from "./qa-connection-content.ts";

type QuerySource = Pick<DataSource | EntityManager, "query">;
type Scope = Readonly<{ workspaceId: string; projectId: string }>;

/** Resolve one current published Jira chain in the exact local project scope. */
export async function resolveLocalQaProjectConfiguration(source: QuerySource, scope: Scope) {
  if (
    scope.workspaceId === localSeedIds.workspaceFunctional &&
    scope.projectId === localSeedIds.alpha
  )
    return {
      bindingRef: qaJiraLocalSeedRefs.binding,
      profileRef: qaJiraLocalSeedRefs.profile,
      projectContextId: qaLocalSeedIds.context,
    };
  return await resolvePublishedQaProjectConfiguration(source, scope);
}

/** Resolve project-specific published configuration without local fixture fallback. */
export async function resolvePublishedQaProjectConfiguration(source: QuerySource, scope: Scope) {
  const rows = (await source.query(
    `SELECT h.id,r.version,r.content,r.content_hash FROM project_integration_binding_headers h
     JOIN project_integration_binding_revisions r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.header_id=h.id AND r.version=h.current_published_version
     WHERE h.workspace_id=$1 AND h.project_id=$2 AND r.status='PUBLISHED'`,
    [scope.workspaceId, scope.projectId],
  )) as { id: string; version: number; content: Record<string, unknown>; content_hash: string }[];
  const candidates = rows.flatMap((row) => {
    const entries = Array.isArray(row.content.entries)
      ? (row.content.entries as Record<string, unknown>[])
      : [];
    const primary = entries.filter(
      (entry) =>
        entry.logicalRole === "QA_REQUEST_AUTHORITY" &&
        entry.capabilityKey === "operational-work-item",
    );
    return primary.length === 1 ? [{ row, entry: primary[0]! }] : [];
  });
  if (candidates.length !== 1) throw new Error("QA_PROJECT_JIRA_BINDING_NOT_CONFIGURED");
  const { row, entry } = candidates[0]!;
  if (integrationConfigurationHash("project_integration_binding", row.content) !== row.content_hash)
    throw new Error("QA_PROJECT_JIRA_BINDING_HASH_INVALID");
  const profileRef = entry.profileRef as { id?: unknown; version?: unknown } | undefined;
  if (
    !profileRef ||
    typeof profileRef.id !== "string" ||
    typeof profileRef.version !== "number" ||
    !Number.isSafeInteger(profileRef.version) ||
    profileRef.version < 1
  )
    throw new Error("QA_PROJECT_JIRA_PROFILE_INVALID");
  const [profile] = (await source.query(
    `SELECT r.content,r.content_hash FROM connector_profile_headers h JOIN connector_profile_revisions r
     ON r.workspace_id=h.workspace_id AND r.header_id=h.id AND r.version=h.current_published_version
     WHERE h.workspace_id=$1 AND h.id=$2 AND r.version=$3 AND r.status='PUBLISHED'`,
    [scope.workspaceId, profileRef.id, profileRef.version],
  )) as { content: Record<string, unknown>; content_hash: string }[];
  if (
    !profile ||
    integrationConfigurationHash("connector_profile", profile.content) !== profile.content_hash
  )
    throw new Error("QA_PROJECT_JIRA_PROFILE_NOT_CURRENT");
  const mappingRef = profile.content.mappingRef as { id?: unknown; version?: unknown } | undefined;
  const [mapping] = (await source.query(
    `SELECT r.content,r.content_hash FROM connector_mapping_headers h JOIN connector_mapping_revisions r
     ON r.workspace_id=h.workspace_id AND r.header_id=h.id AND r.version=h.current_published_version
     WHERE h.workspace_id=$1 AND h.id=$2 AND r.version=$3 AND r.status='PUBLISHED'`,
    [scope.workspaceId, mappingRef?.id ?? null, mappingRef?.version ?? null],
  )) as { content: Record<string, unknown>; content_hash: string }[];
  const externalScope = entry.externalScope as
    { value?: { authorityScopeKey?: unknown } } | undefined;
  const authorityScopeKey = mapping && jiraMappingRuntimeContent(mapping.content).authorityScopeKey;
  if (
    !mapping ||
    integrationConfigurationHash("connector_mapping", mapping.content) !== mapping.content_hash ||
    typeof authorityScopeKey !== "string" ||
    !authorityScopeKey ||
    externalScope?.value?.authorityScopeKey !== authorityScopeKey
  )
    throw new Error("QA_PROJECT_JIRA_MAPPING_NOT_CURRENT");
  const contexts = (await source.query(
    `SELECT h.id,r.content,r.content_hash FROM qa_project_contexts h JOIN qa_project_context_versions r ON r.id=h.current_published_version_id AND r.workspace_id=h.workspace_id AND r.project_id=h.project_id
     WHERE h.workspace_id=$1 AND h.project_id=$2 AND r.content->>'state'='PUBLISHED'`,
    [scope.workspaceId, scope.projectId],
  )) as { id: string; content: Record<string, unknown>; content_hash: string }[];
  if (contexts.length !== 1) throw new Error("QA_PROJECT_CONTEXT_NOT_CONFIGURED");
  const { contentHash, ...contextBody } = contexts[0]!.content;
  if (
    contentHash !== contexts[0]!.content_hash ||
    qaAggregateSnapshotHash(contextBody as never) !== contentHash ||
    contextBody.workspaceId !== scope.workspaceId ||
    contextBody.projectId !== scope.projectId ||
    contextBody.contextId !== contexts[0]!.id
  )
    throw new Error("QA_PROJECT_CONTEXT_INVALID");
  return {
    bindingRef: { id: row.id, version: row.version },
    profileRef: { id: profileRef.id, version: profileRef.version },
    projectContextId: contexts[0]!.id,
    authorityScopeKey,
  };
}
