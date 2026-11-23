import { randomUUID } from "node:crypto";

import { qaValidationCapabilityRequirementSetV1 } from "../../packages/competency-qa/src/node.ts";
import type { DataSource } from "../../packages/platform-persistence-typeorm/node_modules/typeorm/index.js";

export async function seed008CapabilityPlan(
  source: Pick<DataSource, "query">,
  scope: { workspaceId: string; projectId: string },
) {
  const { workspaceId, projectId } = scope;
  const profileId = randomUUID(),
    connectionId = randomUUID(),
    bindingId = randomUUID(),
    contextId = randomUUID();
  const digest = `sha256:${"a".repeat(64)}` as const;
  const reference = (id: string) => ({ id, version: 1, contentHash: digest });
  await source.query(
    "INSERT INTO connection_headers(id,workspace_id,key,current_published_version) VALUES($1,$2,'pilot-probe-jira',1)",
    [connectionId, workspaceId],
  );
  await source.query(
    "INSERT INTO connection_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED','{}',$4,now())",
    [randomUUID(), workspaceId, connectionId, digest],
  );
  await source.query(
    "INSERT INTO connector_profile_headers(id,workspace_id,key,current_published_version) VALUES($1,$2,'pilot-probe-jira',1)",
    [profileId, workspaceId],
  );
  await source.query(
    "INSERT INTO connector_profile_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,now())",
    [
      randomUUID(),
      workspaceId,
      profileId,
      JSON.stringify({
        connectionRef: reference(connectionId),
        capabilityConfigurations: [
          {
            capabilityKey: "operational-work-item",
            exactContractVersion: "1.0.0",
            environmentScopes: ["LOCAL"],
            operations: [
              "request.create",
              "request.transition",
              "request.read",
              "defect.create",
            ].map((operation) => ({ operation })),
          },
        ],
      }),
      digest,
    ],
  );
  await source.query(
    "INSERT INTO project_integration_binding_headers(id,workspace_id,project_id,key,current_published_version) VALUES($1,$2,$3,'pilot-probe-current',1)",
    [bindingId, workspaceId, projectId],
  );
  const entries = ["QA_REQUEST_AUTHORITY", "SOURCE_CONTEXT", "DEFECT_DESTINATION"].map(
    (logicalRole) => ({
      logicalRole,
      capabilityKey: "operational-work-item",
      exactContractVersion: "1.0.0",
      environmentScope: "LOCAL",
      profileRef: reference(profileId),
    }),
  );
  await source.query(
    "INSERT INTO project_integration_binding_revisions(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,1,'PUBLISHED',$5,$6,now())",
    [randomUUID(), workspaceId, projectId, bindingId, JSON.stringify({ entries }), digest],
  );
  const reportId = randomUUID();
  await source.query(
    "INSERT INTO integration_validation_reports(id,workspace_id,project_id,subject_kind,subject_id,subject_version,outcome,content_hash,report,created_at) VALUES($1,$2,$3,'BINDING',$4,1,'VALID',$5,$6,now())",
    [
      reportId,
      workspaceId,
      projectId,
      bindingId,
      digest,
      JSON.stringify({ id: reportId, status: "VALID" }),
    ],
  );
  await source.query(
    "INSERT INTO qa_project_context_headers_v2(context_id,workspace_id,project_id,current_version,current_published_version) VALUES($1,$2,$3,1,1)",
    [contextId, workspaceId, projectId],
  );
  const requirement = {
    ...qaValidationCapabilityRequirementSetV1.ref,
    version: "1",
    kind: "CAPABILITY_REQUIREMENT_SET",
  };
  await source.query(
    "INSERT INTO qa_project_context_revisions_v2(revision_id,context_id,workspace_id,project_id,version,state,environment_refs,test_data_catalog_refs,account_pool_refs,policy_refs,maximum_classification_key,resource_version,published_at,created_by,published_by,semantic_body,content_hash) VALUES($1,$2,$3,$4,1,'PUBLISHED','[]','[]','[]',$5,'INTERNAL',1,now(),'{}','{}',$6,$7)",
    [
      randomUUID(),
      contextId,
      workspaceId,
      projectId,
      JSON.stringify({ capabilityRequirementSetRef: requirement }),
      JSON.stringify({ capabilityRequirementSetRef: requirement }),
      digest,
    ],
  );
  return { bindingId, profileId, connectionId, contextId };
}
