import { randomUUID } from "node:crypto";

import type { QaProjectResourceStorePort } from "../application/manage-project-resources.ts";
import type { QaScope } from "../domain/primitives.ts";
import type {
  QaAccountPoolReference,
  QaProjectEnvironmentRevision,
  QaTestDataCatalogEntry,
} from "../domain/project-resources.ts";
import type { QaProjectContextV2 } from "../domain/qa-project-context.ts";
import type { QaQueryExecutor } from "./repository-helpers.ts";

export class QaProjectResourceRepository implements QaProjectResourceStorePort {
  constructor(private readonly source: QaQueryExecutor) {}

  async environment(
    scope: QaScope,
    environmentId: string,
    version: number,
  ): Promise<QaProjectEnvironmentRevision | undefined> {
    const rows = (await this.source.query(
      "SELECT semantic_body FROM qa_project_environment_revisions WHERE workspace_id=$1 AND project_id=$2 AND environment_id=$3 AND version=$4",
      [scope.workspaceId, scope.projectId, environmentId, version],
    )) as readonly { semantic_body: QaProjectEnvironmentRevision }[];
    return rows[0]?.semantic_body;
  }

  async context(
    scope: QaScope,
    contextId: string,
    version: number,
  ): Promise<QaProjectContextV2 | undefined> {
    const rows = (await this.source.query(
      "SELECT semantic_body FROM qa_project_context_revisions_v2 WHERE workspace_id=$1 AND project_id=$2 AND context_id=$3 AND version=$4",
      [scope.workspaceId, scope.projectId, contextId, version],
    )) as readonly { semantic_body: QaProjectContextV2 }[];
    return rows[0]?.semantic_body;
  }

  async testDataEntry(
    scope: QaScope,
    entryId: string,
    version: number,
  ): Promise<QaTestDataCatalogEntry | undefined> {
    const rows = (await this.source.query(
      "SELECT semantic_body FROM qa_test_data_catalog_entries WHERE workspace_id=$1 AND project_id=$2 AND entry_id=$3 AND version=$4",
      [scope.workspaceId, scope.projectId, entryId, version],
    )) as readonly { semantic_body: QaTestDataCatalogEntry }[];
    return rows[0]?.semantic_body;
  }

  async accountPool(
    scope: QaScope,
    poolId: string,
    version: number,
  ): Promise<QaAccountPoolReference | undefined> {
    const rows = (await this.source.query(
      "SELECT semantic_body FROM qa_account_pool_references WHERE workspace_id=$1 AND project_id=$2 AND pool_id=$3 AND version=$4",
      [scope.workspaceId, scope.projectId, poolId, version],
    )) as readonly { semantic_body: QaAccountPoolReference }[];
    return rows[0]?.semantic_body;
  }

  async appendEnvironment(revision: QaProjectEnvironmentRevision): Promise<void> {
    const changed = await this.source.query(
      `INSERT INTO qa_project_environment_headers(environment_id,workspace_id,project_id,environment_key,current_version,current_published_version,row_version)
       VALUES($1,$2,$3,$4,$5,$6,1)
       ON CONFLICT(environment_id) DO UPDATE SET current_version=EXCLUDED.current_version,current_published_version=EXCLUDED.current_published_version,row_version=qa_project_environment_headers.row_version+1
       WHERE qa_project_environment_headers.workspace_id=EXCLUDED.workspace_id AND qa_project_environment_headers.project_id=EXCLUDED.project_id
         AND qa_project_environment_headers.environment_key=EXCLUDED.environment_key AND qa_project_environment_headers.current_version=EXCLUDED.current_version-1
       RETURNING current_version`,
      [
        revision.environmentId,
        revision.workspaceId,
        revision.projectId,
        revision.key,
        revision.version,
        revision.status === "PUBLISHED" ? revision.version : null,
      ],
    );
    if (!Array.isArray(changed) || changed.length !== 1)
      throw new Error("QA_PROJECT_ENVIRONMENT_VERSION_CONFLICT");
    await this.source.query(
      `INSERT INTO qa_project_environment_revisions(revision_id,environment_id,workspace_id,project_id,version,environment_name,environment_scope,owner_principal_id,data_classification_key,state,configuration_ref,allowed_test_data_policy_refs,created_by,created_at,published_at,retired_at,semantic_body,content_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        revision.revisionId,
        revision.environmentId,
        revision.workspaceId,
        revision.projectId,
        revision.version,
        revision.name,
        revision.scope,
        revision.ownerPrincipalId,
        revision.dataClassificationKey,
        revision.status,
        JSON.stringify(revision.configurationRef),
        JSON.stringify(revision.allowedTestDataPolicyRefs),
        JSON.stringify(revision.createdBy),
        revision.createdAt,
        revision.publishedAt ?? null,
        revision.retiredAt ?? null,
        JSON.stringify(revision),
        revision.contentHash,
      ],
    );
  }

  async appendTestData(revision: QaTestDataCatalogEntry): Promise<void> {
    await this.source.query(
      `INSERT INTO qa_test_data_catalog_entries(entry_id,version,workspace_id,project_id,entry_kind,external_ref,owner_principal_id,allowed_environment_refs,data_classification_key,retention_policy_ref,state,semantic_body,content_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        revision.entryId,
        revision.version,
        revision.workspaceId,
        revision.projectId,
        revision.kind,
        JSON.stringify(revision.externalRef),
        revision.ownerPrincipalId,
        JSON.stringify(revision.allowedEnvironmentRefs),
        revision.dataClassificationKey,
        JSON.stringify(revision.retentionPolicyRef),
        revision.state,
        JSON.stringify(revision),
        revision.contentHash,
      ],
    );
  }

