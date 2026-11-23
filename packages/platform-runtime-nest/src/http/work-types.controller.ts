import { Body, Controller, Param, Put } from "@nestjs/common";

import type { WorkspaceWorkTypeState, WorkTypeDefinitionPin } from "@awp/platform-core";

import { RequirePermission } from "../auth/authorize-use-case.interceptor.ts";
import { WorkspaceContextStore } from "../auth/workspace-context.ts";

export abstract class WorkTypeCommands {
  abstract change(
    workspaceId: string,
    actorId: string,
    definition: WorkTypeDefinitionPin,
    state: "ENABLED" | "DISABLED",
    reason: string,
    expectedVersion?: number,
  ): Promise<WorkspaceWorkTypeState>;
}
interface ChangeWorkTypeBody {
  readonly definition: WorkTypeDefinitionPin;
  readonly state: "ENABLED" | "DISABLED";
  readonly reason: string;
  readonly expectedVersion?: number;
}
@Controller("work-types")
export class WorkTypesController {
  constructor(
    private readonly commands: WorkTypeCommands,
    private readonly contexts: WorkspaceContextStore,
  ) {}
  @Put(":workTypeKey/enablement") @RequirePermission("work-type.manage") changeEnablement(
    @Param("workTypeKey") workTypeKey: string,
    @Body() body: ChangeWorkTypeBody,
  ) {
    if (body.definition.key !== workTypeKey) throw new Error("Work Type route/body mismatch");
    const context = this.contexts.current();
    return this.commands.change(
      context.scope.workspaceId,
      context.actor.principalId,
      body.definition,
      body.state,
      body.reason,
      body.expectedVersion,
    );
  }
}
