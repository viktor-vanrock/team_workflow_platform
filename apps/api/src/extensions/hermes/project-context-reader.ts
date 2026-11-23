import type { EntityManager } from "typeorm";

import type { HermesProjectContext } from "@awp/runtime-composition";

import { currentAuthority, reject } from "../onboarding/durable-http.ts";
import type { HermesMattermostBinding } from "./mattermost-config.ts";

export async function readMattermostProjectContext(
  manager: EntityManager,
  b: HermesMattermostBinding,
  externalUserId: string,
  permission: string,
) {
  if (Date.parse(b.validUntil) <= Date.now())
    return reject("HERMES_MATTERMOST_BINDING_EXPIRED", 403);
  const mappings = (await manager.query(
    `SELECT e.principal_id,e.resource_version FROM external_principal_bindings e
 JOIN connection_headers h ON h.workspace_id=e.workspace_id AND h.id::text=e.connection_header_id
 JOIN connection_revisions r ON r.workspace_id=h.workspace_id AND r.header_id=h.id AND r.version=h.current_published_version
 WHERE e.workspace_id=$1 AND e.connection_header_id=$2 AND e.provider_namespace=$3 AND e.external_principal_id=$4 AND e.external_principal_kind='EXTERNAL_HUMAN'
 AND e.state='VERIFIED' AND e.revoked_at IS NULL AND e.verified_at IS NOT NULL AND e.verification_evidence_hash IS NOT NULL
 AND r.status='PUBLISHED' AND r.content->>'connectorKey'='mattermost.hermes-intake' AND r.content->>'projectId'=$5`,
    [b.workspaceId, b.connectionHeaderId, b.providerNamespace, externalUserId, b.projectId],
  )) as { principal_id: string; resource_version: number | string }[];
  if (mappings.length !== 1) return reject("HERMES_MATTERMOST_IDENTITY_REQUIRED", 403);
  const principalId = mappings[0]!.principal_id,
    scope = { kind: "PROJECT" as const, workspaceId: b.workspaceId, projectId: b.projectId };
  const authority = await currentAuthority(manager, scope, principalId, permission);
  if (!["PUBLIC", "INTERNAL"].includes(authority.classification))
    return reject("HERMES_CONTEXT_CLASSIFICATION_DENIED", 403);
  const rows = (await manager.query(
    `SELECT p.key,p.name,p.row_version,r0.reason AS purpose,h.current_stage,h.current_capability_mode,
 q.version AS qa_version,jsonb_array_length(q.environment_refs) AS environments,jsonb_array_length(COALESCE(q.semantic_body->'checklistPolicyRefs','[]'::jsonb)) AS checklists
 FROM projects p JOIN workspaces w ON w.id=p.workspace_id
 JOIN project_registry_revisions r0 ON r0.workspace_id=p.workspace_id AND r0.project_id=p.id AND r0.version=1
 JOIN project_onboarding_headers h ON h.workspace_id=p.workspace_id AND h.project_id=p.id
 LEFT JOIN qa_project_context_headers_v2 qh ON qh.workspace_id=p.workspace_id AND qh.project_id=p.id
 LEFT JOIN qa_project_context_revisions_v2 q ON q.workspace_id=qh.workspace_id AND q.project_id=qh.project_id AND q.context_id=qh.context_id AND q.version=qh.current_published_version AND q.state='PUBLISHED'
 WHERE p.workspace_id=$1 AND p.id=$2 AND w.state='ACTIVE' AND p.state='ACTIVE' AND p.registration_status='ACTIVE'`,
    [b.workspaceId, b.projectId],
  )) as {
    key: string;
    name: string;
    row_version: number;
    purpose: string;
    current_stage: string;
    current_capability_mode: string;
    qa_version: number | null;
    environments: number;
    checklists: number;
  }[];
  const p = rows[0];
  if (!p) return reject("HERMES_PROJECT_UNAVAILABLE", 403);
  const context: HermesProjectContext = {
    workspaceId: b.workspaceId,
    projectId: b.projectId,
    version: p.row_version,
    key: p.key,
    name: p.name,
    purpose: p.purpose.slice(0, 2000),
    stage: p.current_stage,
    capability: p.current_capability_mode,
    ...(p.qa_version
      ? { qa: { version: p.qa_version, environments: p.environments, checklists: p.checklists } }
      : {}),
  };
  return {
    principalId,
    authority,
    context,
    identityVersion: Number(mappings[0]!.resource_version),
  };
}
