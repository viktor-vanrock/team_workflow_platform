import type {
  PipelineObservation,
  PipelineReadRequest,
  TestExecutorPort,
  TrustedConnectorOperationContext,
} from "@awp/connector-sdk";
import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

import type { GitLabClock } from "../auth/gitlab-auth.ts";
import type { GitLabRestClient } from "../http/gitlab-rest-client.ts";
import type { GitLabDialect } from "../profile/gitlab-dialect.ts";
import type {
  GitLabProfileConfiguration,
  GitLabProfileSuiteMapping,
} from "../profile/gitlab-profile-validator.ts";
import { assertGitLabTestExecutorContext, isGitLabSha256 } from "./gitlab-pipeline-trigger.ts";

export interface GitLabPipelineReadAuthority {
  readonly sourceCommitSha: string;
  readonly suiteKey: string;
  readonly environmentRef: string;
  readonly targetSnapshotHash: Sha256Digest;
  readonly configurationPinSetHash: Sha256Digest;
}

export interface GitLabPipelineReadTransport {
  readPipeline(
    input: Readonly<{
      numericProjectId: number;
      path: string;
      externalPipelineId: string;
      signal: AbortSignal;
    }>,
  ): Promise<unknown>;
  readJobs(
    input: Readonly<{
      numericProjectId: number;
      path: string;
      externalPipelineId: string;
      signal: AbortSignal;
    }>,
  ): Promise<unknown>;
}

export interface GitLabPipelineReaderOptions {
  readonly profile: GitLabProfileConfiguration;
  readonly authority: (request: PipelineReadRequest) => GitLabPipelineReadAuthority;
  readonly clock: GitLabClock;
  readonly transport: GitLabPipelineReadTransport;
}

export class GitLabPipelineReadError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GitLabPipelineReadError";
  }
}

interface ProviderJob {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly environmentName?: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

const terminalStates = new Set<PipelineObservation["providerState"]>([
  "SUCCESS",
  "FAILED",
  "CANCELED",
  "SKIPPED",
  "MANUAL",
]);

function deepFreeze<T>(value: T): T {
  if (typeof AbortSignal !== "undefined" && value instanceof AbortSignal) return value;
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function record(value: unknown, code: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new GitLabPipelineReadError(code);
  return value as Readonly<Record<string, unknown>>;
}

function text(value: unknown, code: string, maximum = 512): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    /\p{Cc}/u.test(value)
  ) {
    throw new GitLabPipelineReadError(code);
  }
  return value;
}

function opaqueNumericId(value: unknown, code: string): string {
  const candidate = typeof value === "number" ? String(value) : value;
  if (
    typeof candidate !== "string" ||
    !/^[1-9][0-9]{0,17}$/u.test(candidate) ||
    !Number.isSafeInteger(Number(candidate))
  ) {
    throw new GitLabPipelineReadError(code);
  }
  return candidate;
}

function commitSha(value: unknown): string {
  const candidate = text(value, "GITLAB_PIPELINE_READ_COMMIT_INVALID", 40);
  if (!/^[a-f0-9]{40}$/u.test(candidate))
    throw new GitLabPipelineReadError("GITLAB_PIPELINE_READ_COMMIT_INVALID");
  return candidate;
}

function optionalTimestamp(value: unknown, code: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  const raw = text(value, code, 64);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new GitLabPipelineReadError(code);
  return parsed.toISOString();
}

function timestamp(value: unknown, code: string): string {
  const result = optionalTimestamp(value, code);
  if (!result) throw new GitLabPipelineReadError(code);
  return result;
}

export function mapGitLabPipelineStatus(value: unknown): PipelineObservation["providerState"] {
  switch (String(value).toLowerCase()) {
    case "created":
      return "CREATED";
    case "waiting_for_resource":
      return "WAITING_FOR_RESOURCE";
    case "preparing":
      return "PREPARING";
    case "pending":
      return "PENDING";
    case "running":
      return "RUNNING";
    case "success":
      return "SUCCESS";
    case "failed":
      return "FAILED";
    case "canceled":
    case "cancelled":
      return "CANCELED";
    case "skipped":
      return "SKIPPED";
    case "manual":
      return "MANUAL";
    case "scheduled":
      return "SCHEDULED";
    default:
      return "UNKNOWN";
  }
}

