import {
  Body,
  type CanActivate,
  Controller,
  type ExecutionContext,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";

export const APPROVALS_V11_API = Symbol("APPROVALS_V11_API");
export const APPROVALS_V11_HTTP_ACCESS = Symbol("APPROVALS_V11_HTTP_ACCESS");

export interface ApprovalsV11HttpAccessPort {
  canActivate(context: ExecutionContext): Promise<boolean>;
}

@Injectable()
export class ApprovalsV11HttpGuard implements CanActivate {
  constructor(
    @Inject(APPROVALS_V11_HTTP_ACCESS) private readonly access: ApprovalsV11HttpAccessPort,
  ) {}
  canActivate(context: ExecutionContext): Promise<boolean> {
    return this.access.canActivate(context);
  }
}

export type ApprovalsV11Request = object;

export interface ApprovalsV11ApiPort {
  get(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      approvalId: string;
      request: ApprovalsV11Request;
    }>,
  ): Promise<unknown>;
  decide(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      approvalId: string;
      request: ApprovalsV11Request;
      decision: "APPROVE" | "REJECT";
    }>,
  ): Promise<unknown>;
}

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/approvals")
@UseGuards(ApprovalsV11HttpGuard)
export class ApprovalsV11Controller {
  constructor(@Inject(APPROVALS_V11_API) private readonly api: ApprovalsV11ApiPort) {}

  @Get(":approvalId")
  async get(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("approvalId") approvalId: string,
    @Req() request: ApprovalsV11Request,
  ) {
    const value = await this.api.get({ workspaceId, projectId, approvalId, request });
    if (!value) throw new NotFoundException("APPROVAL_NOT_FOUND");
    return value;
  }

  @Post(":approvalId/decisions")
  @HttpCode(200)
  async decide(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("approvalId") approvalId: string,
    @Body() body: Readonly<{ decision?: unknown }>,
    @Req() request: ApprovalsV11Request,
  ) {
    if (body.decision !== "APPROVE" && body.decision !== "REJECT") {
      throw new NotFoundException("APPROVAL_NOT_FOUND");
    }
    const value = await this.api.decide({
      workspaceId,
      projectId,
      approvalId,
      request,
      decision: body.decision,
    });
    if (!value) throw new NotFoundException("APPROVAL_NOT_FOUND");
    return value;
  }
}
