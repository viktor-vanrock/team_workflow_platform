import { EntitySchema } from "typeorm";

const jsonb = { type: "jsonb" as const };
const timestamptz = { type: "timestamptz" as const };

export const ProjectRegistryRevisionEntity = new EntitySchema({
  name: "ProjectRegistryRevision",
  tableName: "project_registry_revisions",
  columns: {
    revisionId: { name: "revision_id", type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    version: { type: Number },
    projectKey: { name: "project_key", type: String },
    projectName: { name: "project_name", type: String },
    ownerIds: { name: "owner_ids", ...jsonb },
    criticalityKey: { name: "criticality_key", type: String },
    dataClassificationKey: { name: "data_classification_key", type: String },
    verificationStatus: { name: "verification_status", type: String },
    lastVerifiedAt: { name: "last_verified_at", ...timestamptz, nullable: true },
    nextVerificationAt: { name: "next_verification_at", ...timestamptz, nullable: true },
    reason: { type: String },
    createdBy: { name: "created_by", type: "uuid", nullable: true },
    createdAt: { name: "created_at", ...timestamptz },
    semanticBody: { name: "semantic_body", ...jsonb },
    contentHash: { name: "content_hash", type: String },
  },
  uniques: [
    { columns: ["workspaceId", "projectId", "revisionId"] },
    { columns: ["workspaceId", "projectId", "version"] },
  ],
  indices: [{ columns: ["workspaceId", "projectId", "version"] }],
});

export const ProjectOnboardingHeaderEntity = new EntitySchema({
  name: "ProjectOnboardingHeader",
  tableName: "project_onboarding_headers",
  columns: {
    onboardingId: { name: "onboarding_id", type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    currentVersion: { name: "current_version", type: Number },
    currentStage: { name: "current_stage", type: String },
    currentCapabilityMode: { name: "current_capability_mode", type: String },
    currentOperationalState: { name: "current_operational_state", type: String },
    intendedCapabilityMode: { name: "intended_capability_mode", type: String },
    rowVersion: { name: "row_version", type: Number, default: 1 },
    createdAt: { name: "created_at", ...timestamptz },
    updatedAt: { name: "updated_at", ...timestamptz },
  },
  uniques: [
    { columns: ["workspaceId", "projectId", "onboardingId"] },
    { columns: ["workspaceId", "projectId"] },
  ],
});

export const ProjectOnboardingRevisionEntity = new EntitySchema({
  name: "ProjectOnboardingRevision",
  tableName: "project_onboarding_revisions",
  columns: {
    revisionId: { name: "revision_id", type: "uuid", primary: true },
    onboardingId: { name: "onboarding_id", type: "uuid" },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    version: { type: Number },
    onboardingStage: { name: "onboarding_stage", type: String },
    qaCapabilityMode: { name: "qa_capability_mode", type: String },
    projectOperationalState: { name: "project_operational_state", type: String },
    intendedCapabilityMode: { name: "intended_capability_mode", type: String },
    projectRegistryRef: { name: "project_registry_ref", ...jsonb },
    bindingRef: { name: "binding_ref", ...jsonb, nullable: true },
    qaProjectContextRef: { name: "qa_project_context_ref", ...jsonb, nullable: true },
    starterEntitlementSetHash: { name: "starter_entitlement_set_hash", type: String },
    gateResultRefs: { name: "gate_result_refs", ...jsonb },
    ownerSetHash: { name: "owner_set_hash", type: String },
    reasonCode: { name: "reason_code", type: String },
    reason: { type: String },
    incidentRef: { name: "incident_ref", type: String, nullable: true },
    actor: jsonb,
    correlationId: { name: "correlation_id", type: String },
    causationId: { name: "causation_id", type: String, nullable: true },
    createdAt: { name: "created_at", ...timestamptz },
    semanticBody: { name: "semantic_body", ...jsonb },
    contentHash: { name: "content_hash", type: String },
  },
  uniques: [{ columns: ["workspaceId", "projectId", "onboardingId", "version"] }],
});

export const ProjectOnboardingGateResultEntity = new EntitySchema({
  name: "ProjectOnboardingGateResult",
  tableName: "project_onboarding_gate_results",
  columns: {
    gateResultId: { name: "gate_result_id", type: "uuid", primary: true },
    version: { type: Number, default: 1 },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    gateKind: { name: "gate_kind", type: String },
    checkKey: { name: "check_key", type: String },
    checkVersion: { name: "check_version", type: String },
    subjectRefs: { name: "subject_refs", ...jsonb },
    outcome: { type: String },
    safeIssueCodes: { name: "safe_issue_codes", ...jsonb },
    evidenceRefs: { name: "evidence_refs", ...jsonb },
    evaluatedBy: { name: "evaluated_by", ...jsonb },
    evaluatedAt: { name: "evaluated_at", ...timestamptz },
    validUntil: { name: "valid_until", ...timestamptz, nullable: true },
    semanticBody: { name: "semantic_body", ...jsonb },
    contentHash: { name: "content_hash", type: String },
  },
  uniques: [{ columns: ["workspaceId", "projectId", "gateResultId"] }],
});

export const WorkspaceProjectRolloutLeaseEntity = new EntitySchema({
  name: "WorkspaceProjectRolloutLease",
  tableName: "workspace_project_rollout_leases",
  columns: {
    workspaceId: { name: "workspace_id", type: "uuid", primary: true },
    holderProjectId: { name: "holder_project_id", type: "uuid" },
    leaseVersion: { name: "lease_version", type: Number },
    acquiredBy: { name: "acquired_by", type: "uuid" },
    acquiredAt: { name: "acquired_at", ...timestamptz },
    expiresAt: { name: "expires_at", ...timestamptz },
    purpose: { type: String },
    rowVersion: { name: "row_version", type: Number, default: 1 },
  },
});

export const ProjectIncidentDispositionEntity = new EntitySchema({
  name: "ProjectIncidentDisposition",
  tableName: "project_incident_dispositions",
  columns: {
    dispositionId: { name: "disposition_id", type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    incidentRef: { name: "incident_ref", type: String },
    onboardingRevisionId: { name: "onboarding_revision_id", type: "uuid" },
    outcome: { type: String },
    actorId: { name: "actor_id", type: "uuid" },
    createdAt: { name: "created_at", ...timestamptz },
    semanticBody: { name: "semantic_body", ...jsonb },
    contentHash: { name: "content_hash", type: String },
  },
  uniques: [{ columns: ["workspaceId", "projectId", "dispositionId"] }],
});

export const projectOnboardingEntities = Object.freeze([
  ProjectIncidentDispositionEntity,
  ProjectRegistryRevisionEntity,
  ProjectOnboardingHeaderEntity,
  ProjectOnboardingRevisionEntity,
  ProjectOnboardingGateResultEntity,
  WorkspaceProjectRolloutLeaseEntity,
]);
