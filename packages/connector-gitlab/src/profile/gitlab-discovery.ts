import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

import type { GitLabDialect, GitLabEdition } from "./gitlab-dialect.ts";

export interface GitLabDiscoveryTransport {
  get(path: string): Promise<unknown>;
  post(path: string, body: Readonly<Record<string, JsonValue>>): Promise<unknown>;
}

export type GitLabSourceProbe =
  | Readonly<{ kind: "MERGE_REQUEST"; externalId: string }>
  | Readonly<{ kind: "COMMIT"; externalId: string }>;

export interface GitLabDiscoveryRequest {
  readonly numericProjectId: number;
  readonly exactRef: string;
  readonly expectedEdition: GitLabEdition;
  readonly expectedVersion: string;
  readonly expectedBuild: string;
  readonly sourceProbes?: readonly GitLabSourceProbe[];
  readonly maxJobFacts?: number;
}

export interface GitLabDiscoveredJobFact {
  readonly name: string;
  readonly stage: string;
  readonly environment?: string;
  readonly when?: string;
  readonly allowFailure: boolean;
  readonly deployLike: boolean;
}

export interface GitLabDiscoverySnapshot {
  readonly schemaVersion: "gitlab-discovery-snapshot@1.0.0";
  readonly adapterFamily: "gitlab-rest-v4";
  readonly apiFamily: "v4";
  readonly edition: GitLabEdition;
  readonly exactVersion: string;
  readonly exactBuild: string;
  readonly numericProjectId: number;
  readonly canonicalProjectPathHash: Sha256Digest;
  readonly projectArchived: boolean;
  readonly defaultBranch?: string;
  readonly exactRef: string;
  readonly refCommitSha: string;
  readonly refProtected: boolean;
  readonly sourceFacts: readonly Readonly<{
    kind: "MERGE_REQUEST" | "COMMIT";
    externalIdHash: Sha256Digest;
    revision: string;
  }>[];
  readonly lint: Readonly<{
    dryRun: true;
    includeJobs: true;
    valid: boolean;
    issueCodes: readonly string[];
    jobs: readonly GitLabDiscoveredJobFact[];
    jobSetHash: Sha256Digest;
    productionOrDeployReachable: boolean;
  }>;
  readonly capabilities: Readonly<{
    projectRead: true;
    sourceRead: true;
    pipelineRead: boolean;
    pipelineTrigger: boolean;
    artifactRead: boolean;
    ciLintDryRun: true;
    ciLintIncludeJobs: true;
    standardWebhookHmacSha256: boolean;
  }>;
  readonly productionDenied: boolean;
  readonly contentHash: Sha256Digest;
}

export class GitLabDiscoveryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GitLabDiscoveryError";
  }
}

function record(
  value: unknown,
  code = "GITLAB_DISCOVERY_RESPONSE_INVALID",
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new GitLabDiscoveryError(code);
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, maximum: number, code: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    /\p{Cc}/u.test(value)
  ) {
    throw new GitLabDiscoveryError(code);
  }
  return value;
}

function positiveInteger(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new GitLabDiscoveryError(code);
  return value;
}

function optionalString(value: unknown, maximum: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return boundedString(value, maximum, "GITLAB_DISCOVERY_OPTIONAL_STRING_INVALID");
}

function deployLike(...values: readonly (string | undefined)[]): boolean {
  return values.some(
    (value) =>
      value !== undefined &&
      /(?:^|[._:/-])(?:deploy|deployment|production|prod)(?:$|[._:/-])/iu.test(value),
  );
}

