import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type Approval,
  parseApprovalSubject,
  recomputeExactApprovalSubjectHash,
} from "../../../../packages/platform-core/src/index.ts";
import {
  coreEntities,
  coreMigrationRegistry,
  createPlatformDataSource,
  migrationClasses,
  TypeOrmCommandDeliveryStore,
} from "../../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../../packages/platform-testkit/src/postgres.ts";
import { seedDeadLetterFixture } from "../../../support/008-dead-letter.ts";
import { POSTGRES_TEST_IMAGES } from "../../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true").each(POSTGRES_TEST_IMAGES)(
  "008 exact approval isolation on %s",
  (image) => {
    let postgres: RunningPostgres, source: ReturnType<typeof createPlatformDataSource>;
    beforeAll(async () => {
      postgres = await startPostgres(image);
      source = createPlatformDataSource({
        url: postgres.url,
        entities: coreEntities,
        migrations: migrationClasses(coreMigrationRegistry),
      });
      await source.initialize();
      await source.runMigrations({ transaction: "all" });
    }, 120000);
    afterAll(async () => {
      if (source?.isInitialized) await source.destroy();
      await postgres?.stop();
    });

    it("rejects a self-consistent forged action swap before approval consumption", async () => {
      const f = await seedDeadLetterFixture(source, { approval: true }),
        input = await f.input();
      const [row] = (await source.query("SELECT subject FROM approvals WHERE id=$1", [
        f.command.approvalId,
      ])) as Array<{ subject: unknown }>;
      const stored = parseApprovalSubject(row!.subject) as Approval;
      const forgedBase = { ...stored, action: { ...stored.action, actionId: randomUUID() } };
      const forged = { ...forgedBase, subjectHash: recomputeExactApprovalSubjectHash(forgedBase) };
      await source.query("UPDATE approvals SET subject=$2,subject_hash=$3 WHERE id=$1", [
        f.command.approvalId,
        JSON.stringify(forged),
        forged.subjectHash,
      ]);
      await expect(f.service().replay(f.context, input)).rejects.toThrow();
      expect((await f.current()).outboxStatus).toBe("DEAD");
      expect(
        await source.query("SELECT id FROM pilot_replay_decisions WHERE command_id=$1", [
          f.command.id,
        ]),
      ).toHaveLength(0);
    });

    it.each(["configuration", "rights", "approval-expiry"] as const)(
      "rejects %s drift at the consuming transaction",
      async (scenario) => {
        const f = await seedDeadLetterFixture(source, { approval: true }),
          input = await f.input();
        if (scenario === "configuration") f.state.corruptPins = true;
        if (scenario === "rights") f.state.originalAllowed = false;
        if (scenario === "approval-expiry")
          f.state.now = new Date(f.command.createdAt.getTime() + 60000);
        await expect(f.service().replay(f.context, input)).rejects.toThrow();
        expect((await f.current()).outboxStatus).toBe("DEAD");
      },
    );

    it("serializes competing replay approvals to one action identity", async () => {
      const f = await seedDeadLetterFixture(source, { approval: true }),
        first = await f.input(),
        second = { ...first, requestKey: randomUUID() };
      const results = await Promise.allSettled([
        f.service().replay(f.context, first),
        f.service().replay(f.context, second),
      ]);
      expect(results.filter((value) => value.status === "fulfilled")).toHaveLength(1);
      expect(
        await source.query("SELECT id FROM pilot_replay_decisions WHERE command_id=$1", [
          f.command.id,
        ]),
      ).toHaveLength(1);
      const command = await f.current();
      expect(command.id).toBe(f.command.id);
      expect(command.effectIdempotencyKey).toBe(f.command.effectIdempotencyKey);
    });

    it("rechecks consumed authorization expiry at dispatch and starts no provider effect", async () => {
      const f = await seedDeadLetterFixture(source, { approval: true }),
        input = await f.input();
      await f.service().replay(f.context, input);
      const store = new TypeOrmCommandDeliveryStore(source),
        claim = (
          await store.claim(f.state.now, new Date(f.state.now.getTime() + 120000), 100)
        ).find((value) => value.command.id === f.command.id)!;
      let effects = 0;
      await expect(
        store.markDispatched(
          claim.outbox,
          new Date(f.command.createdAt.getTime() + 60000),
          30000,
          undefined,
          async () => {
            effects++;
          },
        ),
      ).rejects.toThrow("COMMAND_REPLAY_AUTHORIZATION_EXPIRED");
      expect(effects).toBe(0);
      expect((await f.current()).effectInvocationStartedAt).toBeUndefined();
    });
  },
);
