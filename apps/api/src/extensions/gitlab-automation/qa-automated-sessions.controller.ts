import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import type { DataSource } from "typeorm";

import { qaAggregateSnapshotHash } from "@awp/competency-qa/node";

import { PublishedOnboardingProblemFilter } from "../onboarding/published-http.ts";
import { assertOnboardingAutomationMode } from "../onboarding/session-facts.ts";
import {
  authorizeQaApi,
  QA_DATA_SOURCE,
  QaSessionGuard,
  type QaSessionRequest,
} from "../qa-api-authorization.ts";
import {
  assertQaAutomationHuman,
  validateCreateAutomatedSessionBody,
} from "./qa-automation-security.ts";

export const QA_AUTOMATED_SESSIONS_API = Symbol("QA_AUTOMATED_SESSIONS_API");
export interface QaAutomatedSessionsApiPort {
  create(input: Readonly<Record<string, unknown>>): Promise<unknown>;
  get(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    sessionId: string,
  ): Promise<unknown>;
}

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/qa/automated-sessions")
@UseGuards(QaSessionGuard)
@UseFilters(PublishedOnboardingProblemFilter)
export class QaAutomatedSessionsController {
  constructor(
    @Inject(QA_DATA_SOURCE) private readonly source: DataSource,
    @Inject(QA_AUTOMATED_SESSIONS_API) private readonly sessions: QaAutomatedSessionsApiPort,
  ) {}

  @Post()
  async create(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers("idempotency-key") requestKey: string,
    @Body() raw: unknown,
  ) {
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.automation.session.plan",
    );
    assertQaAutomationHuman(authorization.actor);
    const body = validateCreateAutomatedSessionBody(raw);
    await assertOnboardingAutomationMode(this.source, { workspaceId, projectId });
    return await this.sessions.create(
      Object.freeze({
        workspaceId,
        projectId,
        actor: authorization.actor,
        authorizationBasis: authorization.basis,
        authorizationBasisHash: qaAggregateSnapshotHash(authorization.basis as never),
        requestKey,
        correlationId: crypto.randomUUID(),
        causationId: crypto.randomUUID(),
        body,
      }),
    );
  }

  @Get(":sessionId")
  async get(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.automation.read");
    return await this.sessions.get(Object.freeze({ workspaceId, projectId }), sessionId);
  }
}
