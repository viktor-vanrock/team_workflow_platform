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

export const INTAKE_CANDIDATES_API = Symbol("INTAKE_CANDIDATES_API");
export interface IntakeCandidatesApiPort {
  list(
    scope: Readonly<{ workspaceId: string; projectId: string; request: object }>,
  ): Promise<unknown>;
  get(
    scope: Readonly<{
      workspaceId: string;
      projectId: string;
      candidateId: string;
      request: object;
    }>,
  ): Promise<unknown>;
  decide(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      candidateId: string;
      request: object;
      body: unknown;
    }>,
  ): Promise<unknown>;
}

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/intake-candidates")
@UseGuards(IntakeDraftHttpGuard)
export class IntakeCandidatesController {
  constructor(@Inject(INTAKE_CANDIDATES_API) private readonly api: IntakeCandidatesApiPort) {}
  @Get() list(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Req() request: object,
  ) {
    return this.api.list({ workspaceId, projectId, request });
  }
  @Get(":candidateId") get(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("candidateId") candidateId: string,
    @Req() request: object,
  ) {
    return this.api.get({ workspaceId, projectId, candidateId, request });
  }
  @Post(":candidateId/decisions") @HttpCode(200) decide(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("candidateId") candidateId: string,
    @Body() body: unknown,
    @Req() request: object,
  ) {
    return this.api.decide({ workspaceId, projectId, candidateId, request, body });
  }
}
