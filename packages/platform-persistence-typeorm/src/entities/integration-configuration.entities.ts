import { EntitySchema } from "typeorm";

const workspaceHeaderColumns = {
  id: { type: "uuid", primary: true },
  workspaceId: { name: "workspace_id", type: "uuid" },
  key: { type: String },
  currentPublishedVersion: { name: "current_published_version", type: Number, nullable: true },
  rowVersion: { name: "row_version", type: Number, default: 1 },
} as const;
const revisionColumns = {
  id: { type: "uuid", primary: true },
  workspaceId: { name: "workspace_id", type: "uuid" },
  headerId: { name: "header_id", type: "uuid" },
  version: { type: Number },
  status: { type: String },
  content: { type: "jsonb" },
  contentHash: { name: "content_hash", type: String },
  createdAt: { name: "created_at", type: "timestamptz" },
} as const;

export const ConnectionHeaderEntity = new EntitySchema({
  name: "ConnectionHeader",
  tableName: "connection_headers",
  columns: workspaceHeaderColumns,
  uniques: [{ columns: ["workspaceId", "key"] }, { columns: ["workspaceId", "id"] }],
});
export const ConnectionRevisionEntity = new EntitySchema({
  name: "ConnectionRevision",
  tableName: "connection_revisions",
  columns: revisionColumns,
  uniques: [{ columns: ["workspaceId", "headerId", "version"] }],
});
export const MappingHeaderEntity = new EntitySchema({
  name: "MappingHeader",
  tableName: "connector_mapping_headers",
  columns: workspaceHeaderColumns,
  uniques: [{ columns: ["workspaceId", "key"] }, { columns: ["workspaceId", "id"] }],
});
export const MappingRevisionEntity = new EntitySchema({
  name: "MappingRevision",
  tableName: "connector_mapping_revisions",
  columns: revisionColumns,
  uniques: [{ columns: ["workspaceId", "headerId", "version"] }],
});
export const ProfileHeaderEntity = new EntitySchema({
  name: "ProfileHeader",
  tableName: "connector_profile_headers",
  columns: workspaceHeaderColumns,
  uniques: [{ columns: ["workspaceId", "key"] }, { columns: ["workspaceId", "id"] }],
});
export const ProfileRevisionEntity = new EntitySchema({
  name: "ProfileRevision",
  tableName: "connector_profile_revisions",
  columns: revisionColumns,
  uniques: [{ columns: ["workspaceId", "headerId", "version"] }],
});
export const BindingHeaderEntity = new EntitySchema({
  name: "BindingHeader",
  tableName: "project_integration_binding_headers",
  columns: { ...workspaceHeaderColumns, projectId: { name: "project_id", type: "uuid" } },
  uniques: [{ columns: ["workspaceId", "projectId", "key"] }, { columns: ["workspaceId", "id"] }],
});
export const BindingRevisionEntity = new EntitySchema({
  name: "BindingRevision",
  tableName: "project_integration_binding_revisions",
  columns: {
    ...revisionColumns,
    projectId: { name: "project_id", type: "uuid" },
    schemaVersion: { name: "schema_version", type: Number, default: 1 },
    validationReportId: { name: "validation_report_id", type: "uuid", nullable: true },
    configurationRefs: { name: "configuration_refs", type: "jsonb", default: [] },
    resourceRefs: { name: "resource_refs", type: "jsonb", default: [] },
    validatedAt: { name: "validated_at", type: "timestamptz", nullable: true },
    publishedAt: { name: "published_at", type: "timestamptz", nullable: true },
    retiredAt: { name: "retired_at", type: "timestamptz", nullable: true },
  },
  uniques: [{ columns: ["workspaceId", "headerId", "version"] }],
});
export const ValidationReportEntity = new EntitySchema({
  name: "ValidationReport",
  tableName: "integration_validation_reports",
  columns: {
    id: { type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid", nullable: true },
    subjectKind: { name: "subject_kind", type: String },
    subjectId: { name: "subject_id", type: "uuid" },
    subjectVersion: { name: "subject_version", type: Number },
    outcome: { type: String },
    contentHash: { name: "content_hash", type: String },
    report: { type: "jsonb" },
    createdAt: { name: "created_at", type: "timestamptz" },
  },
});
export const ConnectionHealthEntity = new EntitySchema({
  name: "ConnectionHealth",
  tableName: "connection_health",
  columns: {
    workspaceId: { name: "workspace_id", type: "uuid", primary: true },
    connectionId: { name: "connection_id", type: "uuid", primary: true },
    state: { type: String },
    checkedAt: { name: "checked_at", type: "timestamptz" },
    details: { type: "jsonb" },
  },
});

export const BindingFunctionalAcceptanceEntity = new EntitySchema({
  name: "BindingFunctionalAcceptance",
  tableName: "binding_functional_acceptances",
  columns: {
    acceptanceId: { name: "acceptance_id", type: "uuid", primary: true },
    version: { type: Number, default: 1 },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    bindingRef: { name: "binding_ref", type: "jsonb" },
    validationReportRef: { name: "validation_report_ref", type: "jsonb" },
    qaProjectContextRef: { name: "qa_project_context_ref", type: "jsonb" },
    acceptedResourceRefs: { name: "accepted_resource_refs", type: "jsonb" },
    checklistRef: { name: "checklist_ref", type: "jsonb" },
    outcome: { type: String },
    safeIssueCodes: { name: "safe_issue_codes", type: "jsonb" },
    acceptedBy: { name: "accepted_by", type: "jsonb" },
    acceptedAt: { name: "accepted_at", type: "timestamptz" },
    semanticBody: { name: "semantic_body", type: "jsonb" },
    contentHash: { name: "content_hash", type: String },
  },
  uniques: [{ columns: ["workspaceId", "projectId", "acceptanceId"] }],
});
export const CapabilityProbeResultEntity = new EntitySchema({
  name: "CapabilityProbeResult",
  tableName: "capability_probe_results",
  columns: {
    probeId: { name: "probe_id", type: "uuid", primary: true },
    version: { type: Number, default: 1 },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    bindingRef: { name: "binding_ref", type: "jsonb" },
    profileRef: { name: "profile_ref", type: "jsonb" },
    connectionRef: { name: "connection_ref", type: "jsonb" },
    mappingRef: { name: "mapping_ref", type: "jsonb", nullable: true },
    validationReportRef: { name: "validation_report_ref", type: "jsonb" },
    logicalRole: { name: "logical_role", type: String },
    capabilityKey: { name: "capability_key", type: String },
    exactContractVersion: { name: "exact_contract_version", type: String },
    operation: { type: String },
    environmentScope: { name: "environment_scope", type: String },
    status: { type: String },
    safeIssueCodes: { name: "safe_issue_codes", type: "jsonb" },
    observedAt: { name: "observed_at", type: "timestamptz" },
    validUntil: { name: "valid_until", type: "timestamptz" },
    actorKind: { name: "actor_kind", type: String },
    semanticBody: { name: "semantic_body", type: "jsonb" },
    contentHash: { name: "content_hash", type: String },
  },
  uniques: [{ columns: ["workspaceId", "projectId", "probeId"] }],
  indices: [
    { columns: ["workspaceId", "projectId", "capabilityKey", "logicalRole", "validUntil"] },
  ],
});
export const CapabilityModeAssessmentEntity = new EntitySchema({
  name: "CapabilityModeAssessment",
  tableName: "capability_mode_assessments",
  columns: {
    assessmentId: { name: "assessment_id", type: "uuid", primary: true },
    version: { type: Number, default: 1 },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    bindingRef: { name: "binding_ref", type: "jsonb" },
    qaProjectContextRef: { name: "qa_project_context_ref", type: "jsonb" },
    requirementSetRef: { name: "requirement_set_ref", type: "jsonb" },
    probeRefs: { name: "probe_refs", type: "jsonb" },
    manualRequirements: { name: "manual_requirements", type: String },
    automationRequirements: { name: "automation_requirements", type: String },
    pilotMessagingRequirement: { name: "pilot_messaging_requirement", type: String },
    derivedMode: { name: "derived_mode", type: String },
    reasonCodes: { name: "reason_codes", type: "jsonb" },
    evaluatedAt: { name: "evaluated_at", type: "timestamptz" },
    semanticBody: { name: "semantic_body", type: "jsonb" },
    contentHash: { name: "content_hash", type: String },
  },
  uniques: [{ columns: ["workspaceId", "projectId", "assessmentId"] }],
});
export const ProjectOperationalActionCandidateEntity = new EntitySchema({
  name: "ProjectOperationalActionCandidate",
  tableName: "project_operational_action_candidates",
  columns: {
    actionId: { name: "action_id", type: "uuid", primary: true },
    workspaceId: { name: "workspace_id", type: "uuid" },
    projectId: { name: "project_id", type: "uuid" },
    actionKind: { name: "action_kind", type: String },
    targetRef: { name: "target_ref", type: "jsonb" },
    expectedOnboardingVersion: { name: "expected_onboarding_version", type: Number },
    prerequisiteRefs: { name: "prerequisite_refs", type: "jsonb" },
    initiator: { type: "jsonb" },
    reason: { type: String },
    expiresAt: { name: "expires_at", type: "timestamptz" },
    createdAt: { name: "created_at", type: "timestamptz" },
    semanticBody: { name: "semantic_body", type: "jsonb" },
    contentHash: { name: "content_hash", type: String },
  },
  uniques: [{ columns: ["workspaceId", "projectId", "actionId"] }],
});

export const integrationConfigurationEntities = Object.freeze([
  ConnectionHeaderEntity,
  ConnectionRevisionEntity,
  MappingHeaderEntity,
  MappingRevisionEntity,
  ProfileHeaderEntity,
  ProfileRevisionEntity,
  BindingHeaderEntity,
  BindingRevisionEntity,
  ValidationReportEntity,
  ConnectionHealthEntity,
  BindingFunctionalAcceptanceEntity,
  CapabilityProbeResultEntity,
  CapabilityModeAssessmentEntity,
  ProjectOperationalActionCandidateEntity,
]);
