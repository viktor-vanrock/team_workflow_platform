import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";

import type { DocumentAction } from "@awp/competency-tech-writing";

import { reject } from "../extensions/onboarding/durable-http.ts";
import { LocalSessionGuard, type LocalSessionRequest } from "./local-session.guard.ts";
import { TechWritingService } from "./tech-writing.service.ts";

@Controller("workspaces/:workspaceId/projects/:projectId/documentation")
@UseGuards(LocalSessionGuard)
export class TechWritingController {
  constructor(@Inject(TechWritingService) private readonly service: TechWritingService) {}
  @Get()
  list(
    @Req() request: LocalSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
  ) {
    return this.service.list(request, { workspaceId, projectId });
  }
  @Get(":id")
  get(
    @Req() request: LocalSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("id") id: string,
  ) {
    return this.service.get(request, { workspaceId, projectId }, id);
  }
  @Post()
  create(
    @Req() request: LocalSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.create(request, { workspaceId, projectId }, body, key);
  }
  @Post(":id/:action")
  act(
    @Req() request: LocalSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @Param("action") action: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string,
    @Headers("if-match") version: string | undefined,
  ) {
    if (!["save", "submit", "return", "approve"].includes(action))
      return reject("DOC_ACTION_UNKNOWN", 404);
    return this.service.act(
      request,
      { workspaceId, projectId },
      id,
      action as DocumentAction,
      body,
      key,
      version,
    );
  }
}
