import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";

import {
  type QueueControlCommandBody,
  type QueueHttpAuthority,
  type QueueMutableRuntimeResponse,
  type QueueOrderCommandBody,
  RuntimeQueueControlsApi,
} from "@awp/runtime-composition";

import { QA_DATA_SOURCE, QaSessionGuard, type QaSessionRequest } from "../qa-api-authorization.ts";
import { QUEUE_HTTP_AUTHORITY } from "./queue-http-authority.ts";

type QueueControlDataSource = ConstructorParameters<typeof RuntimeQueueControlsApi>[0];

function mapControlError(error: unknown): never {
  const code = error instanceof Error ? error.message : "QUEUE_CONTROL_REQUEST_FAILED";
  if (
    code === "QA_IDENTITY_REQUIRED" ||
    code === "QA_PERMISSION_DENIED" ||
    code === "QA_SCOPE_DENIED"
  ) {
    throw new ForbiddenException(code);
  }
  throw error;
}

@Controller()
@UseGuards(QaSessionGuard)
export class QueueControlsController {
  private readonly runtime: RuntimeQueueControlsApi;

  constructor(
    @Inject(QA_DATA_SOURCE) source: QueueControlDataSource,
    @Inject(QUEUE_HTTP_AUTHORITY) authority: QueueHttpAuthority,
  ) {
    this.runtime = new RuntimeQueueControlsApi(source, authority);
  }

  @Post("api/v1/workspaces/:workspaceId/projects/:projectId/qa/queue/items/:workItemId/controls")
  async control(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Headers("idempotency-key") requestKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: QueueControlCommandBody,
    @Res({ passthrough: true }) response: QueueMutableRuntimeResponse,
  ) {
    try {
      return await this.runtime.control(
        request,
        workspaceId,
        projectId,
        workItemId,
        requestKey,
        ifMatch,
        body,
        response,
      );
    } catch (error) {
      mapControlError(error);
    }
  }

  @Post("api/v1/workspaces/:workspaceId/projects/:projectId/qa/queue/order-overrides")
  async projectOrder(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Headers("idempotency-key") requestKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: QueueOrderCommandBody,
    @Res({ passthrough: true }) response: QueueMutableRuntimeResponse,
  ) {
    try {
      return await this.runtime.projectOrder(
        request,
        workspaceId,
        projectId,
        requestKey,
        ifMatch,
        body,
        response,
      );
    } catch (error) {
      mapControlError(error);
    }
  }

  @Post("api/v1/workspaces/:workspaceId/qa/queue/order-overrides")
  async portfolioOrder(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Headers("idempotency-key") requestKey: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: QueueOrderCommandBody,
    @Res({ passthrough: true }) response: QueueMutableRuntimeResponse,
  ) {
    try {
      return await this.runtime.portfolioOrder(
        request,
        workspaceId,
        requestKey,
        ifMatch,
        body,
        response,
      );
    } catch (error) {
      mapControlError(error);
    }
  }
}
