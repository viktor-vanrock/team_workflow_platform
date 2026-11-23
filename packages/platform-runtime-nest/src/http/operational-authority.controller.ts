import {
  Body,
  type CanActivate,
  Controller,
  type ExecutionContext,
  Get,
  Headers,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";

export const OPERATIONAL_AUTHORITY_API = Symbol("OPERATIONAL_AUTHORITY_API");
export const OPERATIONAL_AUTHORITY_HTTP_ACCESS = Symbol("OPERATIONAL_AUTHORITY_HTTP_ACCESS");
export interface OperationalAuthorityHttpAccessPort {
  canActivate(context: ExecutionContext): Promise<boolean>;
}
@Injectable()
export class OperationalAuthorityHttpGuard implements CanActivate {
  constructor(
    @Inject(OPERATIONAL_AUTHORITY_HTTP_ACCESS)
    private readonly access: OperationalAuthorityHttpAccessPort,
  ) {}
  canActivate(context: ExecutionContext): Promise<boolean> {
    return this.access.canActivate(context);
  }
}
export interface OperationalAuthorityApiPort {
  projection(
    scope: Readonly<{
      workspaceId: string;
      projectId: string;
      workItemId: string;
      request: object;
    }>,
  ): Promise<unknown>;
  importDiagnostics(
    scope: Readonly<{ workspaceId: string; projectId: string; state?: string; request: object }>,
  ): Promise<unknown>;
  reconciliation(
    scope: Readonly<{ workspaceId: string; projectId: string; request: object }>,
    lane: string,
  ): Promise<unknown>;
  conflicts(
    scope: Readonly<{
      workspaceId: string;
      projectId: string;
      workItemId: string;
      request: object;
    }>,
  ): Promise<unknown>;
  prepareAction(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      workItemId: string;
      operation: string;
      payload: unknown;
      ifMatch: string;
      idempotencyKey: string;
      request: object;
    }>,
  ): Promise<unknown>;
  decideApproval(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      approvalId: string;
      decision: "APPROVE" | "REJECT";
      request: object;
    }>,
  ): Promise<unknown>;
}

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/operational-authority")
@UseGuards(OperationalAuthorityHttpGuard)
export class OperationalAuthorityController {
  constructor(
    @Inject(OPERATIONAL_AUTHORITY_API) private readonly api: OperationalAuthorityApiPort,
  ) {}
  @Get("work-items/:workItemId/projection") projection(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Req() request: object,
  ) {
    return this.api.projection({ workspaceId, projectId, workItemId, request });
  }
  @Get("work-items/:workItemId/conflicts") conflicts(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Req() request: object,
  ) {
    return this.api.conflicts({ workspaceId, projectId, workItemId, request });
  }
  @Get("imports") imports(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Req() request: object,
    @Query("state") state?: string,
  ) {
    return this.api.importDiagnostics({
      workspaceId,
      projectId,
      request,
      ...(state ? { state } : {}),
    });
  }
  @Post("reconciliation/:lane") reconciliation(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("lane") lane: string,
    @Req() request: object,
  ) {
    return this.api.reconciliation({ workspaceId, projectId, request }, lane);
  }
  @Post("approvals/:approvalId/decision") @HttpCode(200) approval(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("approvalId") approvalId: string,
    @Body() body: Readonly<{ decision?: unknown }>,
    @Req() request: object,
  ) {
    if (body.decision !== "APPROVE" && body.decision !== "REJECT")
      throw new Error("APPROVAL_DECISION_INVALID");
    return this.api.decideApproval({
      workspaceId,
      projectId,
      approvalId,
      decision: body.decision,
      request,
    });
  }
  @Post("work-items/:workItemId/actions/:operation") @HttpCode(202) action(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("operation") operation: string,
    @Body() payload: unknown,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: object,
  ) {
    if (
      !new Set([
        "request.transition",
        "request.assign",
        "request.set-priority",
        "request.set-due-date",
      ]).has(operation)
    )
      throw new Error("OPERATIONAL_ACTION_UNSUPPORTED");
    if (!ifMatch) throw new Error("IF_MATCH_REQUIRED");
    if (!idempotencyKey) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
    return this.api.prepareAction({
      workspaceId,
      projectId,
      workItemId,
      operation,
      payload,
      ifMatch,
      idempotencyKey,
      request,
    });
  }
}