function assertRequest(request: PipelineReadRequest, authority: GitLabPipelineReadAuthority): void {
  if (
    request.schemaVersion !== "test-executor.trigger-status@1.0.0" ||
    request.messageType !== "REQUEST" ||
    request.operation !== "pipeline.read" ||
    !request.automationAttemptId ||
    !isGitLabSha256(request.targetSnapshotHash) ||
    !isGitLabSha256(request.configurationPinSetHash) ||
    request.targetSnapshotHash !== authority.targetSnapshotHash ||
    request.configurationPinSetHash !== authority.configurationPinSetHash
  )
    throw new GitLabPipelineReadError("GITLAB_PIPELINE_READ_REQUEST_INVALID");
  opaqueNumericId(request.externalPipelineId, "GITLAB_PIPELINE_READ_ID_INVALID");
  commitSha(authority.sourceCommitSha);
}

function exactSuite(
  profile: GitLabProfileConfiguration,
  authority: GitLabPipelineReadAuthority,
): GitLabProfileSuiteMapping {
  const matches = profile.suiteMappings.filter(({ suiteKey }) => suiteKey === authority.suiteKey);
  const suite = matches[0];
  if (
    matches.length !== 1 ||
    !suite ||
    !profile.productionDenied ||
    !suite.allowedEnvironmentRefs.includes(authority.environmentRef) ||
    suite.logicalPipelineKey !== profile.trigger.logicalPipelineKey ||
    suite.sourceRefPolicyRef !== profile.trigger.sourceRefPolicyRef
  )
    throw new GitLabPipelineReadError("GITLAB_PIPELINE_READ_AUTHORITY_INVALID");
  return suite;
}

function providerJob(value: unknown, pipelineId: string): ProviderJob {
  const source = record(value, "GITLAB_PIPELINE_JOB_INVALID");
  if (
    source.pipeline_id !== undefined &&
    opaqueNumericId(source.pipeline_id, "GITLAB_PIPELINE_JOB_PIPELINE_ID_INVALID") !== pipelineId
  ) {
    throw new GitLabPipelineReadError("GITLAB_PIPELINE_JOB_SCOPE_MISMATCH");
  }
  const environment =
    source.environment === undefined || source.environment === null
      ? undefined
      : record(source.environment, "GITLAB_PIPELINE_JOB_ENVIRONMENT_INVALID");
  const environmentName = source.environment_name ?? environment?.name;
  return deepFreeze({
    id: opaqueNumericId(source.id ?? source.job_id, "GITLAB_PIPELINE_JOB_ID_INVALID"),
    name: text(source.name, "GITLAB_PIPELINE_JOB_NAME_INVALID", 255),
    status: text(source.status, "GITLAB_PIPELINE_JOB_STATUS_INVALID", 64).toLowerCase(),
    ...(environmentName === undefined || environmentName === null
      ? {}
      : { environmentName: text(environmentName, "GITLAB_PIPELINE_JOB_ENVIRONMENT_INVALID", 255) }),
    createdAt: timestamp(source.created_at, "GITLAB_PIPELINE_JOB_CREATED_AT_INVALID"),
    ...(optionalTimestamp(source.started_at, "GITLAB_PIPELINE_JOB_STARTED_AT_INVALID") === undefined
      ? {}
      : {
          startedAt: optionalTimestamp(
            source.started_at,
            "GITLAB_PIPELINE_JOB_STARTED_AT_INVALID",
          )!,
        }),
    ...(optionalTimestamp(source.finished_at, "GITLAB_PIPELINE_JOB_FINISHED_AT_INVALID") ===
    undefined
      ? {}
      : {
          finishedAt: optionalTimestamp(
            source.finished_at,
            "GITLAB_PIPELINE_JOB_FINISHED_AT_INVALID",
          )!,
        }),
  });
}

