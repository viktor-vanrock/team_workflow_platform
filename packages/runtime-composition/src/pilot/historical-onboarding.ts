import { createHash, randomUUID } from "node:crypto";

import type { EntityManager } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";

type Row = Record<
  | "workspace_id"
  | "project_id"
  | "project_key"
  | "project_name"
  | "semantic_body"
  | "content_hash"
  | "criticality_key"
  | "data_classification_key"
  | "created_by"
  | "revision_id"
  | "project_operational_state"
  | "onboarding_id"
  | "intended_capability_mode"
  | "starter_entitlement_set_hash"
  | "owner_set_hash"
  | "incident_ref"
  | "actor",
  JsonValue
>;
const md5 = (value: string) => createHash("md5").update(value).digest("hex");

/** Upgrade only the exact legacy local bootstrap. Keep immutable rows and all readiness unchanged. */
export async function reconcileHistoricalSeedOnboarding(
  manager: EntityManager,
  projectIds: readonly string[],
): Promise<void> {
  const rows = (await manager.query(
    `SELECT to_jsonb(r) AS registry,to_jsonb(o) AS onboarding
     FROM projects p JOIN project_registry_revisions r ON r.workspace_id=p.workspace_id AND r.project_id=p.id AND r.version=p.current_registry_version
     JOIN project_onboarding_headers h ON h.workspace_id=p.workspace_id AND h.project_id=p.id
     JOIN project_onboarding_revisions o ON o.onboarding_id=h.onboarding_id AND o.version=h.current_version
     WHERE p.id=ANY($1::uuid[]) AND r.version=1 AND o.version=1
       AND o.reason_code='HISTORICAL_BOOTSTRAP' AND o.onboarding_stage='DRAFT'
       AND h.current_operational_state=o.project_operational_state
     FOR UPDATE OF p,h`,
    [projectIds],
  )) as { registry: Row; onboarding: Row }[];
  for (const { registry: r, onboarding: o } of rows) {
    const workspaceId = String(r.workspace_id),
      projectId = String(r.project_id);
    const legacyRegistry = {
      workspaceId,
      projectId,
      version: 1,
      key: r.project_key,
      name: r.project_name,
      ownerIds: [],
      verificationStatus: "NEEDS_REVIEW",
    };
    const legacyOnboarding = {
      stage: "DRAFT",
      qaCapabilityMode: "MANUAL_ONLY",
      operationalState: o.project_operational_state,
      gateResultRefs: [],
    };
    if (
      sha256(r.semantic_body!) !== sha256(legacyRegistry) ||
      sha256(o.semantic_body!) !== sha256(legacyOnboarding) ||
      r.content_hash !==
        `sha256:${md5(`${workspaceId}:${projectId}`)}${md5(`${projectId}:${workspaceId}`)}` ||
      o.content_hash !==
        `sha256:${md5(`${projectId}:onboarding`)}${md5(`${workspaceId}:onboarding:${projectId}`)}`
    )
      continue;
    const createdAt = new Date().toISOString();
    const registryBody = {
      ...legacyRegistry,
      revisionId: randomUUID(),
      version: 2,
      criticalityKey: r.criticality_key,
      dataClassificationKey: r.data_classification_key,
      reason: "Canonical snapshot of historical local seed; ownership still requires review",
      createdBy: r.created_by,
      createdAt,
    };
    const registry = { ...registryBody, contentHash: sha256(registryBody) };
    await manager.query(
      `INSERT INTO project_registry_revisions(revision_id,workspace_id,project_id,version,project_key,project_name,owner_ids,criticality_key,data_classification_key,verification_status,reason,created_by,created_at,semantic_body,content_hash)
       SELECT $2,workspace_id,project_id,2,project_key,project_name,owner_ids,criticality_key,data_classification_key,verification_status,$3,created_by,$4,$5,$6 FROM project_registry_revisions WHERE revision_id=$1`,
      [
        r.revision_id,
        registry.revisionId,
        registry.reason,
        createdAt,
        JSON.stringify(registry),
        registry.contentHash,
      ],
    );
    const onboardingBody = {
      ...legacyOnboarding,
      workspaceId,
      projectId,
      revisionId: randomUUID(),
      onboardingId: o.onboarding_id,
      version: 2,
      intendedCapabilityMode: o.intended_capability_mode,
      projectRegistryRef: {
        id: registry.revisionId,
        version: 2,
        contentHash: registry.contentHash,
      },
      starterEntitlementSetHash: o.starter_entitlement_set_hash,
      ownerSetHash: o.owner_set_hash,
      reasonCode: "HISTORICAL_BOOTSTRAP",
      reason: "Canonical snapshot of historical local seed without readiness",
      ...(o.incident_ref ? { incidentRef: o.incident_ref } : {}),
      actor: o.actor,
      correlationId: "local-seed-canonical-onboarding",
      createdAt,
    };
    const onboarding = { ...onboardingBody, contentHash: sha256(onboardingBody) };
    await manager.query(
      `INSERT INTO project_onboarding_revisions(revision_id,onboarding_id,workspace_id,project_id,version,onboarding_stage,qa_capability_mode,project_operational_state,intended_capability_mode,project_registry_ref,starter_entitlement_set_hash,gate_result_refs,owner_set_hash,reason_code,reason,incident_ref,actor,correlation_id,created_at,semantic_body,content_hash)
       SELECT $2,onboarding_id,workspace_id,project_id,2,onboarding_stage,qa_capability_mode,project_operational_state,intended_capability_mode,$3,starter_entitlement_set_hash,gate_result_refs,owner_set_hash,reason_code,$4,incident_ref,actor,$5,$6,$7,$8 FROM project_onboarding_revisions WHERE revision_id=$1`,
      [
        o.revision_id,
        onboarding.revisionId,
        JSON.stringify(onboarding.projectRegistryRef),
        onboarding.reason,
        onboarding.correlationId,
        createdAt,
        JSON.stringify(onboarding),
        onboarding.contentHash,
      ],
    );
    await manager.query(
      "UPDATE projects SET current_registry_version=2,row_version=row_version+1 WHERE workspace_id=$1 AND id=$2",
      [workspaceId, projectId],
    );
    await manager.query(
      "UPDATE project_onboarding_headers SET current_version=2,row_version=row_version+1,updated_at=$3 WHERE workspace_id=$1 AND project_id=$2",
      [workspaceId, projectId, createdAt],
    );
  }
}
