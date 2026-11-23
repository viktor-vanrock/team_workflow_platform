import {
  Body,
  type CanActivate,
  Controller,
  type ExecutionContext,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";

export const INTAKE_DRAFT_REVISIONS_API = Symbol("INTAKE_DRAFT_REVISIONS_API");
export const INTAKE_DRAFT_HTTP_ACCESS = Symbol("INTAKE_DRAFT_HTTP_ACCESS");
export interface IntakeDraftRevisionApiPort {
  list(
    scope: Readonly<{ workspaceId: string; projectId: string; draftId: string; request: object }>,
  ): Promise<unknown>;
  revise(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      draftId: string;
      request: object;
      body: unknown;
    }>,
  ): Promise<unknown>;
  validate(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      draftId: string;
      request: object;
      body: unknown;
    }>,
  ): Promise<unknown>;
}
@Injectable()
export class IntakeDraftHttpGuard implements CanActivate {
  constructor(@Inject(INTAKE_DRAFT_HTTP_ACCESS) private readonly access: CanActivate) {}
  canActivate(context: ExecutionContext) {
    return this.access.canActivate(context);
  }
}

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/intake-drafts/:draftId")
@UseGuards(IntakeDraftHttpGuard)
export class IntakeDraftRevisionsController {
  constructor(
    @Inject(INTAKE_DRAFT_REVISIONS_API) private readonly api: IntakeDraftRevisionApiPort,
  ) {}
  @Get("revisions") list(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @Req() request: object,
  ) {
    return this.api.list({ workspaceId, projectId, draftId, request });
  }
  @Post("revisions") @HttpCode(201) revise(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @Body() body: unknown,
    @Req() request: object,
  ) {
    return this.api.revise({ workspaceId, projectId, draftId, request, body });
  }
  @Post("commands/validate") @HttpCode(200) validate(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @Body() body: unknown,
    @Req() request: object,
  ) {
    return this.api.validate({ workspaceId, projectId, draftId, request, body });
  }
}