function jobOrder(left: ProviderJob, right: ProviderJob): number {
  const leftAt = left.finishedAt ?? left.startedAt ?? left.createdAt;
  const rightAt = right.finishedAt ?? right.startedAt ?? right.createdAt;
  const time = leftAt.localeCompare(rightAt);
  return time || Number(left.id) - Number(right.id);
}

function environmentMatches(environmentName: string | undefined, environmentRef: string): boolean {
  if (environmentName === undefined) return true;
  return (
    environmentName === environmentRef ||
    environmentRef.endsWith(`:${environmentName}`) ||
    environmentRef.includes(`:${environmentName}@`)
  );
}

function resultDescriptorRef(
  profile: GitLabProfileConfiguration,
  pipelineId: string,
  jobId: string,
  artifactPath: string,
): string {
  return `gitlab-result:${profile.numericGitLabProjectId}:${pipelineId}:${jobId}:${sha256(artifactPath)}`;
}

function durationMs(
  startedAt: string | undefined,
  finishedAt: string | undefined,
): number | undefined {
  if (!startedAt || !finishedAt) return undefined;
  const duration = Date.parse(finishedAt) - Date.parse(startedAt);
  if (!Number.isSafeInteger(duration) || duration < 0)
    throw new GitLabPipelineReadError("GITLAB_PIPELINE_DURATION_INVALID");
  return duration;
}

export function createGitLabRestPipelineReadTransport(
  client: GitLabRestClient,
  dialect: GitLabDialect,
): GitLabPipelineReadTransport {
  const transport: GitLabPipelineReadTransport = {
    async readPipeline(input: Parameters<GitLabPipelineReadTransport["readPipeline"]>[0]) {
      return await client.requestJson({
        operation: "pipeline.read",
        authOperation: "pipelineRead",
        method: "GET",
        path: dialect.pipelinePath(input.numericProjectId, input.externalPipelineId),
        signal: input.signal,
      });
    },
    async readJobs(input: Parameters<GitLabPipelineReadTransport["readJobs"]>[0]) {
      return await client.requestJson({
        operation: "pipeline.jobs-read",
        authOperation: "pipelineRead",
        method: "GET",
        path: dialect.pipelineJobsPath(input.numericProjectId, input.externalPipelineId),
        signal: input.signal,
      });
    },
  };
  return Object.freeze(transport);
}

export class GitLabPipelineReader implements Pick<TestExecutorPort, "read"> {
  constructor(private readonly options: GitLabPipelineReaderOptions) {
    if (
      !Number.isSafeInteger(options.profile.numericGitLabProjectId) ||
      options.profile.numericGitLabProjectId < 1
    ) {
      throw new GitLabPipelineReadError("GITLAB_PIPELINE_READ_PROJECT_INVALID");
    }
  }

