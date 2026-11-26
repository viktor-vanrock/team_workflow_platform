import { afterEach, describe, expect, it, vi } from "vitest";
import { commitCorporateNotification } from "../../../apps/api/src/extensions/corporate-notification-commit.ts";
import { InMemoryDurableCommandStore } from "../../../packages/platform-core/src/commanding/connector-command.ts";
import {
  TypeOrmCommandRepository,
  TypeOrmIdempotencyRepository,
  TypeOrmNotificationIntentRepository,
  TypeOrmUnitOfWork,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import * as admissions from "../../../apps/api/src/extensions/corporate-command-admission.ts";

afterEach(() => vi.restoreAllMocks());
describe("corporate notification commit", () => {
  const fixture = () => {
    const base = InMemoryDurableCommandStore.readyFixture().command();
    const command = {
      ...base,
      capability: {
        ...base.capability,
        key: "messaging.notify",
        operation: "notification.send",
        exactContractVersion: "1.0.0",
      },
      source: { notificationIntentId: "intent" },
      recoveryPolicy: "LOOKUP_REQUIRED" as const,
    };
    const snapshot = {
      id: "intent",
      workspaceId: command.workspaceId,
      projectId: command.projectId,
      commandId: command.id,
      targetHash: command.targetHash,
      payloadHash: command.payloadHash,
      renderHash: "render",
      templateEvidence: {
        templateRef: "template",
        templateHash: "template-hash",
        variablesSchemaRef: { id: "schema", version: 1, digest: "digest" },
        variablesHash: "variables-hash",
        renderHash: "render",
      },
      sourceEventRef: "event",
      state: "QUEUED",
      attempts: [],
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    };
    const idempotency = {
      workspaceId: command.workspaceId,
      projectId: command.projectId,
      actorId: command.actor.principalId,
      commandId: command.id,
      requestHash: "request",
      operation: "notification.send",
      clientKey: "key",
      createdAt: new Date(),
    };
    return { command, snapshot, idempotency };
  };
  it("commits the intent, gateway command and admission using the same transaction", async () => {
    const { command, snapshot, idempotency } = fixture();
    const manager = { queryRunner: { isTransactionActive: true } };
    const source = {
      isInitialized: true,
      transaction: async (_level: string, work: (m: unknown) => Promise<unknown>) =>
        await work(manager),
    };
    vi.spyOn(TypeOrmNotificationIntentRepository.prototype, "create").mockResolvedValue({
      value: snapshot,
      replayed: false,
    } as never);
    const commit = vi.spyOn(TypeOrmUnitOfWork.prototype, "commit").mockResolvedValue();
    const persist = vi.fn();
    vi.spyOn(admissions, "createCorporateTransactionalCommandAdmission").mockReturnValue({
      persist,
      assertReplay: vi.fn(),
    } as never);
    expect(
      await commitCorporateNotification(
        source as never,
        {} as never,
        snapshot as never,
        { command, idempotency } as never,
      ),
    ).toEqual({ replayed: false });
    expect(commit).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(manager, command);
  });
  it("requires the original command and admission for replay", async () => {
    const { command, snapshot, idempotency } = fixture();
    const manager = { queryRunner: { isTransactionActive: true } };
    const source = {
      isInitialized: true,
      transaction: async (_level: string, work: (m: unknown) => Promise<unknown>) =>
        await work(manager),
    };
    vi.spyOn(TypeOrmNotificationIntentRepository.prototype, "create").mockResolvedValue({
      value: snapshot,
      replayed: true,
    } as never);
    vi.spyOn(TypeOrmCommandRepository.prototype, "get").mockResolvedValue(command as never);
    vi.spyOn(TypeOrmIdempotencyRepository.prototype, "find").mockResolvedValue(idempotency);
    const assertReplay = vi.fn();
    vi.spyOn(admissions, "createCorporateTransactionalCommandAdmission").mockReturnValue({
      persist: vi.fn(),
      assertReplay,
    } as never);
    expect(
      await commitCorporateNotification(
        source as never,
        {} as never,
        snapshot as never,
        { command, idempotency } as never,
      ),
    ).toEqual({ replayed: true });
    expect(assertReplay).toHaveBeenCalledWith(manager, command);
  });
});
