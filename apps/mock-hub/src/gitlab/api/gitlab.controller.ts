import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UnauthorizedException,
} from "@nestjs/common";

import { TypeOrmGitLabRepository } from "../state/gitlab.repository.ts";

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

export const gitLabMockProtocolSurface = Object.freeze([
  Object.freeze(["GET", "/api/v4/version"] as const),
  Object.freeze(["GET", "/api/v4/projects/:projectId"] as const),
  Object.freeze(["GET", "/api/v4/projects/:projectId/merge_requests/:iid"] as const),
  Object.freeze(["GET", "/api/v4/projects/:projectId/repository/commits/:sha"] as const),
  Object.freeze(["GET", "/api/v4/projects/:projectId/repository/branches/:ref"] as const),
  Object.freeze(["POST", "/api/v4/projects/:projectId/ci/lint"] as const),
  Object.freeze(["POST", "/api/v4/projects/:projectId/trigger/pipeline"] as const),
  Object.freeze(["GET", "/api/v4/projects/:projectId/pipelines"] as const),
  Object.freeze(["GET", "/api/v4/projects/:projectId/pipelines/:pipelineId"] as const),
  Object.freeze(["GET", "/api/v4/projects/:projectId/pipelines/:pipelineId/variables"] as const),
  Object.freeze(["GET", "/api/v4/projects/:projectId/pipelines/:pipelineId/jobs"] as const),
  Object.freeze(["GET", "/api/v4/projects/:projectId/jobs/:jobId/artifacts"] as const),
]);

const routePatterns = Object.freeze(
  gitLabMockProtocolSurface.map(([method, path]) =>
    Object.freeze({
      method,
      pattern: new RegExp(`^${path.replaceAll("/", "\\/").replace(/:[A-Za-z]+/gu, "[^/]+")}$`, "u"),
    }),
  ),
);

export function assertGitLabMockProtocolOperation(method: string, path: string): void {
  if (
    !routePatterns.some((candidate) => candidate.method === method && candidate.pattern.test(path))
  )
    throw new Error("GITLAB_MOCK_ROUTE_UNKNOWN");
}

function positiveId(value: string, code: string): number {
  if (!/^\d+$/u.test(value)) throw new BadRequestException({ code });
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new BadRequestException({ code });
  return id;
}

function readAuthorized(credential: string | undefined): void {
  if (credential !== "mock-gitlab-read")
    throw new UnauthorizedException({ code: "GITLAB_MOCK_READ_UNAUTHORIZED" });
}

function triggerAuthorized(credential: unknown): void {
  if (credential !== "mock-gitlab-trigger")
    throw new UnauthorizedException({ code: "GITLAB_MOCK_TRIGGER_UNAUTHORIZED" });
}

function mapError(error: unknown, response?: ResponseLike): never {
  const code = error instanceof Error ? error.message : "GITLAB_MOCK_ERROR";
  if (code.includes("AUTHENTICATION_401")) throw new UnauthorizedException({ code });
  if (code.includes("PERMISSION_403") || code.includes("SCOPE_FORBIDDEN"))
    throw new HttpException({ code }, HttpStatus.FORBIDDEN);
  if (code.includes("RATE_LIMIT_429")) {
    response?.setHeader("Retry-After", "11");
    throw new HttpException({ code }, HttpStatus.TOO_MANY_REQUESTS);
  }
  if (code.includes("NOT_FOUND")) throw new HttpException({ code }, HttpStatus.NOT_FOUND);
  if (code.includes("SERVER_500"))
    throw new HttpException({ code }, HttpStatus.INTERNAL_SERVER_ERROR);
  if (code.includes("TIMEOUT") || code.includes("NETWORK_LOSS"))
    throw new HttpException({ code }, HttpStatus.SERVICE_UNAVAILABLE);
  throw error;
}

@Controller("api/v4")
export class GitLabController {
  constructor(
    @Inject(TypeOrmGitLabRepository) private readonly repository: TypeOrmGitLabRepository,
  ) {}

  @Get("version")
  version() {
    return Object.freeze({
      version: "18.1.0-mock.1",
      revision: "mock-build-1",
      edition: "EE",
      enterprise: true,
    });
  }

