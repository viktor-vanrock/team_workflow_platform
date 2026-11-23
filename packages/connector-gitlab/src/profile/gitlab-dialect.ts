export type GitLabAdapterFamily = "gitlab-rest-v4";
export type GitLabApiFamily = "v4";
export type GitLabEdition = "CE" | "EE";
export type GitLabTriggerDialect = "TYPED_INPUTS" | "BOUNDED_VARIABLES";
export type GitLabWebhookDialect = "STANDARD_WEBHOOKS_HMAC_SHA256";

export interface GitLabInstanceDialectRequest {
  readonly adapterFamily: GitLabAdapterFamily;
  readonly apiFamily: GitLabApiFamily;
  readonly edition: GitLabEdition;
  readonly exactVersion: string;
  readonly exactBuild: string;
  readonly triggerDialect: GitLabTriggerDialect;
  readonly webhookDialect: GitLabWebhookDialect;
}

export interface GitLabDialect {
  readonly adapterFamily: GitLabAdapterFamily;
  readonly apiFamily: GitLabApiFamily;
  readonly apiPrefix: "/api/v4";
  readonly edition: GitLabEdition;
  readonly exactVersion: string;
  readonly exactBuild: string;
  readonly triggerDialect: GitLabTriggerDialect;
  readonly webhookDialect: GitLabWebhookDialect;
  versionPath(): "/api/v4/version";
  projectPath(projectId: number): string;
  mergeRequestPath(projectId: number, iid: string): string;
  commitPath(projectId: number, sha: string): string;
  branchPath(projectId: number, ref: string): string;
  ciLintPath(projectId: number): string;
  pipelinesPath(projectId: number): string;
  pipelinePath(projectId: number, pipelineId: string): string;
  pipelineVariablesPath(projectId: number, pipelineId: string): string;
  pipelineJobsPath(projectId: number, pipelineId: string): string;
  pipelineTriggerPath(projectId: number): string;
  jobArtifactsPath(projectId: number, jobId: string): string;
}

const exactToken = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u;

function positiveProjectId(projectId: number): string {
  if (!Number.isSafeInteger(projectId) || projectId < 1)
    throw new Error("GITLAB_PROJECT_ID_INVALID");
  return String(projectId);
}

function opaqueId(value: string, code: string): string {
  if (!value || value.length > 255 || /\p{Cc}/u.test(value)) throw new Error(code);
  return encodeURIComponent(value);
}

function projectPrefix(projectId: number): string {
  return `/api/v4/projects/${positiveProjectId(projectId)}`;
}

/**
 * Chooses one immutable, explicitly evidenced GitLab REST dialect. Feature
 * availability is never inferred from a moving "latest" alias or a guessed
 * server version; discovery must prove the requested trigger and webhook modes.
 */
export function createGitLabDialect(request: GitLabInstanceDialectRequest): GitLabDialect {
  if (request.adapterFamily !== "gitlab-rest-v4" || request.apiFamily !== "v4") {
    throw new Error("GITLAB_DIALECT_UNSUPPORTED");
  }
  if (request.edition !== "CE" && request.edition !== "EE")
    throw new Error("GITLAB_EDITION_UNSUPPORTED");
  if (!exactToken.test(request.exactVersion) || !exactToken.test(request.exactBuild)) {
    throw new Error("GITLAB_INSTANCE_VERSION_INVALID");
  }
  if (request.triggerDialect !== "TYPED_INPUTS" && request.triggerDialect !== "BOUNDED_VARIABLES") {
    throw new Error("GITLAB_TRIGGER_DIALECT_UNSUPPORTED");
  }
  if (request.webhookDialect !== "STANDARD_WEBHOOKS_HMAC_SHA256") {
    throw new Error("GITLAB_WEBHOOK_DIALECT_UNSUPPORTED");
  }

  return Object.freeze({
    adapterFamily: request.adapterFamily,
    apiFamily: request.apiFamily,
    apiPrefix: "/api/v4",
    edition: request.edition,
    exactVersion: request.exactVersion,
    exactBuild: request.exactBuild,
    triggerDialect: request.triggerDialect,
    webhookDialect: request.webhookDialect,
    versionPath: () => "/api/v4/version" as const,
    projectPath: (projectId: number) => projectPrefix(projectId),
    mergeRequestPath: (projectId: number, iid: string) =>
      `${projectPrefix(projectId)}/merge_requests/${opaqueId(iid, "GITLAB_MERGE_REQUEST_ID_INVALID")}`,
    commitPath: (projectId: number, sha: string) =>
      `${projectPrefix(projectId)}/repository/commits/${opaqueId(sha, "GITLAB_COMMIT_ID_INVALID")}`,
    branchPath: (projectId: number, ref: string) =>
      `${projectPrefix(projectId)}/repository/branches/${opaqueId(ref, "GITLAB_REF_INVALID")}`,
    ciLintPath: (projectId: number) => `${projectPrefix(projectId)}/ci/lint`,
    pipelinesPath: (projectId: number) => `${projectPrefix(projectId)}/pipelines`,
    pipelinePath: (projectId: number, pipelineId: string) =>
      `${projectPrefix(projectId)}/pipelines/${opaqueId(pipelineId, "GITLAB_PIPELINE_ID_INVALID")}`,
    pipelineVariablesPath: (projectId: number, pipelineId: string) =>
      `${projectPrefix(projectId)}/pipelines/${opaqueId(pipelineId, "GITLAB_PIPELINE_ID_INVALID")}/variables`,
    pipelineJobsPath: (projectId: number, pipelineId: string) =>
      `${projectPrefix(projectId)}/pipelines/${opaqueId(pipelineId, "GITLAB_PIPELINE_ID_INVALID")}/jobs`,
    pipelineTriggerPath: (projectId: number) => `${projectPrefix(projectId)}/trigger/pipeline`,
    jobArtifactsPath: (projectId: number, jobId: string) =>
      `${projectPrefix(projectId)}/jobs/${opaqueId(jobId, "GITLAB_JOB_ID_INVALID")}/artifacts`,
  });
}

export const resolveGitLabInstanceDialect = createGitLabDialect;
