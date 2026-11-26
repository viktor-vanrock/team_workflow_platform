import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { DataSource } from "typeorm";

import {
  createAutomationLaunchConfirmation,
  qaAggregateSnapshotHash,
  type QaAutomationLaunchConfirmation,
} from "@awp/competency-qa/node";
import { strongSessionEtag, TypeOrmGitLabAutomationAttemptQuery } from "@awp/runtime-composition";

import {
  authorizeQaApi,
  QA_DATA_SOURCE,
  QaSessionGuard,
  type QaSessionRequest,
} from "../qa-api-authorization.ts";
import { assertQaAutomationHuman } from "./qa-automation-security.ts";

export const QA_AUTOMATION_ATTEMPTS_API = Symbol("QA_AUTOMATION_ATTEMPTS_API");

interface ResponseLike {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
}

function setOperationalHeaders(
  response: ResponseLike,
  value: Readonly<{
    connectionHealth: string;
    freshness: string;
    executionActivity: string;
    reasonCodes: readonly string[];
    lastAuthoritativeReadAt?: string;
    nextEligibleAt?: string;
  }>,
): void {
  response.setHeader("X-AWP-GitLab-Connection-Health", value.connectionHealth);
  response.setHeader("X-AWP-GitLab-Freshness", value.freshness);
  response.setHeader("X-AWP-Automation-Execution-Activity", value.executionActivity);
  response.setHeader("X-AWP-GitLab-Reason-Codes", value.reasonCodes.join(","));
  if (value.lastAuthoritativeReadAt)
    response.setHeader("X-AWP-GitLab-Last-Authoritative-Read", value.lastAuthoritativeReadAt);
  if (value.nextEligibleAt)
    response.setHeader("X-AWP-GitLab-Next-Eligible-At", value.nextEligibleAt);
  response.setHeader("Cache-Control", "no-store");
}

function object(value: unknown, code: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new BadRequestException(code);
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  code: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new BadRequestException(`${code}:${unknown.sort().join(",")}`);
}

function strongVersion(
  value: string | undefined,
): Readonly<{ version: number; semanticHash: `sha256:${string}` }> {
  const match = /^"qa-session:([1-9][0-9]*):(sha256:[a-f0-9]{64})"$/u.exec(value ?? "");
  if (!match) throw new ConflictException("QA_AUTOMATION_STRONG_IF_MATCH_REQUIRED");
  return Object.freeze({ version: Number(match[1]), semanticHash: match[2] as `sha256:${string}` });
}

function requestedSessionVersion(
  value: string | undefined,
): Readonly<{ version: number; semanticHash?: `sha256:${string}` }> {
  if (process.env.AWP_QUEUE_STATIC_CONTOUR === "true") return strongVersion(value);
  const match = /^(?:W\/)?"([1-9][0-9]*)"$/u.exec(value ?? "");
  if (!match) throw new ConflictException("QA_AUTOMATION_IF_MATCH_REQUIRED");
  return Object.freeze({ version: Number(match[1]) });
}