  @Get("projects/:projectId")
  async project(
    @Headers("private-token") credential: string | undefined,
    @Param("projectId") projectId: string,
  ) {
    readAuthorized(credential);
    try {
      const project = await this.repository.project(
        positiveId(projectId, "GITLAB_MOCK_PROJECT_ID_INVALID"),
      );
      return Object.freeze({
        id: project.id,
        path_with_namespace: project.pathWithNamespace,
        default_branch: project.defaultBranch,
        archived: project.archived,
        jobs_enabled: project.jobsEnabled,
        capabilities: project.capabilities,
      });
    } catch (error) {
      mapError(error);
    }
  }

  @Get("projects/:projectId/merge_requests/:iid")
  async mergeRequest(
    @Headers("private-token") credential: string | undefined,
    @Param("projectId") projectId: string,
    @Param("iid") iid: string,
  ) {
    readAuthorized(credential);
    try {
      const value = await this.repository.mergeRequest(
        positiveId(projectId, "GITLAB_MOCK_PROJECT_ID_INVALID"),
        positiveId(iid, "GITLAB_MOCK_MR_ID_INVALID"),
      );
      return Object.freeze({
        iid: value.iid,
        state: value.state,
        source_branch: value.sourceRef,
        target_branch: value.targetRef,
        sha: value.headCommitSha,
        diff_head_sha: value.headCommitSha,
        updated_at: value.updatedAt,
      });
    } catch (error) {
      mapError(error);
    }
  }

  @Get("projects/:projectId/repository/commits/:sha")
  async commit(
    @Headers("private-token") credential: string | undefined,
    @Param("projectId") projectId: string,
    @Param("sha") sha: string,
  ) {
    readAuthorized(credential);
    try {
      const value = await this.repository.commit(
        positiveId(projectId, "GITLAB_MOCK_PROJECT_ID_INVALID"),
        sha,
      );
      return Object.freeze({
        id: value.sha,
        parent_ids: value.parentShas,
        committed_date: value.committedAt,
      });
    } catch (error) {
      mapError(error);
    }
  }

  @Get("projects/:projectId/repository/branches/:ref")
  async branch(
    @Headers("private-token") credential: string | undefined,
    @Param("projectId") projectId: string,
    @Param("ref") ref: string,
  ) {
    readAuthorized(credential);
    try {
      const value = await this.repository.branch(
        positiveId(projectId, "GITLAB_MOCK_PROJECT_ID_INVALID"),
        ref,
      );
      return Object.freeze({
        name: value.name,
        protected: value.protected,
        commit: Object.freeze({
          id: value.commit.sha,
          parent_ids: value.commit.parentShas,
          committed_date: value.commit.committedAt,
        }),
      });
    } catch (error) {
      mapError(error);
    }
  }

  @Post("projects/:projectId/ci/lint")
  async lint(
    @Headers("private-token") credential: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: Readonly<Record<string, unknown>>,
  ) {
    readAuthorized(credential);
    if (body.dry_run !== true || body.include_jobs !== true || typeof body.ref !== "string")
      throw new BadRequestException({ code: "GITLAB_MOCK_CI_LINT_CONTRACT_INVALID" });
    try {
      return await this.repository.lint(
        positiveId(projectId, "GITLAB_MOCK_PROJECT_ID_INVALID"),
        body.ref,
      );
    } catch (error) {
      mapError(error);
    }
  }

  @Post("projects/:projectId/trigger/pipeline")
  async trigger(
    @Param("projectId") projectId: string,
    @Body() body: Readonly<Record<string, unknown>>,
  ) {
    triggerAuthorized(body.token);
    if (typeof body.ref !== "string" || typeof body.name !== "string")
      throw new BadRequestException({ code: "GITLAB_MOCK_TRIGGER_BODY_INVALID" });
    const typed = body.inputs;
    const variables = body.variables;
    let inputs: Readonly<Record<string, string | number | boolean>>;
    if (typed !== null && typeof typed === "object" && !Array.isArray(typed))
      inputs = typed as Readonly<Record<string, string | number | boolean>>;
    else if (Array.isArray(variables))
      inputs = Object.freeze(
        Object.fromEntries(
          variables.map((entry) => {
            if (entry === null || typeof entry !== "object" || Array.isArray(entry))
              throw new BadRequestException({ code: "GITLAB_MOCK_TRIGGER_VARIABLE_INVALID" });
            const pair = entry as Readonly<Record<string, unknown>>;
            if (
              typeof pair.key !== "string" ||
              !["string", "number", "boolean"].includes(typeof pair.value)
            )
              throw new BadRequestException({ code: "GITLAB_MOCK_TRIGGER_VARIABLE_INVALID" });
            return [pair.key, pair.value as string | number | boolean];
          }),
        ),
      );
    else throw new BadRequestException({ code: "GITLAB_MOCK_TRIGGER_INPUTS_REQUIRED" });
    try {
      return await this.repository.triggerPipeline({
        projectId: positiveId(projectId, "GITLAB_MOCK_PROJECT_ID_INVALID"),
        ref: body.ref,
        pipelineName: body.name,
        inputs,
      });
    } catch (error) {
      mapError(error);
    }
  }

