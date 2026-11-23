import type { DataSource, EntityManager } from "typeorm";

import type { MessagingDeliveryResult } from "@awp/connector-sdk";
import type {
  ConnectorCommand,
  NotificationDeliveryAttempt,
  NotificationIntentSnapshot,
} from "@awp/platform-core";
import { TypeOrmNotificationIntentRepository } from "@awp/platform-persistence-typeorm";

export interface NotificationDeliveryPort {
  send(input: Readonly<{ effectKey: string; bytes: Uint8Array }>): Promise<MessagingDeliveryResult>;
}

export interface NotificationMaterializerPort {
  materialize(
    input: Readonly<{ commandId: string; attemptCount: number }>,
  ): Readonly<{ bytes: Uint8Array; bytesHash?: string; purge(): void }>;
}

export function classifyMattermostDeliveryResult(
  result: MessagingDeliveryResult,
): NotificationIntentSnapshot["state"] {
  if (result.outcome === "DELIVERED") return "DELIVERED";
  if (result.outcome === "LOOKUP_REQUIRED") return "LOOKUP_REQUIRED";
  if (result.outcome === "AMBIGUOUS") return "AMBIGUOUS";
  if (result.outcome === "EXPIRED") return "EXPIRED";
  return "FAILED_FINAL";
}

export class MattermostNotificationWorker {
  constructor(
    private readonly delivery: NotificationDeliveryPort,
    private readonly materializer: NotificationMaterializerPort,
  ) {}
  async deliver(
    snapshot: NotificationIntentSnapshot,
    now: Date,
  ): Promise<NotificationIntentSnapshot> {
    if (snapshot.state !== "QUEUED") throw new Error("NOTIFICATION_NOT_QUEUED");
    if (now >= snapshot.expiresAt)
      return Object.freeze({
        ...structuredClone(snapshot),
        state: "EXPIRED",
        rowVersion: snapshot.rowVersion + 1,
      });
    const attempt: NotificationDeliveryAttempt = Object.freeze({
      attempt: snapshot.attempts.length + 1,
      fence: snapshot.rowVersion + 1,
      startedAt: now,
      effectInvocationStartedAt: now,
    });
    const presentation = this.materializer.materialize({
      commandId: snapshot.commandId,
      attemptCount: attempt.attempt,
    });
    try {
      const result = await this.delivery.send({
        effectKey: snapshot.dedupeKey,
        bytes: presentation.bytes,
      });
      if (result.outcome === "DELIVERED") {
        return Object.freeze({
          ...structuredClone(snapshot),
          state: "DELIVERED",
          attempts: Object.freeze([...snapshot.attempts, { ...attempt, outcome: "DELIVERED" }]),
          rowVersion: snapshot.rowVersion + 2,
        });
      }
      const state = classifyMattermostDeliveryResult(result);
      return Object.freeze({
        ...structuredClone(snapshot),
        state,
        attempts: Object.freeze([...snapshot.attempts, { ...attempt, outcome: result.outcome }]),
        rowVersion: snapshot.rowVersion + 2,
      });
    } catch {
      return Object.freeze({
        ...structuredClone(snapshot),
        state: "LOOKUP_REQUIRED",
        attempts: Object.freeze([...snapshot.attempts, { ...attempt, outcome: "UNCERTAIN" }]),
        rowVersion: snapshot.rowVersion + 2,
      });
    } finally {
      presentation.purge();
    }
  }
}

/** Uses the existing intent ledger; SHADOW is persisted as terminal, so restart cannot release it. */
export class DurableMattermostNotificationProjection {
  constructor(private readonly source: DataSource) {}
  async project(
    snapshot: NotificationIntentSnapshot,
    mode: "SHADOW" | "DELIVER",
    enqueue: (manager: EntityManager, intent: NotificationIntentSnapshot) => Promise<void>,
  ) {
    if (
      !["SHADOW", "DELIVER"].includes(mode) ||
      snapshot.state !== "QUEUED" ||
      snapshot.attempts.length ||
      !Number.isFinite(snapshot.expiresAt.getTime())
    )
      throw new Error("NOTIFICATION_PROJECTION_INVALID");
    return this.source.transaction("SERIALIZABLE", async (manager) => {
      const result = await new TypeOrmNotificationIntentRepository(this.source).create(
        { ...snapshot, state: mode === "SHADOW" ? "FAILED_FINAL" : "QUEUED" },
        manager,
      );
      const original = result.value;
      if (
        original.targetHash !== snapshot.targetHash ||
        original.payloadHash !== snapshot.payloadHash ||
        original.renderHash !== snapshot.renderHash ||
        original.sourceEventRef !== snapshot.sourceEventRef
      )
        throw new Error("NOTIFICATION_DEDUPE_CONFLICT");
      if (!result.replayed && mode === "DELIVER") await enqueue(manager, original);
      return Object.freeze({ ...result, suppressed: original.state === "FAILED_FINAL" });
    });
  }
}

