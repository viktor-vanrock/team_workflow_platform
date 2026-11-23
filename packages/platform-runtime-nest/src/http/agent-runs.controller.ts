import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";

import { IntakeDraftHttpGuard } from "./intake-draft-revisions.controller.ts";

export const AGENT_RUNS_API = Symbol("AGENT_RUNS_API");
export interface AgentRunsApiPort {
  start(
    input: Readonly<{ workspaceId: string; projectId: string; request: object; body: unknown }>,
  ): Promise<unknown>;
  get(
    input: Readonly<{ workspaceId: string; projectId: string; runId: string; request: object }>,
  ): Promise<unknown>;
}
@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/agent-runs")
@UseGuards(IntakeDraftHttpGuard)
export class AgentRunsController {
  constructor(@Inject(AGENT_RUNS_API) private readonly api: AgentRunsApiPort) {}
  @Post() @HttpCode(202) start(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Req() request: object,
  ) {
    return this.api.start({ workspaceId, projectId, request, body });
  }
  @Get(":runId") get(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("runId") runId: string,
    @Req() request: object,
  ) {
    return this.api.get({ workspaceId, projectId, runId, request });
  }
}
