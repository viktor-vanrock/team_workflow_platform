import type { MigrationInterface } from "typeorm";

import { QaDomainError } from "../domain/primitives.ts";

export const qaMigrationOrders = Object.freeze([
  2000, 2005, 2010, 2015, 2020, 2025, 2030, 2040, 2050, 2055, 2060, 2070, 2080, 2085, 2090, 2095,
  2100, 2110, 2115,
] as const);
export type QaMigrationOrder = (typeof qaMigrationOrders)[number];

export interface QaPersistenceInventorySlice {
  readonly order: QaMigrationOrder;
  readonly key: string;
  readonly sourcePath: string;
  readonly tables: readonly string[];
}

export interface QaMigrationContribution {
  readonly order: QaMigrationOrder;
  readonly owner: "pack:qa";
  readonly migration: new () => MigrationInterface;
  readonly tables: readonly string[];
}

export interface QaEntityContribution {
  readonly migrationOrder: QaMigrationOrder;
  readonly tableName: string;
  readonly entity: unknown;
}

export const qaPersistenceInventory = Object.freeze([
  Object.freeze({
    order: 2000,
    key: "qa_context_policy_requests",
    sourcePath:
      "packages/competency-qa/src/persistence/migrations/2000-qa-context-policy-requests.ts",
    tables: Object.freeze([
      "qa_project_contexts",
      "qa_project_context_versions",
      "qa_risk_review_policies",
      "qa_risk_review_policy_versions",
      "qa_request_extensions",
      "qa_request_input_revisions",
    ]),
  }),
  Object.freeze({
    order: 2005,
    key: "qa_readiness_required_plans",
    sourcePath:
      "packages/competency-qa/src/persistence/migrations/2005-qa-readiness-required-plans.ts",
    tables: Object.freeze([
      "qa_readiness_assessments",
      "qa_waivers",
      "qa_required_session_plans",
      "qa_required_session_plan_versions",
      "qa_required_session_plan_requirements",
    ]),
  }),
  Object.freeze({
    order: 2010,
    key: "qa_session_planning",
    sourcePath: "packages/competency-qa/src/persistence/migrations/2010-qa-session-planning.ts",
    tables: Object.freeze(["qa_test_sessions", "qa_plan_items"]),
  }),
  Object.freeze({
    order: 2015,
    key: "qa_manual_execution",
    sourcePath: "packages/competency-qa/src/persistence/migrations/2015-qa-manual-execution.ts",
    tables: Object.freeze([
      "qa_manual_attempts",
      "qa_plan_item_result_revisions",
      "qa_plan_item_result_attempt_memberships",
      "qa_plan_item_result_observation_memberships",
      "qa_observations",
    ]),
  }),
  Object.freeze({
    order: 2020,
    key: "qa_evidence_review",
    sourcePath: "packages/competency-qa/src/persistence/migrations/2020-qa-evidence-review.ts",
    tables: Object.freeze([
      "qa_evidence_artifact_links",
      "qa_plan_item_result_evidence_memberships",
      "qa_evidence_manifest_artifact_memberships",
      "qa_evidence_manifests",
      "qa_evidence_manifest_revisions",
      "qa_session_reviews",
    ]),
  }),
  Object.freeze({
    order: 2025,
    key: "qa_findings_defect_publication",
    sourcePath:
      "packages/competency-qa/src/persistence/migrations/2025-qa-findings-defect-publication.ts",
    tables: Object.freeze([
      "qa_findings",
      "qa_finding_observations",
      "qa_finding_review_revisions",
      "qa_plan_item_result_flaky_observation_memberships",
      "qa_defect_drafts",
      "qa_defect_links",
    ]),
  }),
  Object.freeze({
    order: 2030,
    key: "qa_verdict_completion",
    sourcePath: "packages/competency-qa/src/persistence/migrations/2030-qa-verdict-completion.ts",
    tables: Object.freeze([
      "qa_verdicts",
      "qa_verdict_signatures",
      "qa_dod_assessments",
      "qa_completion_candidates",
      "qa_final_close_confirmations",
      "qa_post_close_correction_markers",
    ]),
  }),
  Object.freeze({
    order: 2040,
    key: "qa_hermes_proposals",
    sourcePath: "packages/competency-qa/src/persistence/migrations/2040-hermes-proposals.ts",
    tables: Object.freeze(["qa_triage_assessments", "qa_session_plan_proposals"]),
  }),
  Object.freeze({
    order: 2050,
    key: "qa_automation_foundation",
    sourcePath:
      "packages/competency-qa/src/persistence/migrations/2050-qa-automation-foundation.ts",
    tables: Object.freeze([
      "qa_automation_suite_bindings",
      "qa_automation_suite_binding_versions",
      "qa_automation_suite_validation_reports",
      "qa_automation_session_configuration_pins",
      "qa_attempt_identities",
    ]),
  }),
  Object.freeze({
    order: 2055,
    key: "qa_automation_execution",
    sourcePath: "packages/competency-qa/src/persistence/migrations/2055-qa-automation-execution.ts",
    tables: Object.freeze([
      "qa_automation_launch_requests",
      "qa_automation_attempts",
      "qa_automation_attempt_status_revisions",
      "qa_automation_attempt_results",
      "qa_automation_retry_decisions",
      "qa_automation_artifact_memberships",
    ]),
  }),
  Object.freeze({
    order: 2060,
    key: "qa_automation_review_quarantine",
    sourcePath:
      "packages/competency-qa/src/persistence/migrations/2060-qa-automation-review-quarantine.ts",
    tables: Object.freeze([
      "qa_automation_quarantines",
      "qa_automation_quarantine_revisions",
      "qa_automation_review_freezes",
    ]),
  }),
  Object.freeze({
    order: 2070,
    key: "qa_queue_facts",
    sourcePath: "packages/competency-qa/src/persistence/migrations/2070-qa-queue-facts.ts",
    tables: Object.freeze([
      "qa_queue_fact_heads",
      "qa_queue_fact_revisions",
      "qa_queue_fact_current_indexes",
    ]),
  }),
  Object.freeze({
    order: 2080,
    key: "qa_project_resources_v2",
    sourcePath: "packages/competency-qa/src/persistence/migrations/2080-project-resources.ts",
    tables: Object.freeze([
      "qa_project_context_headers_v2",
      "qa_project_context_revisions_v2",
      "qa_project_environment_headers",
      "qa_project_environment_revisions",
      "qa_test_data_catalog_entries",
      "qa_account_pool_references",
      "qa_test_account_leases",
      "qa_test_account_lease_heads",
    ]),
  }),
  Object.freeze({
    order: 2085,
    key: "qa_evidence_integrity_v2",
    sourcePath: "packages/competency-qa/src/persistence/migrations/2085-evidence-integrity.ts",
    tables: Object.freeze([
      "qa_target_snapshots_v2",
      "qa_evidence_manifest_headers_v2",
      "qa_evidence_manifest_revisions_v2",
      "qa_evidence_manifest_artifact_memberships_v2",
      "qa_evidence_signature_envelopes",
      "qa_evidence_packages",
    ]),
  }),
  Object.freeze({
    order: 2090,
    key: "qa_evidence_uploads",
    sourcePath: "packages/competency-qa/src/persistence/migrations/2090-evidence-uploads.ts",
    tables: Object.freeze(["qa_evidence_uploads"]),
  }),
  Object.freeze({
    order: 2095,
    key: "qa_defect_proposals",
    sourcePath: "packages/competency-qa/src/persistence/migrations/2095-defect-proposals.ts",
    tables: Object.freeze(["qa_defect_draft_proposals"]),
  }),
  Object.freeze({
    order: 2100,
    key: "qa_hermes_policy_fence",
    sourcePath: "packages/competency-qa/src/persistence/migrations/2100-hermes-policy-fence.ts",
    tables: Object.freeze([]),
  }),
  Object.freeze({
    order: 2110,
    key: "qa_resource_publication_heads",
    sourcePath:
      "packages/competency-qa/src/persistence/migrations/2110-resource-publication-heads.ts",
    tables: Object.freeze([]),
  }),
  Object.freeze({
    order: 2115,
    key: "qa_validated_incomplete_result",
    sourcePath:
      "packages/competency-qa/src/persistence/migrations/2115-validated-incomplete-result.ts",
    tables: Object.freeze([]),
  }),
] as const satisfies readonly QaPersistenceInventorySlice[]);

