import {
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import type { DataSource } from "typeorm";

import {
  authorizeQaApi,
  QA_DATA_SOURCE,
  QaSessionGuard,
  type QaSessionRequest,
} from "../qa-api-authorization.ts";

const unavailable = () =>
  new ServiceUnavailableException("Недоступно: нет подтверждений runner, network и no-deploy");

/** Corporate Suite checks stay closed until their evidence is implemented. */
@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/qa/automation")
@UseGuards(QaSessionGuard)
export class CorporateSuiteClosedController {
  constructor(@Inject(QA_DATA_SOURCE) private readonly source: DataSource) {}

  @Get("availability")
  async availability(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.automation.read");
    throw unavailable();
  }

  @Post("suite-bindings/:bindingId/versions/:version/validate")
  async validate(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
  ) {
    await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.automation.suite.manage",
    );
    throw unavailable();
  }

  @Post("suite-bindings/:bindingId/versions/:version/publish")
  async publish(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
  ) {
    await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.automation.suite.manage",
    );
    throw unavailable();
  }
}
