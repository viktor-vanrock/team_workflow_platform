import {
  QaSessionGuard,
  type QaSessionRequest,
} from "../../apps/api/src/extensions/qa-api-authorization.ts";
import { authorizeLocalQaApi } from "../../apps/api/src/local/local-qa-authorization.ts";
import {
  qaAggregateSnapshotHash,
  TypeOrmManualSessionRepository,
} from "../../packages/competency-qa/src/node.ts";
import type { DataSource } from "../../packages/platform-persistence-typeorm/node_modules/typeorm/index.js";
import { strongSessionEtag } from "../../packages/runtime-composition/src/index.ts";

/** Direct-controller fixtures explicitly supply identity; HTTP tests use real IdP guards. */
export async function localQaTestRequest(source: DataSource, personaKey: string) {
  const request = { headers: {}, localPersonaKey: personaKey, method: "POST" };
  const guard = new QaSessionGuard({
    authenticate:
      async () =>
      async ({ scope, permission }) =>
        await authorizeLocalQaApi(source, request, scope.workspaceId, scope.projectId, permission),
  });
  await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as never);
  return request satisfies QaSessionRequest;
}

export async function currentManualSessionEtag(
  source: DataSource,
  scope: Readonly<{ workspaceId: string; projectId: string }>,
  sessionId: string,
): Promise<string> {
  const session = await new TypeOrmManualSessionRepository(source).get(scope, sessionId);
  if (!session) throw new Error("TEST_SESSION_NOT_FOUND");
  return strongSessionEtag({
    sourceId: session.id,
    sourceVersion: session.resourceVersion,
    semanticHash: qaAggregateSnapshotHash(session as never),
  });
}

/** Mirror the conservative 007 historical bootstrap for projects seeded after migrations. No readiness or pilot gates are granted. */
export async function bootstrapLegacyQaFixtureProjects(source: DataSource): Promise<void> {
  await source.transaction(async (manager) => {
    await manager.query(`INSERT INTO project_registry_revisions(revision_id,workspace_id,project_id,version,project_key,project_name,owner_ids,criticality_key,data_classification_key,verification_status,reason,created_at,semantic_body,content_hash)
      SELECT id,workspace_id,id,1,key,name,'[]'::jsonb,'UNCLASSIFIED',classification_key,'NEEDS_REVIEW','Legacy QA test fixture bootstrap',created_at,
      jsonb_build_object('workspaceId',workspace_id,'projectId',id,'version',1,'key',key,'name',name,'ownerIds','[]'::jsonb,'verificationStatus','NEEDS_REVIEW'),
      'sha256:'||md5(workspace_id::text||':'||id::text)||md5(id::text||':'||workspace_id::text) FROM projects p
      WHERE NOT EXISTS(SELECT 1 FROM project_registry_revisions r WHERE r.workspace_id=p.workspace_id AND r.project_id=p.id)`);
    await manager.query(`INSERT INTO project_onboarding_headers(onboarding_id,workspace_id,project_id,current_version,current_stage,current_capability_mode,current_operational_state,intended_capability_mode,row_version,created_at,updated_at)
      SELECT id,workspace_id,id,1,'DRAFT','MANUAL_ONLY','ACTIVE','MANUAL_ONLY',1,created_at,created_at FROM projects p
      WHERE NOT EXISTS(SELECT 1 FROM project_onboarding_headers h WHERE h.workspace_id=p.workspace_id AND h.project_id=p.id)`);
    await manager.query(`INSERT INTO project_onboarding_revisions(revision_id,onboarding_id,workspace_id,project_id,version,onboarding_stage,qa_capability_mode,project_operational_state,intended_capability_mode,project_registry_ref,starter_entitlement_set_hash,gate_result_refs,owner_set_hash,reason_code,reason,actor,correlation_id,created_at,semantic_body,content_hash)
      SELECT id,id,workspace_id,id,1,'DRAFT','MANUAL_ONLY','ACTIVE','MANUAL_ONLY',
      jsonb_build_object('id',id,'version',1,'contentHash','sha256:'||md5(workspace_id::text||':'||id::text)||md5(id::text||':'||workspace_id::text)),
      'sha256:'||repeat('0',64),'[]'::jsonb,'sha256:'||repeat('0',64),'HISTORICAL_BOOTSTRAP','Legacy QA test fixture without readiness',
      jsonb_build_object('kind','SERVICE','serviceKey','legacy-test-fixture'),'legacy-test-fixture',created_at,
      jsonb_build_object('stage','DRAFT','qaCapabilityMode','MANUAL_ONLY','operationalState','ACTIVE','gateResultRefs','[]'::jsonb),
      'sha256:'||md5(id::text||':onboarding')||md5(workspace_id::text||':onboarding:'||id::text) FROM projects p
      WHERE NOT EXISTS(SELECT 1 FROM project_onboarding_revisions r WHERE r.workspace_id=p.workspace_id AND r.project_id=p.id)`);
  });
}