function jobFacts(value: unknown, maximum: number): readonly GitLabDiscoveredJobFact[] {
  if (!Array.isArray(value)) throw new GitLabDiscoveryError("GITLAB_CI_LINT_JOBS_MISSING");
  if (value.length > maximum) throw new GitLabDiscoveryError("GITLAB_CI_LINT_JOBS_LIMIT_EXCEEDED");
  return Object.freeze(
    value.map((item) => {
      const job = record(item, "GITLAB_CI_LINT_JOB_INVALID");
      const environmentValue = job.environment;
      const environment =
        typeof environmentValue === "string"
          ? optionalString(environmentValue, 255)
          : environmentValue &&
              typeof environmentValue === "object" &&
              !Array.isArray(environmentValue)
            ? optionalString((environmentValue as Record<string, unknown>).name, 255)
            : undefined;
      const name = boundedString(job.name, 128, "GITLAB_CI_LINT_JOB_NAME_INVALID");
      const stage = boundedString(job.stage, 128, "GITLAB_CI_LINT_JOB_STAGE_INVALID");
      const when = optionalString(job.when, 32);
      return Object.freeze({
        name,
        stage,
        ...(environment === undefined ? {} : { environment }),
        ...(when === undefined ? {} : { when }),
        allowFailure: job.allow_failure === true,
        deployLike: deployLike(name, stage, environment),
      });
    }),
  );
}

function lintIssueCodes(lint: Record<string, unknown>): readonly string[] {
  const codes = new Set<string>();
  if (lint.valid !== true) codes.add("CI_LINT_INVALID");
  if (Array.isArray(lint.errors) && lint.errors.length > 0) codes.add("CI_LINT_ERRORS_PRESENT");
  if (Array.isArray(lint.warnings) && lint.warnings.length > 0)
    codes.add("CI_LINT_WARNINGS_PRESENT");
  return Object.freeze([...codes]);
}

function feature(response: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const capabilities = response.capabilities;
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities))
    return fallback;
  const value = (capabilities as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : false;
}

function sourceRevision(kind: GitLabSourceProbe["kind"], value: Record<string, unknown>): string {
  return kind === "MERGE_REQUEST"
    ? boundedString(value.sha ?? value.diff_head_sha, 128, "GITLAB_MERGE_REQUEST_REVISION_INVALID")
    : boundedString(value.id ?? value.sha, 128, "GITLAB_COMMIT_REVISION_INVALID");
}

function discoveredEdition(version: Record<string, unknown>): GitLabEdition {
  if (version.edition === "CE" || version.edition === "EE") return version.edition;
  if (version.enterprise === true) return "EE";
  if (version.enterprise === false) return "CE";
  throw new GitLabDiscoveryError("GITLAB_EDITION_UNPROVEN");
}

function snapshotHashInput(snapshot: Omit<GitLabDiscoverySnapshot, "contentHash">): JsonValue {
  return snapshot as unknown as JsonValue;
}

