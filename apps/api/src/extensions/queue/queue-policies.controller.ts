import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";

import {
  type QueueHttpAuthority,
  type QueueRuntimeResponse,
  RuntimeQueuePoliciesApi,
} from "@awp/runtime-composition";

import { QA_DATA_SOURCE, QaSessionGuard, type QaSessionRequest } from "../qa-api-authorization.ts";
import { QUEUE_HTTP_AUTHORITY } from "./queue-http-authority.ts";

type QueuePolicyDataSource = ConstructorParameters<typeof RuntimeQueuePoliciesApi>[0];

function mapPolicyError(error: unknown): never {
  const code = error instanceof Error ? error.message : "QUEUE_POLICY_REQUEST_FAILED";
  if (
    code === "QA_IDENTITY_REQUIRED" ||
    code === "QA_PERMISSION_DENIED" ||
    code === "QA_SCOPE_DENIED"
  ) {
    throw new ForbiddenException(code);
  }
  if (code === "QUEUE_POLICY_NOT_CONFIGURED" || code === "BUSINESS_CALENDAR_NOT_FOUND") {
    throw new NotFoundException(code);
  }
  throw error;
}

@Controller("api/v1/workspaces/:workspaceId/qa/queue")
@UseGuards(QaSessionGuard)
export class QueuePoliciesController {
  private readonly runtime: RuntimeQueuePoliciesApi;

  constructor(
    @Inject(QA_DATA_SOURCE) source: QueuePolicyDataSource,
    @Inject(QUEUE_HTTP_AUTHORITY) authority: QueueHttpAuthority,
  ) {
    this.runtime = new RuntimeQueuePoliciesApi(source, authority);
  }

  @Get("policy")
  async policy(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Res({ passthrough: true }) response: QueueRuntimeResponse,
  ) {
    try {
      return await this.runtime.policy(request, workspaceId, response);
    } catch (error) {
      mapPolicyError(error);
    }
  }

  @Get("calendars/:calendarRevisionId")
  async calendar(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("calendarRevisionId") calendarRevisionId: string,
    @Res({ passthrough: true }) response: QueueRuntimeResponse,
  ) {
    try {
      return await this.runtime.calendar(request, workspaceId, calendarRevisionId, response);
    } catch (error) {
      mapPolicyError(error);
    }
  }
}