type NotificationRow = {
  command_id: string;
  state: string;
  row_version: string;
  expires_at: Date;
  target_hash: string;
  payload_hash: string;
};
export class DurableMattermostNotificationLifecycle {
  async denial(
    source: Pick<EntityManager, "query">,
    command: ConnectorCommand,
    now: Date,
  ): Promise<string | undefined> {
    if (!["LOOKUP_REQUIRED", "NONE_AMBIGUOUS"].includes(command.recoveryPolicy ?? ""))
      return "MATTERMOST_UNSAFE_RECOVERY_POLICY";
    const row = await this.row(source, command);
    if (!row)
      return command.capability.key === "messaging.notify"
        ? "NOTIFICATION_INTENT_REQUIRED"
        : undefined;
    if (
      row.command_id !== command.id ||
      row.target_hash !== command.targetHash ||
      row.payload_hash !== command.payloadHash
    )
      return "NOTIFICATION_COMMAND_CONFLICT";
    if (row.state !== "QUEUED") return "NOTIFICATION_NOT_QUEUED";
    if (!Number.isFinite(new Date(row.expires_at).getTime()) || new Date(row.expires_at) <= now)
      return "NOTIFICATION_EXPIRED";
    return undefined;
  }
  async mark(manager: EntityManager, command: ConnectorCommand, now: Date): Promise<void> {
    const id = command.source.notificationIntentId;
    if (id)
      await manager.query(
        "SELECT id FROM notification_intents WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
        [command.workspaceId, command.projectId, id],
      );
    const denial = await this.denial(manager, command, now);
    if (denial) throw new Error(denial);
    if (!id) return;
    const row = (await this.row(manager, command))!;
    await manager.query(
      "INSERT INTO notification_delivery_attempts(notification_intent_id,attempt,fence,started_at,effect_invocation_started_at,outcome) VALUES($1,$2,$3,$4,$4,'INVOKED')",
      [id, command.attemptCount + 1, Number(row.row_version) + 1, now],
    );
    await manager.query(
      "UPDATE notification_intents SET state='LOOKUP_REQUIRED',row_version=row_version+2 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [command.workspaceId, command.projectId, id],
    );
  }
  async discard(manager: EntityManager, command: ConnectorCommand, code: string): Promise<void> {
    const id = command.source.notificationIntentId;
    if (!id) return;
    await manager.query(
      "UPDATE notification_intents SET state=$4,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND command_id=$5 AND state='QUEUED'",
      [
        command.workspaceId,
        command.projectId,
        id,
        code === "NOTIFICATION_EXPIRED" ? "EXPIRED" : "FAILED_FINAL",
        command.id,
      ],
    );
  }
  async settle(
    manager: EntityManager,
    command: ConnectorCommand,
    state: "DELIVERED" | "AMBIGUOUS",
    outcome: string,
  ): Promise<void> {
    const id = command.source.notificationIntentId;
    if (!id) return;
    const row = await this.row(manager, command);
    if (!row || row.command_id !== command.id || row.state !== "LOOKUP_REQUIRED")
      throw new Error("NOTIFICATION_CONFIRMATION_CONFLICT");
    await manager.query(
      "UPDATE notification_delivery_attempts SET outcome=$2 WHERE notification_intent_id=$1 AND effect_invocation_started_at IS NOT NULL",
      [id, outcome],
    );
    await manager.query(
      "UPDATE notification_intents SET state=$4,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [command.workspaceId, command.projectId, id, state],
    );
  }
  private async row(
    source: Pick<EntityManager, "query">,
    command: ConnectorCommand,
  ): Promise<NotificationRow | undefined> {
    const id = command.source.notificationIntentId;
    if (!id) return undefined;
    return (
      (await source.query(
        "SELECT command_id,state,row_version,expires_at,target_hash,payload_hash FROM notification_intents WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        [command.workspaceId, command.projectId, id],
      )) as NotificationRow[]
    )[0];
  }
}
