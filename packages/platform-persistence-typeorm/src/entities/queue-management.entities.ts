import { EntitySchema, type EntitySchemaColumnOptions, type EntitySchemaOptions } from "typeorm";

type Row = Record<string, unknown>;
type Columns = Record<string, EntitySchemaColumnOptions>;

const uuid = (name: string, primary = false): EntitySchemaColumnOptions => ({
  name,
  type: "uuid",
  primary,
});
const text = (name: string): EntitySchemaColumnOptions => ({ name, type: String });
const bigint = (name: string): EntitySchemaColumnOptions => ({ name, type: "bigint" });
const json = (name: string): EntitySchemaColumnOptions => ({ name, type: "jsonb" });
const timestamp = (name: string): EntitySchemaColumnOptions => ({ name, type: "timestamptz" });

function entity(
  name: string,
  tableName: string,
  idProperty: string,
  idColumn: string,
  scope: "WORKSPACE" | "PROJECT",
  extras: Columns = {},
  indices: EntitySchemaOptions<Row>["indices"] = [],
): EntitySchema<Row> {
  return new EntitySchema<Row>({
    name,
    tableName,
    columns: {
      [idProperty]: uuid(idColumn, true),
      workspaceId: uuid("workspace_id"),
      ...(scope === "PROJECT" ? { projectId: uuid("project_id") } : {}),
      ...extras,
    },
    indices,
  });
}

