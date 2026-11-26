import { Controller, Get, Inject, Param, Req, Res, UseGuards } from "@nestjs/common";
import type { DataSource } from "typeorm";
import { TypeOrmGitLabAutomationAttemptQuery } from "@awp/runtime-composition";
import { QA_DATA_SOURCE, QaSessionGuard, type QaSessionRequest } from "../qa-api-authorization.ts";
import { QaAutomationAttemptsController } from "./qa-automation-attempts.controller.ts";

type Response = { setHeader(name: string, value: string): void; status(code: number): Response };

/** Exposes existing read projections only; no launch route or local execution adapter. */
@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/qa/automated-sessions/:sessionId")
@UseGuards(QaSessionGuard)
export class CorporateAutomationReadController {
  private readonly reads: QaAutomationAttemptsController;
  constructor(@Inject(QA_DATA_SOURCE) source: DataSource) {
    this.reads = new QaAutomationAttemptsController(
      source,
      new TypeOrmGitLabAutomationAttemptQuery(source),
    );
  }

  @Get("attempts")
  async list(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return await this.reads.list(request, workspaceId, projectId, sessionId, response);
  }

  @Get("attempts/:attemptId")
  async detail(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Param("attemptId") attemptId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return await this.reads.detail(request, workspaceId, projectId, sessionId, attemptId, response);
  }

  @Get("attempts/:attemptId/status-revisions")
  async statusHistory(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Param("attemptId") attemptId: string,
  ) {
    return await this.reads.statusHistory(request, workspaceId, projectId, sessionId, attemptId);
  }

  @Get("attempts/:attemptId/result")
  async result(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Param("attemptId") attemptId: string,
  ) {
    return await this.reads.result(request, workspaceId, projectId, sessionId, attemptId);
  }

  @Get("attempts/:attemptId/retry-decision")
  async retryDecision(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Param("attemptId") attemptId: string,
  ) {
    return await this.reads.retryDecision(request, workspaceId, projectId, sessionId, attemptId);
  }

  @Get("artifacts")
  async artifacts(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
  ) {
    return await this.reads.artifacts(request, workspaceId, projectId, sessionId);
  }
}