export function assertQaPersistenceParity(
  migrations: readonly QaMigrationContribution[],
  entities: readonly QaEntityContribution[],
): void {
  const inventory = new Map<QaMigrationOrder, QaPersistenceInventorySlice>(
    qaPersistenceInventory.map((slice) => [slice.order, slice]),
  );
  const migrationOrders = new Set<QaMigrationOrder>();
  const migrationTables = new Set<string>();
  let previousOrder = 1999;
  for (const contribution of migrations) {
    const slice = inventory.get(contribution.order);
    if (
      slice === undefined ||
      contribution.owner !== "pack:qa" ||
      contribution.order <= previousOrder ||
      migrationOrders.has(contribution.order)
    ) {
      throw new QaDomainError("QA_MIGRATION_CONTRIBUTION_INVALID");
    }
    if ([...contribution.tables].sort().join("\n") !== [...slice.tables].sort().join("\n")) {
      throw new QaDomainError("QA_MIGRATION_INVENTORY_MISMATCH");
    }
    for (const table of contribution.tables) {
      if (migrationTables.has(table)) throw new QaDomainError("QA_TABLE_OWNERSHIP_COLLISION");
      migrationTables.add(table);
    }
    migrationOrders.add(contribution.order);
    previousOrder = contribution.order;
  }

  const entityTables = new Set<string>();
  for (const contribution of entities) {
    const slice = inventory.get(contribution.migrationOrder);
    if (
      slice === undefined ||
      !migrationOrders.has(contribution.migrationOrder) ||
      !slice.tables.includes(contribution.tableName) ||
      entityTables.has(contribution.tableName)
    ) {
      throw new QaDomainError("QA_ENTITY_CONTRIBUTION_INVALID");
    }
    entityTables.add(contribution.tableName);
  }
  if ([...migrationTables].sort().join("\n") !== [...entityTables].sort().join("\n")) {
    throw new QaDomainError("QA_MIGRATION_ENTITY_PARITY_MISMATCH");
  }
}
