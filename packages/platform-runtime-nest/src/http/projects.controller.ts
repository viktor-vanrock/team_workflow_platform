import { Controller, Get } from "@nestjs/common";

import type { Project } from "@awp/platform-core";

import { RequirePermission } from "../auth/authorize-use-case.interceptor.ts";
import { WorkspaceContextStore } from "../auth/workspace-context.ts";

export abstract class VisibleProjectQueries {
  abstract list(workspaceId: string, principalId: string): Promise<readonly Project[]>;
}
@Controller("projects")
export class ProjectsController {
  constructor(
    private readonly queries: VisibleProjectQueries,
    private readonly contexts: WorkspaceContextStore,
  ) {}
  @Get() @RequirePermission("project.list-visible") listVisibleProjects() {
    const context = this.contexts.current();
    return this.queries.list(context.scope.workspaceId, context.actor.principalId);
  }
}
