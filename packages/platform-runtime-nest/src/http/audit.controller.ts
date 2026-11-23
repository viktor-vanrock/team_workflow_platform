import { Controller, Get, Query } from "@nestjs/common";

import {
  type AppendOnlyAuditPort,
  type AuditEvent,
  scopeEquals,
  type WorkspaceContext,
} from "@awp/platform-core";

import { RequirePermission } from "../auth/authorize-use-case.interceptor.ts";
import { WorkspaceContextStore } from "../auth/workspace-context.ts";

export type AuditQueryFilter = Readonly<{ correlationId?: string; action?: string }>;

export abstract class AuditQueryApplication {
  abstract project(
    context: WorkspaceContext,
    filter: AuditQueryFilter,
  ): Promise<readonly AuditEvent[]>;
  abstract workspaceSecurity(
    context: WorkspaceContext,
    filter: AuditQueryFilter,
  ): Promise<readonly AuditEvent[]>;
}

export class ScopedAuditQueryApplication extends AuditQueryApplication {
  constructor(private readonly audit: AppendOnlyAuditPort) {
    super();
  }

  async project(
    context: WorkspaceContext,
    filter: AuditQueryFilter,
  ): Promise<readonly AuditEvent[]> {
    if (context.scope.kind !== "PROJECT") throw new Error("PROJECT_SCOPE_REQUIRED");
    const events = await this.audit.query(context.scope, filter);
    if (events.some((event) => !scopeEquals(event.scope, context.scope)))
      throw new Error("AUDIT_SCOPE_CORRUPTION");
    return events;
  }

  async workspaceSecurity(
    context: WorkspaceContext,
    filter: AuditQueryFilter,
  ): Promise<readonly AuditEvent[]> {
    if (context.scope.kind !== "WORKSPACE") throw new Error("WORKSPACE_SCOPE_REQUIRED");
    const events = await this.audit.query(context.scope, filter);
    for (const event of events) {
      if (!scopeEquals(event.scope, context.scope)) throw new Error("AUDIT_SCOPE_CORRUPTION");
      if (event.actor.kind !== "SERVICE" || event.authorizationBasis !== undefined)
        throw new Error("WORKSPACE_SECURITY_AUDIT_BASIS_INVALID");
    }
    return events;
  }
}

@Controller("audit")
export class AuditController {
  constructor(
    private readonly application: AuditQueryApplication,
    private readonly contexts: WorkspaceContextStore,
  ) {}

  @Get("project")
  @RequirePermission("audit.project.read")
  project(@Query("correlationId") correlationId?: string, @Query("action") action?: string) {
    const context = this.contexts.current();
    if (context.scope.kind !== "PROJECT") throw new Error("PROJECT_SCOPE_REQUIRED");
    return this.application.project(context, {
      ...(correlationId ? { correlationId } : {}),
      ...(action ? { action } : {}),
    });
  }

  @Get("workspace-security")
  @RequirePermission("audit.workspace-security.read")
  workspace(@Query("correlationId") correlationId?: string, @Query("action") action?: string) {
    const context = this.contexts.current();
    if (context.scope.kind !== "WORKSPACE") throw new Error("WORKSPACE_SCOPE_REQUIRED");
    return this.application.workspaceSecurity(context, {
      ...(correlationId ? { correlationId } : {}),
      ...(action ? { action } : {}),
    });
  }
}