export async function discoverGitLab(
  transport: GitLabDiscoveryTransport,
  dialect: GitLabDialect,
  request: GitLabDiscoveryRequest,
): Promise<GitLabDiscoverySnapshot> {
  positiveInteger(request.numericProjectId, "GITLAB_PROJECT_ID_INVALID");
  if (request.sourceProbes && request.sourceProbes.length > 8)
    throw new GitLabDiscoveryError("GITLAB_SOURCE_PROBE_LIMIT_EXCEEDED");
  const maxJobs = request.maxJobFacts ?? 128;
  if (!Number.isSafeInteger(maxJobs) || maxJobs < 1 || maxJobs > 256)
    throw new GitLabDiscoveryError("GITLAB_CI_LINT_JOB_LIMIT_INVALID");

  const [versionRaw, projectRaw, branchRaw, lintRaw] = await Promise.all([
    transport.get(dialect.versionPath()),
    transport.get(dialect.projectPath(request.numericProjectId)),
    transport.get(dialect.branchPath(request.numericProjectId, request.exactRef)),
    transport.post(
      dialect.ciLintPath(request.numericProjectId),
      Object.freeze({
        ref: request.exactRef,
        dry_run: true,
        include_jobs: true,
      }),
    ),
  ]);
  const version = record(versionRaw);
  const project = record(projectRaw);
  const branch = record(branchRaw);
  const lint = record(lintRaw);
  const discoveredVersion = boundedString(version.version, 128, "GITLAB_VERSION_INVALID");
  const discoveredBuild = boundedString(
    version.revision ?? version.build,
    128,
    "GITLAB_BUILD_INVALID",
  );
  const edition = discoveredEdition(version);
  if (
    discoveredVersion !== request.expectedVersion ||
    discoveredBuild !== request.expectedBuild ||
    edition !== request.expectedEdition
  ) {
    throw new GitLabDiscoveryError("GITLAB_INSTANCE_PIN_MISMATCH");
  }
  const projectId = positiveInteger(project.id, "GITLAB_DISCOVERED_PROJECT_ID_INVALID");
  if (projectId !== request.numericProjectId)
    throw new GitLabDiscoveryError("GITLAB_DISCOVERED_PROJECT_SCOPE_MISMATCH");
  const projectPath = boundedString(
    project.path_with_namespace,
    512,
    "GITLAB_PROJECT_PATH_INVALID",
  );
  const commit = record(branch.commit, "GITLAB_BRANCH_COMMIT_INVALID");
  const refCommitSha = boundedString(commit.id ?? commit.sha, 128, "GITLAB_REF_COMMIT_INVALID");
  const jobs = jobFacts(lint.jobs, maxJobs);

  const sourceFacts = Object.freeze(
    await Promise.all(
      (request.sourceProbes ?? []).map(async (probe) => {
        const response = record(
          await transport.get(
            probe.kind === "MERGE_REQUEST"
              ? dialect.mergeRequestPath(request.numericProjectId, probe.externalId)
              : dialect.commitPath(request.numericProjectId, probe.externalId),
          ),
        );
        return Object.freeze({
          kind: probe.kind,
          externalIdHash: sha256(probe.externalId),
          revision: sourceRevision(probe.kind, response),
        });
      }),
    ),
  );

  const projectArchived = project.archived === true;
  const defaultBranch = optionalString(project.default_branch, 255);
  const productionOrDeployReachable = jobs.some(({ deployLike: isDeployLike }) => isDeployLike);
  const withoutHash: Omit<GitLabDiscoverySnapshot, "contentHash"> = Object.freeze({
    schemaVersion: "gitlab-discovery-snapshot@1.0.0",
    adapterFamily: dialect.adapterFamily,
    apiFamily: dialect.apiFamily,
    edition,
    exactVersion: discoveredVersion,
    exactBuild: discoveredBuild,
    numericProjectId: projectId,
    canonicalProjectPathHash: sha256(projectPath),
    projectArchived,
    ...(defaultBranch === undefined ? {} : { defaultBranch }),
    exactRef: request.exactRef,
    refCommitSha,
    refProtected: branch.protected === true,
    sourceFacts,
    lint: Object.freeze({
      dryRun: true,
      includeJobs: true,
      valid: lint.valid === true,
      issueCodes: lintIssueCodes(lint),
      jobs,
      jobSetHash: sha256(jobs as unknown as JsonValue),
      productionOrDeployReachable,
    }),
    capabilities: Object.freeze({
      projectRead: true,
      sourceRead: true,
      pipelineRead: feature(project, "pipelineRead", project.jobs_enabled !== false),
      pipelineTrigger: feature(project, "pipelineTrigger", project.jobs_enabled !== false),
      artifactRead: feature(project, "artifactRead", project.jobs_enabled !== false),
      ciLintDryRun: true,
      ciLintIncludeJobs: true,
      standardWebhookHmacSha256: feature(project, "standardWebhookHmacSha256", false),
    }),
    productionDenied: !projectArchived && !productionOrDeployReachable,
  });
  return Object.freeze({ ...withoutHash, contentHash: sha256(snapshotHashInput(withoutHash)) });
}

export class GitLabDiscoveryService {
  constructor(
    private readonly transport: GitLabDiscoveryTransport,
    private readonly dialect: GitLabDialect,
  ) {}

  async discover(request: GitLabDiscoveryRequest): Promise<GitLabDiscoverySnapshot> {
    return await discoverGitLab(this.transport, this.dialect, request);
  }
}
