import type { MessagingLogicalTarget } from "@awp/connector-sdk";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import { NotificationIntentAggregate, type NotificationIntentSnapshot } from "@awp/platform-core";

export interface NotificationProjectionRequest {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly sourceEventRef: string;
  readonly sourceEventFingerprint: string;
  readonly target: MessagingLogicalTarget;
  readonly payload: JsonValue;
  readonly render: string;
  readonly commandId: string;
  readonly actionIntentIds: readonly string[];
  readonly expiresAt: Date;
  readonly allowed: boolean;
}

export interface NotificationProjectionCommit {
  readonly denied: boolean;
  readonly reasonCode?: string;
  readonly intent?: NotificationIntentSnapshot;
  readonly actionIntentIds: readonly string[];
  readonly auditHash: string;
  readonly sourceFingerprintHash?: string;
  readonly deliveryHealthEventRef?: string;
}

export class NotificationProjection {
  readonly #commits = new Map<string, NotificationProjectionCommit>();
  project(request: NotificationProjectionRequest): NotificationProjectionCommit {
    const dedupeKey = `${request.workspaceId}:${request.projectId}:${request.sourceEventFingerprint}`;
    const existing = this.#commits.get(dedupeKey);
    if (existing) return structuredClone(existing);
    if (!request.allowed) {
      const denied = Object.freeze({
        denied: true,
        reasonCode: "NOTIFICATION_POLICY_DENIED",
        actionIntentIds: Object.freeze([]),
        auditHash: sha256({ dedupeKey, decision: "DENIED" }),
        sourceFingerprintHash: sha256(request.sourceEventFingerprint),
        deliveryHealthEventRef: `notification-health:${request.id}:denied`,
      });
      this.#commits.set(dedupeKey, denied);
      return structuredClone(denied);
    }
    if (
      request.actionIntentIds.length > 8 ||
      new Set(request.actionIntentIds).size !== request.actionIntentIds.length
    )
      throw new Error("NOTIFICATION_ACTION_SET_INVALID");
    const aggregate = NotificationIntentAggregate.create({
      id: request.id,
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      dedupeKey,
      sourceEventRef: request.sourceEventRef,
      target: request.target,
      payload: request.payload,
      render: request.render,
      commandId: request.commandId,
      expiresAt: request.expiresAt,
    });
    const commit = Object.freeze({
      denied: false,
      intent: aggregate.snapshot(),
      actionIntentIds: Object.freeze([...request.actionIntentIds]),
      auditHash: sha256({
        dedupeKey,
        commandId: request.commandId,
        actionIntentIds: [...request.actionIntentIds],
      } as JsonValue),
      sourceFingerprintHash: sha256(request.sourceEventFingerprint),
      deliveryHealthEventRef: `notification-health:${request.id}:queued`,
    });
    this.#commits.set(dedupeKey, commit);
    return structuredClone(commit);
  }
}
