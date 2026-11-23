import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { DataSource } from "typeorm";

import {
  qaAggregateSnapshotHash,
  type QaAuthorizationBasis,
  type QaHumanActor,
  type QaScope,
} from "@awp/competency-qa/node";

import {
  authorizeQaApi,
  QA_DATA_SOURCE,
  QaSessionGuard,
  type QaSessionRequest,
} from "../qa-api-authorization.ts";
import {
  assertQaAutomationHuman,
  validateCreateAutomationSuiteBody,
} from "./qa-automation-security.ts";

export const QA_AUTOMATION_SUITE_API = Symbol("QA_AUTOMATION_SUITE_API");
export interface QaAutomationSuiteApiPort {
  list(scope: QaScope): Promise<unknown>;
  create(
    input: Readonly<{
      scope: QaScope;
      actor: QaHumanActor;
      body: Readonly<Record<string, unknown>>;
      requestKey: string;
    }>,
  ): Promise<unknown>;
  enqueueValidation(
    input: Readonly<{
      scope: QaScope;
      actor: QaHumanActor;
      authorizationBasis: QaAuthorizationBasis;
      authorizationBasisHash: string;
      bindingId: string;
      version: number;
      requestKey: string;
    }>,
  ): Promise<unknown>;
  reports(scope: QaScope, bindingId: string, version: number): Promise<unknown>;
  publish(
    input: Readonly<{
      scope: QaScope;
      actor: QaHumanActor;
      bindingId: string;
      version: number;
      expectedResourceVersion: number;
    }>,
  ): Promise<unknown>;
}

function version(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error("QA_AUTOMATION_SUITE_VERSION_INVALID");
  return parsed;
}

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/qa/automation/suite-bindings")
@UseGuards(QaSessionGuard)
export class QaAutomationSuiteBindingsController {
  constructor(
    @Inject(QA_DATA_SOURCE) private readonly source: DataSource,
    @Inject(QA_AUTOMATION_SUITE_API) private readonly suites: QaAutomationSuiteApiPort,
  ) {}

  @Get()
  async list(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.automation.read");
    return await this.suites.list(Object.freeze({ workspaceId, projectId }));
  }

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
      "qa.automation.suite.manage",
    );
    assertQaAutomationHuman(authorization.actor);
    const body = validateCreateAutomationSuiteBody(raw);
    return await this.suites.create({
      scope: Object.freeze({ workspaceId, projectId }),
      actor: authorization.actor,
      body,
      requestKey,
    });
  }

  @Post(":bindingId/versions/:version/validate")
  @HttpCode(202)
  async validate(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("bindingId") bindingId: string,
    @Param("version") rawVersion: string,
    @Headers("idempotency-key") requestKey: string,
  ) {
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.automation.suite.manage",
    );
    return await this.suites.enqueueValidation({
      scope: Object.freeze({ workspaceId, projectId }),
      actor: authorization.actor,
      authorizationBasis: authorization.basis,
      authorizationBasisHash: qaAggregateSnapshotHash(authorization.basis as never),
      bindingId,
      version: version(rawVersion),
      requestKey,
    });
  }

  @Get(":bindingId/versions/:version/validation-reports")
  async reports(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("bindingId") bindingId: string,
    @Param("version") rawVersion: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.automation.read");
    return await this.suites.reports(
      Object.freeze({ workspaceId, projectId }),
      bindingId,
      version(rawVersion),
    );
  }

  @Post(":bindingId/versions/:version/publish")
  async publish(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("bindingId") bindingId: string,
    @Param("version") rawVersion: string,
    @Headers("if-match") ifMatch: string,
  ) {
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.automation.suite.manage",
    );
    assertQaAutomationHuman(authorization.actor);
    const expectedResourceVersion = Number(ifMatch?.match(/[1-9][0-9]*/u)?.[0]);
    if (!Number.isInteger(expectedResourceVersion))
      throw new Error("QA_AUTOMATION_SUITE_IF_MATCH_REQUIRED");
    return await this.suites.publish({
      scope: Object.freeze({ workspaceId, projectId }),
      actor: authorization.actor,
      bindingId,
      version: version(rawVersion),
      expectedResourceVersion,
    });
  }
}
