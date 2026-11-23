import { type JsonValue, sha256 } from "@awp/platform-contracts";

import {
  NotificationProjection,
  type NotificationProjectionCommit,
} from "./notification-projection.ts";

export class MattermostIntakeNotificationProjector {
  constructor(private readonly projection = new NotificationProjection()) {}
  confirmed(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      draftId: string;
      confirmationVersion: number;
      principalId: string;
      workItemId: string;
      commandId: string;
      expiresAt: Date;
      allowed: boolean;
    }>,
  ): NotificationProjectionCommit {
    const fingerprint = sha256({
      draftId: input.draftId,
      confirmationVersion: input.confirmationVersion,
      workItemId: input.workItemId,
    });
    return this.projection.project({
      id: `notification:${fingerprint.slice(7, 39)}`,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      sourceEventRef: `draft:${input.draftId}:confirmed:${input.confirmationVersion}`,
      sourceEventFingerprint: fingerprint,
      target: { kind: "PRINCIPAL_DM", principalId: input.principalId },
      payload: {
        templateKey: "qa.intake.confirmed",
        variables: { draftId: input.draftId, workItemId: input.workItemId },
      } as JsonValue,
      render: "qa.intake.confirmed@1",
      commandId: input.commandId,
      actionIntentIds: [],
      expiresAt: input.expiresAt,
      allowed: input.allowed,
    });
  }
}
