import type { EntityManager } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ConnectorCommand } from "../../packages/platform-core/src/index.ts";
import {
  coreEntities,
  coreMigrationRegistry,
  createPlatformDataSource,
  migrationClasses,
  OneShotMigrationRunner,
  TypeOrmCommandDeliveryStore,
  TypeOrmCommandOutboxRepository,
  TypeOrmCommandRepository,
} from "../../packages/platform-persistence-typeorm/src/index.ts";
import { type RunningPostgres, startPostgres } from "../../packages/platform-testkit/src/index.ts";

describe("PostgreSQL durable command delivery", () => {
  let postgres: RunningPostgres;
  let source: ReturnType<typeof createPlatformDataSource>;

  const workspaceId = "31111111-1111-4111-8111-111111111111";
  const projectId = "32222222-2222-4222-8222-222222222222";
  const actorId = "39999999-9999-4999-8999-999999999999";

  beforeAll(async () => {
    postgres = await startPostgres();
    source = createPlatformDataSource({
      url: postgres.url,
      entities: coreEntities,
      migrations: migrationClasses(coreMigrationRegistry),
    });
    await new OneShotMigrationRunner(
      source,
      "core",
      Math.max(...coreMigrationRegistry.map((migration) => migration.order)),
    ).run();
    await source.query(
      "INSERT INTO workspaces(id,key,name,state) VALUES($1,'delivery','Delivery','ACTIVE')",
      [workspaceId],
    );
    await source.query(
      "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES($1,$2,'delivery','Delivery','ACTIVE','INTERNAL')",
      [projectId, workspaceId],
    );
  }, 120_000);

  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (postgres) await postgres.stop();
  });

  it("reclaims expired LEASED/ENQUEUED outbox rows and fences stale leases", async () => {
    const { outboxId } = await seedReadyCommand(1);
    const outbox = new TypeOrmCommandOutboxRepository(source);
    const at = new Date("2026-01-01T00:00:00.000Z");

    const [first] = await outbox.claim(at, new Date(at.getTime() + 10_000), 1);
    expect(first).toMatchObject({
      id: outboxId,
      state: "LEASED",
      attempts: 1,
    });
    expect(
      await outbox.claim(new Date(at.getTime() + 9_999), new Date(at.getTime() + 20_000), 1),
    ).toEqual([]);

    const [reclaimed] = await outbox.claim(
      new Date(at.getTime() + 10_001),
      new Date(at.getTime() + 20_001),
      1,
    );
    expect(reclaimed).toMatchObject({
      id: outboxId,
      state: "LEASED",
      attempts: 2,
    });
    await expect(outbox.release(first!, new Date(at.getTime() + 30_000))).rejects.toThrow(
      "COMMAND_OUTBOX_LEASE_CONFLICT",
    );

    const released = await outbox.release(reclaimed!, new Date(at.getTime() + 30_000));
    expect(released).toMatchObject({ state: "READY", attempts: 2 });
    expect(
      await outbox.claim(new Date(at.getTime() + 29_999), new Date(at.getTime() + 40_000), 1),
    ).toEqual([]);

    const [third] = await outbox.claim(
      new Date(at.getTime() + 30_000),
      new Date(at.getTime() + 40_000),
      1,
    );
    const enqueued = await outbox.acknowledgeEnqueued(third!, new Date(at.getTime() + 60_000));
    expect(enqueued).toMatchObject({
      state: "ENQUEUED",
      nextRepublishAt: new Date(at.getTime() + 60_000),
    });
    expect(
      await outbox.claim(new Date(at.getTime() + 59_999), new Date(at.getTime() + 70_000), 1),
    ).toEqual([]);
    const finalClaim = await outbox.claim(
      new Date(at.getTime() + 60_001),
      new Date(at.getTime() + 70_001),
      1,
    );
    expect(finalClaim).toEqual([
      expect.objectContaining({
        id: outboxId,
        state: "LEASED",
        attempts: 4,
      }),
    ]);
    await outbox.acknowledgeEnqueued(finalClaim[0]!, new Date("2030-01-01T00:00:00.000Z"));
  });

  it("persists claim, dispatch lease, recovery, confirmation and terminal failure atomically", async () => {
    const firstSeed = await seedReadyCommand(2);
    const store = new TypeOrmCommandDeliveryStore(source);
    const at = new Date("2026-01-02T00:00:00.000Z");

    const [claimed] = await store.claim(at, new Date(at.getTime() + 10_000), 1);
    expect(claimed?.command).toMatchObject({
      id: firstSeed.command.id,
      status: "QUEUED",
      outboxStatus: "LEASED",
    });
    expect(await store.loadClaimed(claimed!.outbox)).toMatchObject({
      id: firstSeed.command.id,
      outboxStatus: "LEASED",
    });

    const enqueued = await store.acknowledgeEnqueued(
      claimed!.outbox,
      new Date(at.getTime() + 1_000),
      new Date(at.getTime() + 31_000),
    );
    expect(enqueued).toMatchObject({
      status: "QUEUED",
      outboxStatus: "ENQUEUED",
    });

    const scope = {
      workspaceId,
      projectId,
      commandId: firstSeed.command.id,
    };
    const dispatched = await store.markDispatched(scope, new Date(at.getTime() + 2_000), 10_000);
    expect(dispatched).toMatchObject({
      status: "DISPATCHED",
      outboxStatus: "ACKNOWLEDGED",
      attemptCount: 1,
      effectGateDecision: "ALLOWED",
      effectInvocationStartedAt: new Date(at.getTime() + 2_000),
      executionLeaseExpiresAt: new Date(at.getTime() + 12_000),
    });
    expect(await store.recover(scope, new Date(at.getTime() + 11_999))).toBeUndefined();

    const recovered = await store.recover(scope, new Date(at.getTime() + 12_001));
    expect(recovered).toMatchObject({
      status: "RETRY_SCHEDULED",
      outboxStatus: "READY",
      effectIdempotencyKey: firstSeed.command.effectIdempotencyKey,
      effectInvocationStartedAt: new Date(at.getTime() + 2_000),
    });
    expect(recovered).not.toHaveProperty("executionLeaseExpiresAt");

    const [retryClaim] = await store.claim(
      new Date(at.getTime() + 13_000),
      new Date(at.getTime() + 23_000),
      1,
    );
    const retried = await store.markDispatched(
      retryClaim!.outbox,
      new Date(at.getTime() + 14_000),
      10_000,
    );
    expect(retried).toMatchObject({
      status: "DISPATCHED",
      outboxStatus: "ACKNOWLEDGED",
      attemptCount: 2,
    });

    let staleConfirmationMutationRan = false;
    await expect(
      store.confirmWith(
        scope,
        { externalEntityId: "STALE-1" },
        new Date(at.getTime() + 15_000),
        async () => {
          staleConfirmationMutationRan = true;
        },
        {
          attemptCount: dispatched.attemptCount,
          leaseExpiresAt: dispatched.executionLeaseExpiresAt!,
        },
      ),
    ).rejects.toThrow("COMMAND_EXECUTION_FENCE_REJECTED");
    expect(staleConfirmationMutationRan).toBe(false);

    await expect(
      store.confirmWith(
        scope,
        { externalEntityId: "QAC-1" },
        new Date(at.getTime() + 15_000),
        async (manager) => {
          await manager.query("UPDATE workspaces SET name='Must Roll Back' WHERE id=$1", [
            workspaceId,
          ]);
          throw new Error("CONFIRMATION_MUTATION_FAILED");
        },
      ),
    ).rejects.toThrow("CONFIRMATION_MUTATION_FAILED");
    expect(await store.load(scope)).toMatchObject({
      status: "DISPATCHED",
      outboxStatus: "ACKNOWLEDGED",
    });
    expect(await source.query("SELECT name FROM workspaces WHERE id=$1", [workspaceId])).toEqual([
      { name: "Delivery" },
    ]);

    const confirmed = await store.confirmWith(
      scope,
      { externalEntityId: "QAC-1" },
      new Date(at.getTime() + 16_000),
      async (manager) => {
        await manager.query("UPDATE workspaces SET name='Confirmed Atomically' WHERE id=$1", [
          workspaceId,
        ]);
      },
      {
        attemptCount: retried.attemptCount,
        leaseExpiresAt: retried.executionLeaseExpiresAt!,
      },
    );
    expect(confirmed).toMatchObject({
      status: "CONFIRMED",
      outboxStatus: "ACKNOWLEDGED",
      terminalResult: {
        outcome: "SUCCEEDED",
        receipt: { externalEntityId: "QAC-1" },
      },
    });
    expect(await source.query("SELECT name FROM workspaces WHERE id=$1", [workspaceId])).toEqual([
      { name: "Confirmed Atomically" },
    ]);
    expect(
      await new TypeOrmCommandOutboxRepository(source).get({
        id: firstSeed.outboxId,
        workspaceId,
        projectId,
        commandId: firstSeed.command.id,
      }),
    ).toMatchObject({ state: "ACKNOWLEDGED" });

    const failedSeed = await seedReadyCommand(3);
    const [failedClaim] = await store.claim(
      new Date(at.getTime() + 20_000),
      new Date(at.getTime() + 30_000),
      1,
    );
    await store.markDispatched(failedClaim!.outbox, new Date(at.getTime() + 21_000), 10_000);
    const failed = await store.fail(
      {
        workspaceId,
        projectId,
        commandId: failedSeed.command.id,
      },
      "JIRA_HTTP_403",
      new Date(at.getTime() + 22_000),
    );
    expect(failed).toMatchObject({
      status: "FAILED",
      outboxStatus: "DEAD",
      terminalResult: { outcome: "FAILED", code: "JIRA_HTTP_403" },
    });
    expect(
      await store.load({
        workspaceId,
        projectId: "33333333-3333-4333-8333-333333333333",
        commandId: failedSeed.command.id,
      }),
    ).toBeUndefined();
  });

  it("batch-recovers only expired DISPATCHED commands", async () => {
    const store = new TypeOrmCommandDeliveryStore(source);
    const expiredSeed = await seedReadyCommand(4);
    const liveSeed = await seedReadyCommand(5);
    const at = new Date("2026-01-03T00:00:00.000Z");

    const claims = await store.claim(at, new Date(at.getTime() + 10_000), 2);
    const byCommand = new Map(claims.map((claim) => [claim.command.id, claim.outbox]));
    await store.markDispatched(byCommand.get(expiredSeed.command.id)!, at, 5_000);
    await store.markDispatched(byCommand.get(liveSeed.command.id)!, at, 60_000);

    expect(await store.recoverExpired(new Date(at.getTime() + 6_000), 10)).toEqual([
      expect.objectContaining({ commandId: expiredSeed.command.id }),
    ]);
    expect(
      await store.load({
        workspaceId,
        projectId,
        commandId: expiredSeed.command.id,
      }),
    ).toMatchObject({ status: "RETRY_SCHEDULED", outboxStatus: "READY" });
    expect(
      await store.load({
        workspaceId,
        projectId,
        commandId: liveSeed.command.id,
      }),
    ).toMatchObject({ status: "DISPATCHED", outboxStatus: "ACKNOWLEDGED" });
  });

  it("does not lock lookup-only commands after a concurrent confirmation changes its snapshot", async () => {
    const value = await seedReadyCommand(6, "LOOKUP_REQUIRED");
    const store = new TypeOrmCommandDeliveryStore(source);
    const at = new Date("2026-01-03T00:00:10Z");
    const claims = await store.claim(at, new Date(at.getTime() + 1000), 10);
    const claim = claims.find((item) => item.command.id === value.command.id)!;
    const dispatched = await store.markDispatched(claim.outbox, at, 1000);
    const scope = { workspaceId, projectId, commandId: value.command.id };
    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction("SERIALIZABLE");
    try {
      // Real PostgreSQL snapshot before the other worker commits confirmation.
      await runner.query("SELECT txid_current_snapshot()");
      await store.confirmWith(
        scope,
        { externalEntityId: "one-effect" },
        new Date(at.getTime() + 500),
        async () => {},
        {
          attemptCount: dispatched.attemptCount,
          leaseExpiresAt: dispatched.executionLeaseExpiresAt!,
        },
      );
      const snapshotSource = {
        transaction: async (
          _isolation: string,
          work: (manager: EntityManager) => Promise<unknown>,
        ) => await work(runner.manager),
      } as typeof source;
      expect(
        (
          await new TypeOrmCommandDeliveryStore(snapshotSource).recoverExpired(
            new Date(at.getTime() + 1001),
            10,
          )
        ).some((item) => item.commandId === value.command.id),
      ).toBe(false);
      await runner.commitTransaction();
      expect((await store.load(scope))?.status).toBe("CONFIRMED");
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
  });

  async function seedReadyCommand(
    sequence: number,
    recoveryPolicy?: ConnectorCommand["recoveryPolicy"],
  ): Promise<
    Readonly<{
      command: ConnectorCommand;
      outboxId: string;
    }>
  > {
    const at = new Date("2026-01-01T00:00:00.000Z");
    const commandId = uuid(100 + sequence);
    const outboxId = uuid(200 + sequence);
    const command: ConnectorCommand = {
      id: commandId,
      workspaceId,
      projectId,
      actor: {
        kind: "SERVICE",
        principalId: actorId,
        serviceKey: "durable-delivery-test",
      },
      commandType: "sample.record.publish",
      capability: {
        key: "sample.record",
        exactContractVersion: "1.0.0",
        operation: "record.publish",
        logicalRole: "PRIMARY",
      },
      target: { id: `record-${sequence}` },
      targetHash: `sha256:target-${sequence}`,
      payload: { message: `message-${sequence}` },
      payloadHash: `sha256:payload-${sequence}`,
      expectedExternalState: { mode: "MUST_NOT_EXIST" },
      bindingRef: { id: `binding-${sequence}`, version: 1 },
      profileRef: { id: `profile-${sequence}`, version: 1 },
      clientRequestKey: `request-${sequence}`,
      effectIdempotencyKey: `awp:effect:${commandId}`,
      dataClassificationKey: "INTERNAL",
      initialAuthorizationBasis: {
        kind: "PROJECT",
        policyVersion: "policy@1",
        membershipRef: { id: `membership-${sequence}`, version: 1 },
        roleAssignmentRefs: [],
        entitlementRefs: [],
        skillContext: "NOT_APPLICABLE",
      },
      initialAuthorizationBasisHash: `sha256:basis-${sequence}`,
      correlationId: uuid(300 + sequence),
      causationId: uuid(400 + sequence),
      source: { sourceWorkItemId: uuid(500 + sequence) },
      status: "QUEUED",
      effectAuthorizationStatus: "NOT_REQUIRED",
      outboxStatus: "READY",
      attemptCount: 0,
      createdAt: at,
      updatedAt: at,
      rowVersion: 1,
      ...(recoveryPolicy ? { recoveryPolicy } : {}),
    };
    await new TypeOrmCommandRepository(source).insert(command);
    await new TypeOrmCommandOutboxRepository(source).insert({
      id: outboxId,
      commandId,
      workspaceId,
      projectId,
      state: "READY",
      availableAt: at,
      attempts: 0,
      envelopeHash: `sha256:envelope-${sequence}`,
      createdAt: at,
    });
    return Object.freeze({ command, outboxId });
  }
});

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}