async function currentSessionEtag(
  source: DataSource,
  workspaceId: string,
  projectId: string,
  sessionId: string,
): Promise<string> {
  const raw = (await source.query(
    "SELECT resource_version,content FROM qa_test_sessions WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3",
    [workspaceId, projectId, sessionId],
  )) as readonly Readonly<{ resource_version: number | string; content: unknown }>[];
  const rows = (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Readonly<{
    resource_version: number | string;
    content: unknown;
  }>[];
  const row = rows[0];
  if (!row) throw new NotFoundException("QA_AUTOMATED_SESSION_NOT_FOUND");
  const content =
    typeof row.content === "string" ? (JSON.parse(row.content) as unknown) : row.content;
  return process.env.AWP_QUEUE_STATIC_CONTOUR === "true"
    ? strongSessionEtag({
        sourceId: sessionId,
        sourceVersion: Number(row.resource_version),
        semanticHash: qaAggregateSnapshotHash(content as never),
      })
    : `W/"${Number(row.resource_version)}"`;
}

function confirmation(value: unknown): QaAutomationLaunchConfirmation {
  const candidate = object(value, "QA_AUTOMATION_CONFIRMATION_INVALID");
  exactKeys(
    candidate,
    [
      "reason",
      "targetSnapshotHash",
      "suiteBindingHash",
      "configurationPinSetHash",
      "sessionResourceVersion",
      "actionHash",
      "confirmationHash",
    ],
    "QA_AUTOMATION_CONFIRMATION_FIELD_FORBIDDEN",
  );
  const expected = createAutomationLaunchConfirmation({
    reason: candidate.reason as "INITIAL" | "HUMAN_RERUN",
    targetSnapshotHash: String(candidate.targetSnapshotHash) as `sha256:${string}`,
    suiteBindingHash: String(candidate.suiteBindingHash) as `sha256:${string}`,
    configurationPinSetHash: String(candidate.configurationPinSetHash) as `sha256:${string}`,
    sessionResourceVersion: Number(candidate.sessionResourceVersion),
  });
  if (
    candidate.actionHash !== expected.actionHash ||
    candidate.confirmationHash !== expected.confirmationHash
  ) {
    throw new ConflictException("QA_AUTOMATION_LAUNCH_CONFIRMATION_MISMATCH");
  }
  return Object.freeze({ ...expected });
}

function mapConflict(error: unknown): never {
  const code = error instanceof Error ? error.message : "QA_AUTOMATION_REQUEST_FAILED";
  if (
    code === "CORPORATE_GITLAB_BUILD_REF_REQUIRED" ||
    code === "CORPORATE_GITLAB_BUILD_REF_MAPPING_REQUIRED"
  )
    throw new ConflictException(code);
  if (
    /STALE|MISMATCH|CONFLICT|CAPACITY|LAUNCH_STATE_INVALID|RERUN_STATE_INVALID|FRESH_REQUEST_KEY|EXECUTION_CLOSED|REVIEW_FROZEN/u.test(
      code,
    )
  )
    throw new ConflictException(code);
  throw error;
}

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/qa/automated-sessions/:sessionId")
@UseGuards(QaSessionGuard)
export class QaAutomationAttemptsController {
  constructor(
    @Inject(QA_DATA_SOURCE) private readonly source: DataSource,
    @Inject(QA_AUTOMATION_ATTEMPTS_API)
    private readonly attempts: TypeOrmGitLabAutomationAttemptQuery,
  ) {}

  @Get("launch-confirmation")
  async launchConfirmation(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.automation.read");
    try {
      const result = await this.attempts.launchConfirmation(
        Object.freeze({ workspaceId, projectId }),
        sessionId,
      );
      response.setHeader(
        "ETag",
        await currentSessionEtag(this.source, workspaceId, projectId, sessionId),
      );
      return result.confirmation;
    } catch (error) {
      return mapConflict(error);
    }
  }

  @Post("attempts")
  async launch(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() raw: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 256)
      throw new BadRequestException("QA_AUTOMATION_IDEMPOTENCY_KEY_INVALID");
    const body = object(raw, "QA_AUTOMATION_LAUNCH_BODY_INVALID");
    exactKeys(body, ["confirmation"], "QA_AUTOMATION_LAUNCH_FIELD_FORBIDDEN");
    const suppliedConfirmation = confirmation(body.confirmation);
    const predecessor = requestedSessionVersion(ifMatch);
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.automation.session.plan",
    );
    assertQaAutomationHuman(authorization.actor);
    try {
      const result = await this.attempts.launch(
        Object.freeze({
          scope: Object.freeze({ workspaceId, projectId }),
          sessionId,
          idempotencyKey,
          ifMatch: predecessor.version,
          ...(predecessor.semanticHash ? { ifMatchSemanticHash: predecessor.semanticHash } : {}),
          confirmation: suppliedConfirmation,
          actor: authorization.actor,
          authorizationBasis: authorization.basis,
          authorizationBasisHash: qaAggregateSnapshotHash(authorization.basis as never),
          correlationId: crypto.randomUUID(),
          causationId: crypto.randomUUID(),
          launchedAt: new Date().toISOString(),
        }),
      );
      response.status(result.created ? 201 : 200);
      response.setHeader(
        "Location",
        `/api/v1/workspaces/${workspaceId}/projects/${projectId}/qa/automated-sessions/${sessionId}/attempts/${result.attempt.automationAttemptId}`,
      );
      response.setHeader(
        "ETag",
        await currentSessionEtag(this.source, workspaceId, projectId, sessionId),
      );
      return result.attempt;
    } catch (error) {
      return mapConflict(error);
    }
  }

  @Get("attempts")
  async list(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Res({ passthrough: true }) response?: ResponseLike,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.automation.read");
    const scope = Object.freeze({ workspaceId, projectId });
    const [attempts, operational] = await Promise.all([
      this.attempts.list(scope, sessionId),
      this.attempts.operationalHealth(scope, sessionId),
    ]);
    if (response && operational) setOperationalHeaders(response, operational);
    return attempts;
  }

  @Get("attempts/:attemptId")
  async detail(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Param("attemptId") attemptId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.automation.read");
    const value = await this.attempts.detail(
      Object.freeze({ workspaceId, projectId }),
      sessionId,
      attemptId,
    );
    if (!value) throw new NotFoundException("QA_AUTOMATION_ATTEMPT_NOT_FOUND");
    const operational = await this.attempts.attemptOperationalHealth(
      Object.freeze({ workspaceId, projectId }),
      sessionId,
      attemptId,
    );
    if (operational) setOperationalHeaders(response, operational);
    response.setHeader("ETag", `W/"${value.resourceVersion}"`);
    return value;
  }

  @Get("attempts/:attemptId/status-revisions")
  async statusHistory(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Param("attemptId") attemptId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.automation.read");
    const value = await this.attempts.statusHistory(
      Object.freeze({ workspaceId, projectId }),
      sessionId,
      attemptId,
    );
    if (!value) throw new NotFoundException("QA_AUTOMATION_ATTEMPT_NOT_FOUND");
    return value;
  }

  @Get("attempts/:attemptId/result")
  async result(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Param("attemptId") attemptId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.automation.read");
    const value = await this.attempts.result(
      Object.freeze({ workspaceId, projectId }),
      sessionId,
      attemptId,
    );
    if (!value) throw new NotFoundException("QA_AUTOMATION_ATTEMPT_RESULT_NOT_FOUND");
    return value;
  }

  @Get("attempts/:attemptId/retry-decision")
  async retryDecision(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Param("attemptId") attemptId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.automation.read");
    const value = await this.attempts.retryDecision(
      Object.freeze({ workspaceId, projectId }),
      sessionId,
      attemptId,
    );
    if (!value) throw new NotFoundException("QA_AUTOMATION_RETRY_DECISION_NOT_FOUND");
    return value;
  }

  @Get("artifacts")
  async artifacts(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
  ) {
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.automation.read",
    );
    const ceiling = authorization.classificationCeiling;
    const value = await this.attempts.sessionArtifacts(
      Object.freeze({ workspaceId, projectId }),
      sessionId,
      ceiling,
    );
    if (!value) throw new NotFoundException("QA_AUTOMATED_SESSION_NOT_FOUND");
    return value;
  }
}