export const WorkspaceBusinessCalendarHeadEntity = entity(
  "WorkspaceBusinessCalendarHead",
  "workspace_business_calendar_heads",
  "calendarId",
  "calendar_id",
  "WORKSPACE",
  {
    calendarKey: text("calendar_key"),
    resourceVersion: bigint("resource_version"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  [{ columns: ["workspaceId", "calendarKey"], unique: true }],
);
export const WorkspaceBusinessCalendarRevisionEntity = entity(
  "WorkspaceBusinessCalendarRevision",
  "workspace_business_calendar_revisions",
  "calendarRevisionId",
  "calendar_revision_id",
  "WORKSPACE",
  {
    calendarId: uuid("calendar_id"),
    revisionNumber: bigint("revision_number"),
    weeklyIntervals: json("weekly_intervals"),
    dateOverrides: json("date_overrides"),
    dstRules: json("dst_rules"),
    sourceKind: text("source_kind"),
    semanticHash: text("semantic_hash"),
  },
  [{ columns: ["workspaceId", "calendarId", "revisionNumber"], unique: true }],
);
export const WorkspaceQueuePolicyHeadEntity = entity(
  "WorkspaceQueuePolicyHead",
  "workspace_queue_policy_heads",
  "queuePolicyId",
  "queue_policy_id",
  "WORKSPACE",
  {
    policyKey: text("policy_key"),
    resourceVersion: bigint("resource_version"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  [{ columns: ["workspaceId", "policyKey"], unique: true }],
);
export const WorkspaceQueuePolicyRevisionEntity = entity(
  "WorkspaceQueuePolicyRevision",
  "workspace_queue_policy_revisions",
  "policyRevisionId",
  "policy_revision_id",
  "WORKSPACE",
  {
    queuePolicyId: uuid("queue_policy_id"),
    revisionNumber: bigint("revision_number"),
    mode: text("mode"),
    projectEntries: json("project_entries"),
    semanticHash: text("semantic_hash"),
  },
  [{ columns: ["workspaceId", "queuePolicyId", "revisionNumber"], unique: true }],
);
export const WorkspaceQueueConfigurationRequestEntity = entity(
  "WorkspaceQueueConfigurationRequest",
  "workspace_queue_configuration_requests",
  "idempotencyKeyHash",
  "idempotency_key_hash",
  "WORKSPACE",
  {
    actorPrincipalId: uuid("actor_principal_id"),
    operation: text("operation"),
    requestHash: text("request_hash"),
    outcome: text("outcome"),
  },
  [
    {
      columns: ["workspaceId", "actorPrincipalId", "operation", "idempotencyKeyHash"],
      unique: true,
    },
  ],
);
export const WorkspaceQueuePolicyViewHeadEntity = entity(
  "WorkspaceQueuePolicyViewHead",
  "workspace_queue_policy_view_heads",
  "policyViewId",
  "policy_view_id",
  "WORKSPACE",
  {
    policyKey: text("policy_key"),
    resourceVersion: bigint("resource_version"),
    reconciledSourceRevision: bigint("reconciled_source_revision"),
  },
  [{ columns: ["workspaceId", "policyKey"], unique: true }],
);
export const WorkspaceQueuePolicyViewRevisionEntity = entity(
  "WorkspaceQueuePolicyViewRevision",
  "workspace_queue_policy_view_revisions",
  "policyViewRevisionId",
  "policy_view_revision_id",
  "WORKSPACE",
  {
    policyViewId: uuid("policy_view_id"),
    revisionNumber: bigint("revision_number"),
    safeBody: json("safe_body"),
    semanticHash: text("semantic_hash"),
  },
  [{ columns: ["workspaceId", "policyViewId", "revisionNumber"], unique: true }],
);
export const ProjectQueuePolicyFacetHeadEntity = entity(
  "ProjectQueuePolicyFacetHead",
  "project_queue_policy_facet_heads",
  "policyFacetId",
  "policy_facet_id",
  "PROJECT",
  {
    policyKey: text("policy_key"),
    resourceVersion: bigint("resource_version"),
    reconciledSourceRevision: bigint("reconciled_source_revision"),
  },
  [{ columns: ["workspaceId", "projectId", "policyKey"], unique: true }],
);
export const ProjectQueuePolicyFacetRevisionEntity = entity(
  "ProjectQueuePolicyFacetRevision",
  "project_queue_policy_facet_revisions",
  "policyFacetRevisionId",
  "policy_facet_revision_id",
  "PROJECT",
  {
    policyFacetId: uuid("policy_facet_id"),
    revisionNumber: bigint("revision_number"),
    safeBody: json("safe_body"),
    semanticHash: text("semantic_hash"),
  },
  [{ columns: ["workspaceId", "projectId", "policyFacetId", "revisionNumber"], unique: true }],
);
export const AuthorizedScopeQueuePolicyFacetHeadEntity = entity(
  "AuthorizedScopeQueuePolicyFacetHead",
  "authorized_scope_queue_policy_facet_heads",
  "authorizedFacetId",
  "authorized_facet_id",
  "WORKSPACE",
  {
    authorizedProjectSetHash: text("authorized_project_set_hash"),
    policyKey: text("policy_key"),
    resourceVersion: bigint("resource_version"),
  },
  [{ columns: ["workspaceId", "authorizedProjectSetHash", "policyKey"], unique: true }],
);
export const AuthorizedScopeQueuePolicyFacetRevisionEntity = entity(
  "AuthorizedScopeQueuePolicyFacetRevision",
  "authorized_scope_queue_policy_facet_revisions",
  "authorizedFacetRevisionId",
  "authorized_facet_revision_id",
  "WORKSPACE",
  {
    authorizedFacetId: uuid("authorized_facet_id"),
    revisionNumber: bigint("revision_number"),
    safeBody: json("safe_body"),
    semanticHash: text("semantic_hash"),
  },
  [{ columns: ["workspaceId", "authorizedFacetId", "revisionNumber"], unique: true }],
);
export const AuthorizedScopeQueuePolicyFacetProjectEntity = new EntitySchema<Row>({
  name: "AuthorizedScopeQueuePolicyFacetProject",
  tableName: "authorized_scope_queue_policy_facet_projects",
  columns: {
    workspaceId: uuid("workspace_id", true),
    authorizedFacetId: uuid("authorized_facet_id", true),
    projectId: uuid("project_id", true),
  },
  indices: [{ columns: ["workspaceId", "projectId", "authorizedFacetId"] }],
});

export const QueueProjectionGenerationEntity = entity(
  "QueueProjectionGeneration",
  "queue_projection_generations",
  "generationId",
  "generation_id",
  "WORKSPACE",
  {
    state: text("state"),
    sourceHighWatermarks: json("source_high_watermarks"),
    inputSetHash: text("input_set_hash"),
    startedAt: timestamp("started_at"),
  },
  [{ columns: ["workspaceId", "state"] }],
);
export const QueueEntryHeadEntity = entity(
  "QueueEntryHead",
  "queue_entry_heads",
  "queueEntryId",
  "queue_entry_id",
  "PROJECT",
  {
    subjectKind: text("subject_kind"),
    resourceVersion: bigint("resource_version"),
    nextTemporalEvaluationAt: {
      name: "next_temporal_evaluation_at",
      type: "timestamptz",
      nullable: true,
    },
  },
  [{ columns: ["nextTemporalEvaluationAt", "workspaceId", "projectId"] }],
);
export const QueueEntryRevisionEntity = entity(
  "QueueEntryRevision",
  "queue_entry_revisions",
  "queueEntryRevisionId",
  "queue_entry_revision_id",
  "PROJECT",
  {
    queueEntryId: uuid("queue_entry_id"),
    generationId: uuid("generation_id"),
    revisionNumber: bigint("revision_number"),
    stage: text("stage"),
    safeBody: json("ordering_facet"),
    semanticHash: text("semantic_hash"),
  },
  [{ columns: ["workspaceId", "projectId", "stage", "queueEntryId"] }],
);
export const SlaClockHeadEntity = entity(
  "SlaClockHead",
  "sla_clock_heads",
  "slaClockId",
  "sla_clock_id",
  "PROJECT",
  {
    workItemId: uuid("work_item_id"),
    goal: text("goal"),
    resourceVersion: bigint("resource_version"),
    currentClockCycle: { name: "current_clock_cycle", type: Number },
    nextTemporalEvaluationAt: {
      name: "next_temporal_evaluation_at",
      type: "timestamptz",
      nullable: true,
    },
  },
  [{ columns: ["nextTemporalEvaluationAt", "workspaceId", "projectId"] }],
);
export const SlaClockRevisionEntity = entity(
  "SlaClockRevision",
  "sla_clock_revisions",
  "slaClockRevisionId",
  "sla_clock_revision_id",
  "PROJECT",
  {
    slaClockId: uuid("sla_clock_id"),
    revisionNumber: bigint("revision_number"),
    transitionKind: text("transition_kind"),
    state: text("state"),
    clockCycle: { name: "clock_cycle", type: Number },
    publicTransition: json("public_transition"),
    inputFingerprint: text("input_fingerprint"),
    semanticHash: text("semantic_hash"),
  },
  [{ columns: ["workspaceId", "projectId", "slaClockId", "revisionNumber"], unique: true }],
);
export const SlaClockSegmentHeadEntity = entity(
  "SlaClockSegmentHead",
  "sla_clock_segment_heads",
  "segmentId",
  "segment_id",
  "PROJECT",
  {
    slaClockId: uuid("sla_clock_id"),
    clockCycle: { name: "clock_cycle", type: Number },
    ordinal: { name: "ordinal", type: Number },
    state: text("state"),
    currentRevisionId: uuid("current_revision_id"),
    resourceVersion: bigint("resource_version"),
    isOpen: { name: "is_open", type: Boolean },
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  [{ columns: ["workspaceId", "projectId", "slaClockId", "ordinal"], unique: true }],
);
export const SlaClockSegmentEntity = entity(
  "SlaClockSegment",
  "sla_clock_segments",
  "segmentRevisionId",
  "segment_revision_id",
  "PROJECT",
  {
    segmentId: uuid("segment_id"),
    slaClockId: uuid("sla_clock_id"),
    revisionNumber: { name: "revision_number", type: Number },
    clockCycle: { name: "clock_cycle", type: Number },
    ordinal: { name: "ordinal", type: Number },
    state: text("state"),
    startedAt: timestamp("started_at"),
    semanticHash: text("semantic_hash"),
  },
  [{ columns: ["workspaceId", "projectId", "segmentId", "revisionNumber"], unique: true }],
);
export const SlaThresholdEmissionEntity = entity(
  "SlaThresholdEmission",
  "sla_threshold_emissions",
  "emissionId",
  "emission_id",
  "PROJECT",
  {
    slaClockId: uuid("sla_clock_id"),
    clockCycle: { name: "clock_cycle", type: Number },
    policyFacetHash: text("policy_facet_hash"),
    thresholdKind: text("threshold_kind"),
    thresholdKey: text("threshold_key"),
    reachedAt: timestamp("reached_at"),
    semanticHash: text("semantic_hash"),
  },
  [
    {
      columns: [
        "workspaceId",
        "projectId",
        "slaClockId",
        "clockCycle",
        "policyFacetHash",
        "thresholdKind",
        "thresholdKey",
      ],
      unique: true,
    },
  ],
);
export const SlaRolloutVerificationReceiptEntity = entity(
  "SlaRolloutVerificationReceipt",
  "sla_rollout_verification_receipts",
  "receiptId",
  "receipt_id",
  "PROJECT",
  {
    workItemId: uuid("work_item_id"),
    goal: text("goal"),
    policyEnableEpochHash: text("policy_enable_epoch_hash"),
    reducerDisposition: text("reducer_disposition"),
    confirmedAt: timestamp("confirmed_at"),
    publicReceipt: json("public_receipt"),
    semanticHash: text("semantic_hash"),
  },
  [
    {
      columns: ["workspaceId", "projectId", "workItemId", "goal", "policyEnableEpochHash"],
      unique: true,
    },
  ],
);

export const WorkItemQueueControlHeadEntity = entity(
  "WorkItemQueueControlHead",
  "work_item_queue_control_heads",
  "controlId",
  "control_id",
  "PROJECT",
  {
    workItemId: uuid("work_item_id"),
    resourceVersion: bigint("resource_version"),
  },
  [{ columns: ["workspaceId", "projectId", "workItemId"], unique: true }],
);
export const WorkItemQueueControlRevisionEntity = entity(
  "WorkItemQueueControlRevision",
  "work_item_queue_control_revisions",
  "controlRevisionId",
  "control_revision_id",
  "PROJECT",
  {
    controlId: uuid("control_id"),
    revisionNumber: bigint("revision_number"),
    serviceClass: text("service_class"),
    planningValues: json("planning_values"),
    semanticHash: text("semantic_hash"),
  },
  [{ columns: ["workspaceId", "projectId", "controlId", "revisionNumber"], unique: true }],
);
export const QueueOrderScopeHeadEntity = entity(
  "QueueOrderScopeHead",
  "queue_order_scope_heads",
  "orderScopeId",
  "order_scope_id",
  "WORKSPACE",
  {
    scopeKind: text("scope_kind"),
    authorizedProjectSetHash: text("authorized_project_set_hash"),
    resourceVersion: bigint("resource_version"),
    queueEpoch: bigint("queue_epoch"),
  },
  [{ columns: ["workspaceId", "authorizedProjectSetHash"] }],
);
export const QueueOrderScopeProjectEntity = new EntitySchema<Row>({
  name: "QueueOrderScopeProject",
  tableName: "queue_order_scope_projects",
  columns: {
    workspaceId: uuid("workspace_id", true),
    orderScopeId: uuid("order_scope_id", true),
    projectId: uuid("project_id", true),
  },
  indices: [{ columns: ["workspaceId", "projectId", "orderScopeId"] }],
});
export const QueueOrderOverrideEntity = entity(
  "QueueOrderOverride",
  "queue_order_overrides",
  "overrideId",
  "override_id",
  "PROJECT",
  {
    orderScopeId: uuid("order_scope_id"),
    workItemId: uuid("work_item_id"),
    moveSequence: bigint("move_sequence"),
    placement: text("placement"),
    semanticHash: text("semantic_hash"),
  },
  [{ columns: ["workspaceId", "orderScopeId", "moveSequence"], unique: true }],
);
export const QueueOrderInvalidationHeadEntity = entity(
  "QueueOrderInvalidationHead",
  "queue_order_invalidation_heads",
  "invalidationId",
  "invalidation_id",
  "PROJECT",
  {
    workItemId: uuid("work_item_id"),
    resourceVersion: bigint("resource_version"),
  },
  [{ columns: ["workspaceId", "projectId", "workItemId"], unique: true }],
);
export const QueueOrderInvalidationRevisionEntity = entity(
  "QueueOrderInvalidationRevision",
  "queue_order_invalidation_revisions",
  "invalidationRevisionId",
  "invalidation_revision_id",
  "PROJECT",
  {
    invalidationId: uuid("invalidation_id"),
    revisionNumber: bigint("revision_number"),
    reasonCode: text("reason_code"),
    semanticHash: text("semantic_hash"),
  },
  [{ columns: ["workspaceId", "projectId", "invalidationId", "revisionNumber"], unique: true }],
);
export const QueueActionCandidateEntity = entity(
  "QueueActionCandidate",
  "queue_action_candidates",
  "actionId",
  "action_id",
  "PROJECT",
  {
    actionKind: text("action_kind"),
    publicSchemaId: text("public_schema_id"),
    publicCandidate: json("public_candidate"),
    publicIntentHash: text("public_intent_hash"),
    privateWitness: json("private_witness"),
    actionHash: text("action_hash"),
  },
  [{ columns: ["workspaceId", "projectId", "actionId"], unique: true }],
);
export const WorkspaceCapacityHeadEntity = entity(
  "WorkspaceCapacityHead",
  "workspace_capacity_heads",
  "capacityHeadId",
  "capacity_head_id",
  "WORKSPACE",
  {
    resourceVersion: bigint("resource_version"),
    state: text("state"),
    policyRef: json("policy_ref"),
  },
  [{ columns: ["workspaceId"], unique: true }],
);
export const WorkspaceCapacityReconciliationCheckpointEntity = entity(
  "WorkspaceCapacityReconciliationCheckpoint",
  "workspace_capacity_reconciliation_checkpoints",
  "checkpointId",
  "checkpoint_id",
  "WORKSPACE",
  {
    policyRef: json("policy_ref"),
    projectionGenerationId: uuid("projection_generation_id"),
    state: text("state"),
    cursorWorkItemId: { ...uuid("cursor_work_item_id"), nullable: true },
    subjectCount: bigint("subject_count"),
    reconciledCount: bigint("reconciled_count"),
    skippedCount: bigint("skipped_count"),
  },
  [{ columns: ["workspaceId"], unique: true }],
);
export const CapacityScopeProjectionHeadEntity = entity(
  "CapacityScopeProjectionHead",
  "capacity_scope_projection_heads",
  "capacityProjectionId",
  "capacity_projection_id",
  "WORKSPACE",
  {
    scopeKind: text("scope_kind"),
    projectId: { ...uuid("project_id"), nullable: true },
    authorizedProjectSetHash: text("authorized_project_set_hash"),
    resourceVersion: bigint("resource_version"),
  },
  [{ columns: ["workspaceId", "authorizedProjectSetHash"], unique: true }],
);
export const CapacityScopeProjectionRevisionEntity = entity(
  "CapacityScopeProjectionRevision",
  "capacity_scope_projection_revisions",
  "capacityProjectionRevisionId",
  "capacity_projection_revision_id",
  "WORKSPACE",
  {
    capacityProjectionId: uuid("capacity_projection_id"),
    revisionNumber: bigint("revision_number"),
    authorizedProjectSetHash: text("authorized_project_set_hash"),
    safeBody: json("safe_body"),
    semanticHash: text("semantic_hash"),
  },
  [{ columns: ["workspaceId", "capacityProjectionId", "revisionNumber"], unique: true }],
);
export const CapacityScopeProjectionProjectEntity = new EntitySchema<Row>({
  name: "CapacityScopeProjectionProject",
  tableName: "capacity_scope_projection_projects",
  columns: {
    workspaceId: uuid("workspace_id", true),
    capacityProjectionId: uuid("capacity_projection_id", true),
    projectId: uuid("project_id", true),
  },
  indices: [{ columns: ["workspaceId", "projectId", "capacityProjectionId"] }],
});
export const WorkItemHumanWipClaimEntity = entity(
  "WorkItemHumanWipClaim",
  "work_item_human_wip_claims",
  "claimId",
  "claim_id",
  "PROJECT",
  {
    workItemId: uuid("work_item_id"),
    revisionNumber: bigint("revision_number"),
    previousRevisionId: { ...uuid("previous_revision_id"), nullable: true },
    sessionIds: json("session_ids"),
    state: text("state"),
    sourceRef: json("source_ref"),
    causeSet: json("cause_set"),
    causeSetHash: text("cause_set_hash"),
    semanticHash: text("semantic_hash"),
  },
  [{ columns: ["workspaceId", "projectId", "workItemId", "revisionNumber"], unique: true }],
);
export const ReviewCapacityReservationEntity = entity(
  "ReviewCapacityReservation",
  "review_capacity_reservations",
  "reservationId",
  "reservation_id",
  "PROJECT",
  {
    workItemId: uuid("work_item_id"),
    revisionNumber: bigint("revision_number"),
    previousRevisionId: { ...uuid("previous_revision_id"), nullable: true },
    sessionIds: json("session_ids"),
    state: text("state"),
    causeSet: json("cause_set"),
    causeSetHash: text("cause_set_hash"),
    expiresAt: timestamp("expires_at"),
    semanticHash: text("semantic_hash"),
  },
  [{ columns: ["workspaceId", "projectId", "workItemId", "revisionNumber"], unique: true }],
);
export const CapacityAdmissionDecisionEntity = entity(
  "CapacityAdmissionDecision",
  "capacity_admission_decisions",
  "decisionId",
  "decision_id",
  "PROJECT",
  {
    workItemId: uuid("work_item_id"),
    requestKeyHash: text("request_key_hash"),
    requestHash: text("request_hash"),
    outcome: text("outcome"),
    semanticHash: text("semantic_hash"),
  },
  [{ columns: ["workspaceId", "projectId", "requestKeyHash"], unique: true }],
);

export const queueManagementEntities: readonly EntitySchema<Row>[] = Object.freeze([
  WorkspaceBusinessCalendarHeadEntity,
  WorkspaceBusinessCalendarRevisionEntity,
  WorkspaceQueuePolicyHeadEntity,
  WorkspaceQueuePolicyRevisionEntity,
  WorkspaceQueueConfigurationRequestEntity,
  WorkspaceQueuePolicyViewHeadEntity,
  WorkspaceQueuePolicyViewRevisionEntity,
  ProjectQueuePolicyFacetHeadEntity,
  ProjectQueuePolicyFacetRevisionEntity,
  AuthorizedScopeQueuePolicyFacetHeadEntity,
  AuthorizedScopeQueuePolicyFacetRevisionEntity,
  AuthorizedScopeQueuePolicyFacetProjectEntity,
  QueueProjectionGenerationEntity,
  QueueEntryHeadEntity,
  QueueEntryRevisionEntity,
  SlaClockHeadEntity,
  SlaClockRevisionEntity,
  SlaClockSegmentHeadEntity,
  SlaClockSegmentEntity,
  SlaThresholdEmissionEntity,
  SlaRolloutVerificationReceiptEntity,
  WorkItemQueueControlHeadEntity,
  WorkItemQueueControlRevisionEntity,
  QueueOrderScopeHeadEntity,
  QueueOrderScopeProjectEntity,
  QueueOrderOverrideEntity,
  QueueOrderInvalidationHeadEntity,
  QueueOrderInvalidationRevisionEntity,
  QueueActionCandidateEntity,
  WorkspaceCapacityHeadEntity,
  WorkspaceCapacityReconciliationCheckpointEntity,
  CapacityScopeProjectionHeadEntity,
  CapacityScopeProjectionRevisionEntity,
  CapacityScopeProjectionProjectEntity,
  WorkItemHumanWipClaimEntity,
  ReviewCapacityReservationEntity,
  CapacityAdmissionDecisionEntity,
]);
