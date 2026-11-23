import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from "@nestjs/common";

import {
  type QueueHttpAuthority,
  type QueueRuntimeResponse,
  RuntimePortfolioQueueApi,
  RuntimeQueueApi,
} from "@awp/runtime-composition";

import { PublishedOnboardingProblemFilter } from "../onboarding/published-http.ts";
import { QA_DATA_SOURCE, QaSessionGuard, type QaSessionRequest } from "../qa-api-authorization.ts";
import { QUEUE_HTTP_AUTHORITY } from "./queue-http-authority.ts";

type QueueDataSource = ConstructorParameters<typeof RuntimeQueueApi>[0];

function mapQueueError(error: unknown): never {
  const code = error instanceof Error ? error.message : "QUEUE_REQUEST_FAILED";
  if (code === "QUEUE_CURSOR_CONFLICT") throw new ConflictException(code);
  if (code === "QUEUE_CURSOR_INVALID" || code === "QUEUE_CURSOR_TOO_LARGE")
    throw new BadRequestException(code);
  if (
    code === "QUEUE_PROJECT_NOT_FOUND" ||
    code === "QUEUE_ITEM_NOT_FOUND" ||
    code === "CAPACITY_PROJECTION_NOT_FOUND"
  ) {
    throw new NotFoundException(code);
  }
  if (
    code === "QA_IDENTITY_REQUIRED" ||
    code === "QA_PERMISSION_DENIED" ||
    code === "QA_SCOPE_DENIED"
  ) {
    throw new ForbiddenException(code);
  }
  throw error;
}

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/qa/queue")
@UseGuards(QaSessionGuard)
@UseFilters(PublishedOnboardingProblemFilter)
export class QueueController {
  private readonly runtime: RuntimeQueueApi;

  constructor(
    @Inject(QA_DATA_SOURCE) source: QueueDataSource,
    @Inject(QUEUE_HTTP_AUTHORITY) authority: QueueHttpAuthority,
  ) {
    this.runtime = new RuntimeQueueApi(source, authority);
  }

  @Get()
  async lane(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Query("stage") stage: string | undefined,
    @Query("serviceClass") serviceClass: string | undefined,
    @Query("freshness") freshness: string | undefined,
    @Query("pageSize") rawPageSize: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Res({ passthrough: true }) response: QueueRuntimeResponse,
  ) {
    try {
      return await this.runtime.lane(
        request,
        workspaceId,
        projectId,
        stage,
        serviceClass,
        freshness,
        rawPageSize,
        cursor,
        response,
      );
    } catch (error) {
      mapQueueError(error);
    }
  }

  @Get("items/:workItemId")
  async item(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Res({ passthrough: true }) response: QueueRuntimeResponse,
  ) {
    try {
      return await this.runtime.item(request, workspaceId, projectId, workItemId, response);
    } catch (error) {
      mapQueueError(error);
    }
  }

  @Get("items/:workItemId/sla")
  async sla(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Res({ passthrough: true }) response: QueueRuntimeResponse,
  ) {
    try {
      return await this.runtime.sla(request, workspaceId, projectId, workItemId, response);
    } catch (error) {
      mapQueueError(error);
    }
  }

  @Get("capacity")
  async capacity(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Res({ passthrough: true }) response: QueueRuntimeResponse,
  ) {
    try {
      return await this.runtime.capacity(request, workspaceId, projectId, response);
    } catch (error) {
      mapQueueError(error);
    }
  }
}

@Controller("api/v1/workspaces/:workspaceId/qa/queue")
@UseGuards(QaSessionGuard)
@UseFilters(PublishedOnboardingProblemFilter)
export class PortfolioQueueController {
  private readonly runtime: RuntimePortfolioQueueApi;

  constructor(
    @Inject(QA_DATA_SOURCE) source: QueueDataSource,
    @Inject(QUEUE_HTTP_AUTHORITY) authority: QueueHttpAuthority,
  ) {
    this.runtime = new RuntimePortfolioQueueApi(source, authority);
  }

  @Get()
  async portfolio(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Query("stage") stage: string | undefined,
    @Query("serviceClass") serviceClass: string | undefined,
    @Query("freshness") freshness: string | undefined,
    @Query("pageSize") rawPageSize: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Res({ passthrough: true }) response: QueueRuntimeResponse,
  ) {
    try {
      return await this.runtime.portfolio(
        request,
        workspaceId,
        stage,
        serviceClass,
        freshness,
        rawPageSize,
        cursor,
        response,
      );
    } catch (error) {
      mapQueueError(error);
    }
  }

  @Get("capacity")
  async capacity(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Res({ passthrough: true }) response: QueueRuntimeResponse,
  ) {
    try {
      return await this.runtime.capacity(request, workspaceId, response);
    } catch (error) {
      mapQueueError(error);
    }
  }
}
