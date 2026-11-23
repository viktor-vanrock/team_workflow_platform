import { EntitySchema } from "typeorm";

const text = { type: String };
const bigint = { type: "bigint" as const };
const timestamp = { type: "timestamptz" as const };
const jsonb = { type: "jsonb" as const };

export const GitLabMockProjectEntity = new EntitySchema({
  name: "GitLabMockProject",
  tableName: "mock_gitlab_projects",
  columns: {
    id: { name: "project_id", ...bigint, primary: true },
    pathWithNamespace: { name: "path_with_namespace", ...text },
    defaultBranch: { name: "default_branch", ...text },
    exactRef: { name: "exact_ref", ...text },
    edition: text,
    exactVersion: { name: "exact_version", ...text },
    exactBuild: { name: "exact_build", ...text },
    archived: { type: Boolean },
    jobsEnabled: { name: "jobs_enabled", type: Boolean },
    capabilities: jsonb,
    lintJobs: { name: "lint_jobs", ...jsonb },
    allowedControlScope: { name: "allowed_control_scope", type: Boolean },
    createdAt: { name: "created_at", ...timestamp },
    updatedAt: { name: "updated_at", ...timestamp },
  },
});
export const GitLabMockCommitEntity = new EntitySchema({
  name: "GitLabMockCommit",
  tableName: "mock_gitlab_commits",
  columns: {
    projectId: { name: "project_id", ...bigint, primary: true },
    commitSha: { name: "commit_sha", ...text, primary: true },
    parentCommitShas: { name: "parent_commit_shas", ...jsonb },
    committedAt: { name: "committed_at", ...timestamp },
  },
});
export const GitLabMockMergeRequestEntity = new EntitySchema({
  name: "GitLabMockMergeRequest",
  tableName: "mock_gitlab_merge_requests",
  columns: {
    projectId: { name: "project_id", ...bigint, primary: true },
    iid: { ...bigint, primary: true },
    state: text,
    sourceRef: { name: "source_ref", ...text },
    targetRef: { name: "target_ref", ...text },
    sourceCommitSha: { name: "source_commit_sha", ...text },
    targetCommitSha: { name: "target_commit_sha", ...text },
    headCommitSha: { name: "head_commit_sha", ...text },
    updatedAt: { name: "updated_at", ...timestamp },
  },
});
export const GitLabMockPipelineEntity = new EntitySchema({
  name: "GitLabMockPipeline",
  tableName: "mock_gitlab_pipelines",
  columns: {
    projectId: { name: "project_id", ...bigint, primary: true },
    pipelineId: { name: "pipeline_id", ...bigint, primary: true },
    source: text,
    ref: text,
    commitSha: { name: "commit_sha", ...text },
    status: text,
    pipelineName: { name: "pipeline_name", ...text, nullable: true },
    markerHash: { name: "marker_hash", ...text, nullable: true },
    variables: jsonb,
    createdAt: { name: "created_at", ...timestamp },
    updatedAt: { name: "updated_at", ...timestamp },
    finishedAt: { name: "finished_at", ...timestamp, nullable: true },
  },
});
export const GitLabMockJobEntity = new EntitySchema({
  name: "GitLabMockJob",
  tableName: "mock_gitlab_jobs",
  columns: {
    projectId: { name: "project_id", ...bigint, primary: true },
    pipelineId: { name: "pipeline_id", ...bigint },
    jobId: { name: "job_id", ...bigint, primary: true },
    name: text,
    stage: text,
    status: text,
    environmentName: { name: "environment_name", ...text, nullable: true },
    allowFailure: { name: "allow_failure", type: Boolean },
    createdAt: { name: "created_at", ...timestamp },
    startedAt: { name: "started_at", ...timestamp, nullable: true },
    finishedAt: { name: "finished_at", ...timestamp, nullable: true },
  },
});
export const GitLabMockMachineResultEntity = new EntitySchema({
  name: "GitLabMockMachineResult",
  tableName: "mock_gitlab_machine_results",
  columns: {
    projectId: { name: "project_id", ...bigint, primary: true },
    pipelineId: { name: "pipeline_id", ...bigint, primary: true },
    jobId: { name: "job_id", ...bigint, primary: true },
    schemaId: { name: "schema_id", ...text },
    schemaVersion: { name: "schema_version", type: Number },
    schemaDigest: { name: "schema_digest", ...text },
    resultBody: { name: "result_body", ...jsonb },
    resultHash: { name: "result_hash", ...text },
    createdAt: { name: "created_at", ...timestamp },
  },
});
export const GitLabMockArtifactEntity = new EntitySchema({
  name: "GitLabMockArtifact",
  tableName: "mock_gitlab_artifacts",
  columns: {
    projectId: { name: "project_id", ...bigint, primary: true },
    pipelineId: { name: "pipeline_id", ...bigint },
    jobId: { name: "job_id", ...bigint, primary: true },
    artifactPath: { name: "artifact_path", ...text, primary: true },
    fileName: { name: "file_name", ...text },
    mediaType: { name: "media_type", ...text },
    contentBytes: { name: "content_bytes", type: "bytea" },
    byteSize: { name: "byte_size", ...bigint },
    checksum: text,
    classification: text,
    expiresAt: { name: "expires_at", ...timestamp },
    createdAt: { name: "created_at", ...timestamp },
  },
});
export const GitLabMockWebhookDeliveryEntity = new EntitySchema({
  name: "GitLabMockWebhookDelivery",
  tableName: "mock_gitlab_webhook_deliveries",
  columns: {
    deliveryId: { name: "delivery_id", ...text, primary: true },
    projectId: { name: "project_id", ...bigint },
    eventKind: { name: "event_kind", ...text },
    bodyBytes: { name: "body_bytes", type: "bytea" },
    bodyHash: { name: "body_hash", ...text },
    signature: text,
    keyVersionRef: { name: "key_version_ref", ...text },
    deliveryTimestamp: { name: "delivery_timestamp", ...timestamp },
    deliveryAttempt: { name: "delivery_attempt", type: Number },
    state: text,
    createdAt: { name: "created_at", ...timestamp },
    updatedAt: { name: "updated_at", ...timestamp },
  },
});
export const GitLabMockFaultEntity = new EntitySchema({
  name: "GitLabMockFault",
  tableName: "mock_gitlab_faults",
  columns: {
    projectId: { name: "project_id", ...bigint, primary: true },
    operation: { ...text, primary: true },
    fault: text,
    remaining: { type: Number },
    revision: bigint,
    updatedAt: { name: "updated_at", ...timestamp },
  },
});
export const GitLabMockCallAuditEntity = new EntitySchema({
  name: "GitLabMockCallAudit",
  tableName: "mock_gitlab_call_audit",
  columns: {
    sequence: { ...bigint, primary: true, generated: "increment" },
    projectId: { name: "project_id", ...bigint, nullable: true },
    operation: text,
    method: text,
    requestHash: { name: "request_hash", ...text },
    effectMarkerHash: { name: "effect_marker_hash", ...text, nullable: true },
    externalPipelineId: { name: "external_pipeline_id", ...text, nullable: true },
    outcome: text,
    calledAt: { name: "called_at", ...timestamp },
  },
});

export const gitLabMockEntities = Object.freeze([
  GitLabMockProjectEntity,
  GitLabMockCommitEntity,
  GitLabMockMergeRequestEntity,
  GitLabMockPipelineEntity,
  GitLabMockJobEntity,
  GitLabMockMachineResultEntity,
  GitLabMockArtifactEntity,
  GitLabMockWebhookDeliveryEntity,
  GitLabMockFaultEntity,
  GitLabMockCallAuditEntity,
]);