  @Get("projects/:projectId/pipelines")
  async pipelines(
    @Headers("private-token") credential: string | undefined,
    @Param("projectId") projectId: string,
    @Query("ref") ref?: string,
    @Query("created_after") start?: string,
    @Query("created_before") end?: string,
    @Res({ passthrough: true }) response?: ResponseLike,
  ) {
    readAuthorized(credential);
    try {
      return await this.repository.pipelines(
        positiveId(projectId, "GITLAB_MOCK_PROJECT_ID_INVALID"),
        ref,
        { ...(start === undefined ? {} : { start }), ...(end === undefined ? {} : { end }) },
      );
    } catch (error) {
      mapError(error, response);
    }
  }

  @Get("projects/:projectId/pipelines/:pipelineId")
  async pipeline(
    @Headers("private-token") credential: string | undefined,
    @Param("projectId") projectId: string,
    @Param("pipelineId") pipelineId: string,
    @Res({ passthrough: true }) response?: ResponseLike,
  ) {
    readAuthorized(credential);
    try {
      return await this.repository.pipeline(
        positiveId(projectId, "GITLAB_MOCK_PROJECT_ID_INVALID"),
        positiveId(pipelineId, "GITLAB_MOCK_PIPELINE_ID_INVALID"),
      );
    } catch (error) {
      mapError(error, response);
    }
  }

  @Get("projects/:projectId/pipelines/:pipelineId/variables")
  async variables(
    @Headers("private-token") credential: string | undefined,
    @Param("projectId") projectId: string,
    @Param("pipelineId") pipelineId: string,
    @Res({ passthrough: true }) response?: ResponseLike,
  ) {
    const pipeline = (await this.pipeline(credential, projectId, pipelineId, response)) as Readonly<
      Record<string, unknown>
    >;
    return pipeline.variables ?? [];
  }

  @Get("projects/:projectId/pipelines/:pipelineId/jobs")
  async jobs(
    @Headers("private-token") credential: string | undefined,
    @Param("projectId") projectId: string,
    @Param("pipelineId") pipelineId: string,
    @Res({ passthrough: true }) response?: ResponseLike,
  ) {
    readAuthorized(credential);
    try {
      return await this.repository.jobs(
        positiveId(projectId, "GITLAB_MOCK_PROJECT_ID_INVALID"),
        positiveId(pipelineId, "GITLAB_MOCK_PIPELINE_ID_INVALID"),
      );
    } catch (error) {
      mapError(error, response);
    }
  }

  @Get("projects/:projectId/jobs/:jobId/artifacts")
  async artifact(
    @Headers("private-token") credential: string | undefined,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
    @Query("artifact_path") artifactPath?: string,
    @Res({ passthrough: true }) response?: ResponseLike,
  ) {
    readAuthorized(credential);
    if (!artifactPath)
      throw new BadRequestException({ code: "GITLAB_MOCK_ARTIFACT_PATH_REQUIRED" });
    try {
      const row = await this.repository.artifact(
        positiveId(projectId, "GITLAB_MOCK_PROJECT_ID_INVALID"),
        positiveId(jobId, "GITLAB_MOCK_JOB_ID_INVALID"),
        artifactPath,
      );
      const bytes = Buffer.isBuffer(row.content_bytes)
        ? row.content_bytes
        : Buffer.from(row.content_bytes as Uint8Array);
      return new StreamableFile(bytes, {
        type: String(row.media_type),
        length: Number(row.byte_size),
        disposition: `attachment; filename="${String(row.file_name).replaceAll('"', "")}"`,
      });
    } catch (error) {
      mapError(error, response);
    }
  }
}