  async appendAccountPool(revision: QaAccountPoolReference): Promise<void> {
    await this.source.query(
      `INSERT INTO qa_account_pool_references(pool_id,version,workspace_id,project_id,environment_ref,resolver_ref,owner_principal_id,maximum_concurrent_leases,maximum_lease_duration_seconds,data_classification_key,state,semantic_body,content_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        revision.poolId,
        revision.version,
        revision.workspaceId,
        revision.projectId,
        JSON.stringify(revision.environmentRef),
        JSON.stringify(revision.resolverRef),
        revision.ownerPrincipalId,
        revision.maximumConcurrentLeases,
        revision.maximumLeaseDurationSeconds,
        revision.dataClassificationKey,
        revision.state,
        JSON.stringify(revision),
        revision.contentHash,
      ],
    );
  }

  async appendContext(revision: QaProjectContextV2): Promise<void> {
    // Requests retain the shared scoped context identity FK. No legacy policy revision is invented.
    await this.source.query(
      "INSERT INTO qa_project_contexts(id,workspace_id,project_id,resource_version) VALUES($1,$2,$3,1) ON CONFLICT(id) DO NOTHING",
      [revision.contextId, revision.workspaceId, revision.projectId],
    );
    const identities = await this.source.query(
      "SELECT id FROM qa_project_contexts WHERE id=$1 AND workspace_id=$2 AND project_id=$3",
      [revision.contextId, revision.workspaceId, revision.projectId],
    );
    if (!Array.isArray(identities) || identities.length !== 1)
      throw new Error("QA_PROJECT_CONTEXT_SCOPE_CONFLICT");
    const changed = await this.source.query(
      `INSERT INTO qa_project_context_headers_v2(context_id,workspace_id,project_id,current_version,current_published_version,row_version) VALUES($1,$2,$3,$4,$5,1)
       ON CONFLICT(context_id) DO UPDATE SET current_version=EXCLUDED.current_version,current_published_version=EXCLUDED.current_published_version,row_version=qa_project_context_headers_v2.row_version+1
       WHERE qa_project_context_headers_v2.workspace_id=EXCLUDED.workspace_id AND qa_project_context_headers_v2.project_id=EXCLUDED.project_id
         AND qa_project_context_headers_v2.current_version=EXCLUDED.current_version-1 RETURNING current_version`,
      [
        revision.contextId,
        revision.workspaceId,
        revision.projectId,
        revision.version,
        revision.state === "PUBLISHED" ? revision.version : null,
      ],
    );
    if (!Array.isArray(changed) || changed.length !== 1)
      throw new Error("QA_PROJECT_CONTEXT_VERSION_CONFLICT");
    const policyRefs = {
      targetPolicyRefs: revision.targetPolicyRefs,
      scopePolicyRefs: revision.scopePolicyRefs,
      checklistPolicyRefs: revision.checklistPolicyRefs,
      defaultTargetPolicyRef: revision.defaultTargetPolicyRef,
      defaultScopePolicyRef: revision.defaultScopePolicyRef,
      defaultChecklistRefs: revision.defaultChecklistRefs,
      evidencePolicyRef: revision.evidencePolicyRef,
      retentionPolicyRef: revision.retentionPolicyRef,
      redactionPolicyRef: revision.redactionPolicyRef,
      exportPolicyRef: revision.exportPolicyRef,
      riskReviewPolicyRef: revision.riskReviewPolicyRef,
      dorRuleSetRef: revision.dorRuleSetRef,
      dodRuleSetRef: revision.dodRuleSetRef,
      capabilityRequirementSetRef: revision.capabilityRequirementSetRef,
    };
    await this.source.query(
      `INSERT INTO qa_project_context_revisions_v2(revision_id,context_id,workspace_id,project_id,version,state,environment_refs,test_data_catalog_refs,account_pool_refs,policy_refs,maximum_classification_key,resource_version,published_at,retired_at,created_by,published_by,semantic_body,content_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        randomUUID(),
        revision.contextId,
        revision.workspaceId,
        revision.projectId,
        revision.version,
        revision.state,
        JSON.stringify(revision.environmentRefs),
        JSON.stringify(revision.testDataCatalogRefs),
        JSON.stringify(revision.accountPoolRefs),
        JSON.stringify(policyRefs),
        revision.maximumClassificationKey,
        revision.resourceVersion,
        revision.publishedAt,
        revision.retiredAt ?? null,
        JSON.stringify(revision.createdBy),
        JSON.stringify(revision.publishedBy),
        JSON.stringify(revision),
        revision.contentHash,
      ],
    );
  }
}
