import { Body, Controller, Get, Param, Post } from "@nestjs/common";

import type { IntakeDraft, SchemaBoundValue, WorkItem, WorkspaceContext } from "@awp/platform-core";

import { RequirePermission } from "../auth/authorize-use-case.interceptor.ts";
import { WorkspaceContextStore } from "../auth/workspace-context.ts";

export abstract class IntakeDraftUseCases {
  abstract create(
    context: WorkspaceContext,
    workTypeKey: string,
    payload: SchemaBoundValue,
  ): Promise<IntakeDraft>;
  abstract get(context: WorkspaceContext, id: string): Promise<IntakeDraft | undefined>;
  abstract submit(
    context: WorkspaceContext,
    id: string,
    expectedVersion: number,
  ): Promise<WorkItem>;
}
@Controller("intake-drafts")
export class IntakeDraftsController {
  constructor(
    private readonly useCases: IntakeDraftUseCases,
    private readonly contexts: WorkspaceContextStore,
  ) {}
  @Post() @RequirePermission("intake.create") createIntakeDraft(
    @Body() body: { readonly workTypeKey: string; readonly payload: SchemaBoundValue },
  ) {
    return this.useCases.create(this.contexts.current(), body.workTypeKey, body.payload);
  }
  @Get(":id") @RequirePermission("intake.read") getIntakeDraft(@Param("id") id: string) {
    return this.useCases.get(this.contexts.current(), id);
  }
  @Post(":id/submit") @RequirePermission("intake.submit") submitIntakeDraft(
    @Param("id") id: string,
    @Body() body: { readonly expectedVersion: number },
  ) {
    return this.useCases.submit(this.contexts.current(), id, body.expectedVersion);
  }
}
