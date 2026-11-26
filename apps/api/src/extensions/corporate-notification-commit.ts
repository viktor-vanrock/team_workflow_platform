import type { DataSource } from "typeorm";

import {
  type GatewayCommit,
  type NotificationIntentSnapshot,
  pilotContentHash,
} from "@awp/platform-core";
import {
  TypeOrmCommandRepository,
  TypeOrmIdempotencyRepository,
  TypeOrmNotificationIntentRepository,
  TypeOrmUnitOfWork,
} from "@awp/platform-persistence-typeorm";

import {
  type CorporateCommandAdmissionAuthority,
  createCorporateTransactionalCommandAdmission,
} from "./corporate-command-admission.ts";

/** Commits notification intent, command, outbox, idempotency and pilot admission atomically. */
export async function commitCorporateNotification(
  source: DataSource,
  authority: CorporateCommandAdmissionAuthority,
  snapshot: NotificationIntentSnapshot,
  value: GatewayCommit,
): Promise<Readonly<{ replayed: boolean }>> {
  const command = value.command;
  if (
    !source.isInitialized ||
    snapshot.state !== "QUEUED" ||
    snapshot.attempts.length ||
    snapshot.workspaceId !== command.workspaceId ||
    snapshot.projectId !== command.projectId ||
    snapshot.commandId !== command.id ||
    command.source.notificationIntentId !== snapshot.id ||
    snapshot.targetHash !== command.targetHash ||
    snapshot.payloadHash !== command.payloadHash ||
    !snapshot.templateEvidence ||
    snapshot.templateEvidence.renderHash !== snapshot.renderHash ||
    command.capability.key !== "messaging.notify" ||
    command.capability.operation !== "notification.send" ||
    command.capability.exactContractVersion !== "1.0.0" ||
    !["LOOKUP_REQUIRED", "NONE_AMBIGUOUS"].includes(command.recoveryPolicy ?? "") ||
    !Number.isFinite(snapshot.expiresAt.getTime()) ||
    value.idempotency.workspaceId !== command.workspaceId ||
    value.idempotency.projectId !== command.projectId ||
    value.idempotency.actorId !== command.actor.principalId ||
    value.idempotency.commandId !== command.id ||
    snapshot.expiresAt <= new Date()
  )
    throw new Error("CORPORATE_NOTIFICATION_COMMIT_INVALID");
  const admissions = createCorporateTransactionalCommandAdmission(source, authority);
  return await source.transaction("SERIALIZABLE", async (manager) => {
    const result = await new TypeOrmNotificationIntentRepository(source).create(snapshot, manager);
    const stored = result.value;
    if (
      stored.id !== snapshot.id ||
      stored.commandId !== command.id ||
      stored.targetHash !== snapshot.targetHash ||
      stored.payloadHash !== snapshot.payloadHash ||
      stored.renderHash !== snapshot.renderHash ||
      !stored.templateEvidence ||
      pilotContentHash(stored.templateEvidence) !== pilotContentHash(snapshot.templateEvidence) ||
      stored.sourceEventRef !== snapshot.sourceEventRef ||
      stored.expiresAt.getTime() !== snapshot.expiresAt.getTime()
    )
      throw new Error("CORPORATE_NOTIFICATION_DEDUPE_CONFLICT");
    if (result.replayed) {
      const claim = await new TypeOrmIdempotencyRepository(source).find(value.idempotency, manager);
      if (
        !claim ||
        claim.commandId !== command.id ||
        claim.requestHash !== value.idempotency.requestHash
      )
        throw new Error("CORPORATE_NOTIFICATION_REPLAY_CONFLICT");
      const existing = await new TypeOrmCommandRepository(source).get(
        command.workspaceId,
        command.projectId,
        command.id,
        manager,
      );
      if (
        !existing ||
        existing.targetHash !== command.targetHash ||
        existing.payloadHash !== command.payloadHash
      )
        throw new Error("CORPORATE_NOTIFICATION_REPLAY_INCOMPLETE");
      await admissions.assertReplay(manager, existing);
      return { replayed: true };
    }
    await new TypeOrmUnitOfWork(source, manager).commit(value);
    await admissions.persist(manager, command);
    return { replayed: false };
  });
}
