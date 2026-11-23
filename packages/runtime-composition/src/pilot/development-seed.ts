import type { DataSource } from "typeorm";

import type { RuntimeEnvironment } from "../config/environment.ts";
import { localSeedIds } from "../seed/local-seed.ts";
import { techWritingIds } from "../seed/tech-writing-local-seed.ts";
import { createPilotDevelopmentComposition } from "./composition.ts";
import { reconcileHistoricalSeedOnboarding } from "./historical-onboarding.ts";

/** Conservative local bootstrap; canonicalizes legacy seed snapshots without granting readiness. */
export async function ensurePilotDevelopmentProjects(
  source: DataSource,
  environment: RuntimeEnvironment,
): Promise<void> {
  createPilotDevelopmentComposition(environment);
  await bootstrapSeedProjects(source);
}

/** Fresh local seeds run after migrations, so historical migration backfills cannot see them. */
export async function ensureLocalSeedProjectOnboarding(
  source: DataSource,
  environment: RuntimeEnvironment,
): Promise<void> {
  if (
    environment.profile !== "local" ||
    environment.environmentScope !== "LOCAL" ||
    environment.externalNetworkMode !== "deny" ||
    environment.deployment
  )
    throw new Error("LOCAL_PROJECT_BOOTSTRAP_FORBIDDEN");
  await bootstrapSeedProjects(source);
}

async function bootstrapSeedProjects(source: DataSource): Promise<void> {
  const projectIds = [
    localSeedIds.alpha,
    localSeedIds.beta,
    localSeedIds.gamma,
    localSeedIds.delta,
    techWritingIds.project,
  ];
  await source.transaction(async (manager) => {
    await manager.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('pilot-development-project-bootstrap',0))",
    );
    await manager.query(
      `INSERT INTO project_registry_revisions(revision_id,workspace_id,project_id,version,project_key,project_name,owner_ids,criticality_key,data_classification_key,verification_status,reason,created_at,semantic_body,content_hash)
      SELECT id,workspace_id,id,1,key,name,'[]'::jsonb,'UNCLASSIFIED',classification_key,'NEEDS_REVIEW','Development seed without corporate conformance',created_at,
      jsonb_build_object('workspaceId',workspace_id,'projectId',id,'version',1,'key',key,'name',name,'ownerIds','[]'::jsonb,'verificationStatus','NEEDS_REVIEW'),
      'sha256:'||md5(workspace_id::text||':'||id::text)||md5(id::text||':'||workspace_id::text) FROM projects p
      WHERE p.id=ANY($1::uuid[]) AND NOT EXISTS(SELECT 1 FROM project_registry_revisions r WHERE r.workspace_id=p.workspace_id AND r.project_id=p.id)`,
      [projectIds],
    );
    await manager.query(
      `INSERT INTO project_onboarding_headers(onboarding_id,workspace_id,project_id,current_version,current_stage,current_capability_mode,current_operational_state,intended_capability_mode,row_version,created_at,updated_at)
      SELECT id,workspace_id,id,1,'DRAFT','MANUAL_ONLY',p.state,'MANUAL_ONLY',1,created_at,created_at FROM projects p
      WHERE p.id=ANY($1::uuid[]) AND NOT EXISTS(SELECT 1 FROM project_onboarding_headers h WHERE h.workspace_id=p.workspace_id AND h.project_id=p.id)`,
      [projectIds],
    );
    await manager.query(
      `INSERT INTO project_onboarding_revisions(revision_id,onboarding_id,workspace_id,project_id,version,onboarding_stage,qa_capability_mode,project_operational_state,intended_capability_mode,project_registry_ref,starter_entitlement_set_hash,gate_result_refs,owner_set_hash,reason_code,reason,incident_ref,actor,correlation_id,created_at,semantic_body,content_hash)
      SELECT id,id,workspace_id,id,1,'DRAFT','MANUAL_ONLY',p.state,'MANUAL_ONLY',
      jsonb_build_object('id',id,'version',1,'contentHash','sha256:'||md5(workspace_id::text||':'||id::text)||md5(id::text||':'||workspace_id::text)),
      'sha256:'||repeat('0',64),'[]'::jsonb,'sha256:'||repeat('0',64),'HISTORICAL_BOOTSTRAP','Development seed without readiness',CASE WHEN p.state='SUSPENDED' THEN 'seed:development:suspended-project' ELSE NULL END,
      jsonb_build_object('kind','SERVICE','serviceKey','development-seed'),'development-seed',created_at,
      jsonb_build_object('stage','DRAFT','qaCapabilityMode','MANUAL_ONLY','operationalState',p.state,'gateResultRefs','[]'::jsonb),
      'sha256:'||md5(id::text||':onboarding')||md5(workspace_id::text||':onboarding:'||id::text) FROM projects p
      WHERE p.id=ANY($1::uuid[]) AND NOT EXISTS(SELECT 1 FROM project_onboarding_revisions r WHERE r.workspace_id=p.workspace_id AND r.project_id=p.id)`,
      [projectIds],
    );
    await reconcileHistoricalSeedOnboarding(manager, projectIds);
  });
}
