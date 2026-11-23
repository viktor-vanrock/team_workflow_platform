import { Controller, Get, Inject, Param, Req, UseGuards } from "@nestjs/common";

import { IntakeDraftHttpGuard } from "./intake-draft-revisions.controller.ts";

export const NOTIFICATION_INTENTS_API = Symbol("NOTIFICATION_INTENTS_API");
export interface NotificationIntentsApiPort {
  get(
    scope: Readonly<{
      workspaceId: string;
      projectId: string;
      notificationIntentId: string;
      request: object;
    }>,
  ): Promise<unknown>;
}

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/notification-intents")
@UseGuards(IntakeDraftHttpGuard)
export class NotificationIntentsController {
  constructor(@Inject(NOTIFICATION_INTENTS_API) private readonly api: NotificationIntentsApiPort) {}
  @Get(":notificationIntentId") get(
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("notificationIntentId") notificationIntentId: string,
    @Req() request: object,
  ) {
    return this.api.get({ workspaceId, projectId, notificationIntentId, request });
  }
}
