import { type JsonValue, sha256 } from "@awp/platform-contracts";

import {
  NotificationProjection,
  type NotificationProjectionCommit,
} from "./notification-projection.ts";

export class CandidateNotificationProjector {
  constructor(private readonly projection = new NotificationProjection()) {}
  project(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      candidateId: string;
      candidateVersion: number;
      sourceObservationVersion: number;
      principalId: string;
      commandId: string;
      actionIntentIds: readonly string[];
      expiresAt: Date;
      allowed: boolean;
      event: "DISCOVERED" | "UPDATED" | "REMINDER";
    }>,
  ): NotificationProjectionCommit {
    const fingerprint = sha256({
      candidateId: input.candidateId,
      candidateVersion: input.candidateVersion,
      sourceObservationVersion: input.sourceObservationVersion,
      event: input.event,
    });
    return this.projection.project({
      id: `candidate-notification:${fingerprint.slice(7, 39)}`,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      sourceEventRef: `candidate:${input.candidateId}:${input.event.toLowerCase()}`,
      sourceEventFingerprint: fingerprint,
      target: { kind: "PRINCIPAL_DM", principalId: input.principalId },
      payload: {
        templateKey: "qa.candidate",
        variables: { candidateId: input.candidateId, event: input.event },
      } as JsonValue,
      render: "qa.candidate@1",
      commandId: input.commandId,
      actionIntentIds: input.actionIntentIds,
      expiresAt: input.expiresAt,
      allowed: input.allowed,
    });
  }
}
