import type { QaMigrationContribution } from "../contributions.ts";
import { QaContextPolicyRequests20001700000002000 } from "./2000-qa-context-policy-requests.ts";
import { QaReadinessRequiredPlans20051700000002005 } from "./2005-qa-readiness-required-plans.ts";
import { QaSessionPlanning20101700000002010 } from "./2010-qa-session-planning.ts";
import { QaManualExecution20151700000002015 } from "./2015-qa-manual-execution.ts";
import { QaEvidenceReview20201700000002020 } from "./2020-qa-evidence-review.ts";
import { QaFindingsDefectPublication20251700000002025 } from "./2025-qa-findings-defect-publication.ts";
import { QaVerdictCompletion20301700000002030 } from "./2030-qa-verdict-completion.ts";
import { QaHermesProposals20401700000002040 } from "./2040-hermes-proposals.ts";
import { QaAutomationFoundation20501700000002050 } from "./2050-qa-automation-foundation.ts";
import { QaAutomationExecution20551700000002055 } from "./2055-qa-automation-execution.ts";
import { QaAutomationReviewQuarantine20601700000002060 } from "./2060-qa-automation-review-quarantine.ts";
import { QaQueueFacts20701700000002070 } from "./2070-qa-queue-facts.ts";
import { QaProjectResources20801700000002080 } from "./2080-project-resources.ts";
import { QaEvidenceIntegrity20851700000002085 } from "./2085-evidence-integrity.ts";
import { QaEvidenceUploads20901700000002090 } from "./2090-evidence-uploads.ts";
import { QaDefectProposals20951700000002095 } from "./2095-defect-proposals.ts";
import { QaHermesPolicyFence21001700000002100 } from "./2100-hermes-policy-fence.ts";
import { QaResourcePublicationHeads21101700000002110 } from "./2110-resource-publication-heads.ts";

/** Feature 005 reserves the full QA automation range before story activation. */
export const qaMigrationContributions: readonly QaMigrationContribution[] = Object.freeze([
  Object.freeze({
    order: 2000,
    owner: "pack:qa",
    migration: QaContextPolicyRequests20001700000002000,
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
    owner: "pack:qa",
    migration: QaReadinessRequiredPlans20051700000002005,
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
    owner: "pack:qa",
    migration: QaSessionPlanning20101700000002010,
    tables: Object.freeze(["qa_test_sessions", "qa_plan_items"]),
  }),
  Object.freeze({
    order: 2015,
    owner: "pack:qa",
    migration: QaManualExecution20151700000002015,
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
    owner: "pack:qa",
    migration: QaEvidenceReview20201700000002020,
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
    owner: "pack:qa",
    migration: QaFindingsDefectPublication20251700000002025,
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
    owner: "pack:qa",
    migration: QaVerdictCompletion20301700000002030,
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
    owner: "pack:qa",
    migration: QaHermesProposals20401700000002040,
    tables: Object.freeze(["qa_triage_assessments", "qa_session_plan_proposals"]),
  }),
  Object.freeze({
    order: 2050,
    owner: "pack:qa",
    migration: QaAutomationFoundation20501700000002050,
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
    owner: "pack:qa",
    migration: QaAutomationExecution20551700000002055,
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
    owner: "pack:qa",
    migration: QaAutomationReviewQuarantine20601700000002060,
    tables: Object.freeze([
      "qa_automation_quarantines",
      "qa_automation_quarantine_revisions",
      "qa_automation_review_freezes",
    ]),
  }),
  Object.freeze({
    order: 2070,
    owner: "pack:qa",
    migration: QaQueueFacts20701700000002070,
    tables: Object.freeze([
      "qa_queue_fact_heads",
      "qa_queue_fact_revisions",
      "qa_queue_fact_current_indexes",
    ]),
  }),
  Object.freeze({
    order: 2080,
    owner: "pack:qa",
    migration: QaProjectResources20801700000002080,
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
    owner: "pack:qa",
    migration: QaEvidenceIntegrity20851700000002085,
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
    owner: "pack:qa",
    migration: QaEvidenceUploads20901700000002090,
    tables: Object.freeze(["qa_evidence_uploads"]),
  }),
  Object.freeze({
    order: 2095,
    owner: "pack:qa",
    migration: QaDefectProposals20951700000002095,
    tables: Object.freeze(["qa_defect_draft_proposals"]),
  }),
  Object.freeze({
    order: 2100,
    owner: "pack:qa",
    migration: QaHermesPolicyFence21001700000002100,
    tables: Object.freeze([]),
  }),
  Object.freeze({
    order: 2110,
    owner: "pack:qa",
    migration: QaResourcePublicationHeads21101700000002110,
    tables: Object.freeze([]),
  }),
]);
export {
  QaAutomationExecution20551700000002055,
  QaAutomationFoundation20501700000002050,
  QaAutomationReviewQuarantine20601700000002060,
  QaDefectProposals20951700000002095,
  QaEvidenceIntegrity20851700000002085,
  QaEvidenceUploads20901700000002090,
  QaHermesPolicyFence21001700000002100,
  QaHermesProposals20401700000002040,
  QaProjectResources20801700000002080,
  QaQueueFacts20701700000002070,
  QaResourcePublicationHeads21101700000002110,
};