  async read(
    context: TrustedConnectorOperationContext,
    request: PipelineReadRequest,
  ): Promise<PipelineObservation> {
    const observedAt = this.options.clock.now();
    assertGitLabTestExecutorContext(context, observedAt);
    const authority = this.options.authority(request);
    assertRequest(request, authority);
    const suite = exactSuite(this.options.profile, authority);
    const numericProjectId = this.options.profile.numericGitLabProjectId;
    const pipelineId = opaqueNumericId(
      request.externalPipelineId,
      "GITLAB_PIPELINE_READ_ID_INVALID",
    );
    const base = deepFreeze({
      numericProjectId,
      externalPipelineId: pipelineId,
      signal: context.signal,
    });
    const [pipelineValue, jobsValue] = await Promise.all([
      this.options.transport.readPipeline(
        deepFreeze({
          ...base,
          path: `/api/v4/projects/${numericProjectId}/pipelines/${pipelineId}`,
        }),
      ),
      this.options.transport.readJobs(
        deepFreeze({
          ...base,
          path: `/api/v4/projects/${numericProjectId}/pipelines/${pipelineId}/jobs`,
        }),
      ),
    ]);
    const pipeline = record(pipelineValue, "GITLAB_PIPELINE_READ_RESPONSE_INVALID");
    if (
      opaqueNumericId(
        pipeline.id ?? pipeline.pipeline_id,
        "GITLAB_PIPELINE_READ_RESPONSE_ID_INVALID",
      ) !== pipelineId
    ) {
      throw new GitLabPipelineReadError("GITLAB_PIPELINE_READ_RESPONSE_SCOPE_MISMATCH");
    }
    const sourceCommitSha = commitSha(pipeline.sha ?? pipeline.commit_sha);
    if (
      sourceCommitSha !== authority.sourceCommitSha ||
      text(pipeline.ref, "GITLAB_PIPELINE_READ_REF_INVALID", 255) !==
        this.options.profile.trigger.ref
    ) {
      throw new GitLabPipelineReadError("GITLAB_PIPELINE_READ_TARGET_MISMATCH");
    }
    if (!Array.isArray(jobsValue) || jobsValue.length > 64)
      throw new GitLabPipelineReadError("GITLAB_PIPELINE_JOB_SET_INVALID");
    const jobs = jobsValue.map((value) => providerJob(value, pipelineId)).sort(jobOrder);
    if (new Set(jobs.map(({ id }) => id)).size !== jobs.length)
      throw new GitLabPipelineReadError("GITLAB_PIPELINE_JOB_SET_DUPLICATE");
    const resultJobs = jobs.filter(
      ({ name, environmentName }) =>
        name === suite.resultJobName &&
        environmentMatches(environmentName, authority.environmentRef),
    );
    const selectedResultJob = resultJobs.at(-1);
    const providerState = mapGitLabPipelineStatus(pipeline.status);
    const queuedAt = timestamp(pipeline.created_at, "GITLAB_PIPELINE_CREATED_AT_INVALID");
    const providerUpdatedAt = timestamp(
      pipeline.updated_at ?? pipeline.finished_at ?? pipeline.created_at,
      "GITLAB_PIPELINE_UPDATED_AT_INVALID",
    );
    const startedAt =
      optionalTimestamp(pipeline.started_at, "GITLAB_PIPELINE_STARTED_AT_INVALID") ??
      jobs.find(({ startedAt: value }) => value !== undefined)?.startedAt;
    const finishedAt =
      optionalTimestamp(pipeline.finished_at, "GITLAB_PIPELINE_FINISHED_AT_INVALID") ??
      [...jobs].reverse().find(({ finishedAt: value }) => value !== undefined)?.finishedAt;
    const providerRevisionToken = sha256({
      numericProjectId,
      pipelineId,
      providerState,
      providerUpdatedAt,
      jobs: jobs.map(
        ({
          id,
          name,
          status,
          environmentName,
          createdAt,
          startedAt: jobStartedAt,
          finishedAt: jobFinishedAt,
        }) => ({
          id,
          name,
          status,
          ...(environmentName ? { environmentName } : {}),
          createdAt,
          ...(jobStartedAt ? { startedAt: jobStartedAt } : {}),
          ...(jobFinishedAt ? { finishedAt: jobFinishedAt } : {}),
        }),
      ),
    } as unknown as JsonValue);
    const body = deepFreeze({
      schemaVersion: "test-executor.trigger-status@1.0.0" as const,
      messageType: "RESULT" as const,
      operation: "pipeline.read" as const,
      externalPipelineId: pipelineId,
      externalJobIds: Object.freeze(jobs.map(({ id }) => id)),
      sourceCommitSha,
      providerState,
      terminal: terminalStates.has(providerState),
      queuedAt,
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(finishedAt === undefined ? {} : { finishedAt }),
      ...(durationMs(startedAt, finishedAt) === undefined
        ? {}
        : { durationMs: durationMs(startedAt, finishedAt)! }),
      providerRevisionToken,
      providerUpdatedAt,
      ...(selectedResultJob === undefined
        ? {}
        : {
            resultDescriptorRef: resultDescriptorRef(
              this.options.profile,
              pipelineId,
              selectedResultJob.id,
              suite.resultArtifactPath,
            ),
          }),
      observedAt: observedAt.toISOString(),
    });
    return deepFreeze({ ...body, observationHash: sha256(body as unknown as JsonValue) });
  }
}
