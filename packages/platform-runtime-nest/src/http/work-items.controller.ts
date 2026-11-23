import { Controller, Get, Param } from "@nestjs/common";

import type { WorkItem, WorkspaceContext } from "@awp/platform-core";

import { RequirePermission } from "../auth/authorize-use-case.interceptor.ts";
import { WorkspaceContextStore } from "../auth/workspace-context.ts";

export abstract class WorkItemQueries {
  abstract get(context: WorkspaceContext, id: string): Promise<WorkItem | undefined>;
}
@Controller("work-items")
export class WorkItemsController {
  constructor(
    private readonly queries: WorkItemQueries,
    private readonly contexts: WorkspaceContextStore,
  ) {}
  @Get(":id") @RequirePermission("work-item.read") getWorkItem(@Param("id") id: string) {
    return this.queries.get(this.contexts.current(), id);
  }
}
