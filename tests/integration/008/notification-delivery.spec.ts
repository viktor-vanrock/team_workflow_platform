import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  type ConnectorCommand,
  InMemoryDurableCommandStore,
  NotificationIntentAggregate,
  type ProjectEffectGuardPort,
} from "../../../packages/platform-core/src/index.ts";
import {
  createPlatformDataSource,
  migrationClasses,
  TypeOrmCommandDeliveryStore,
  TypeOrmCommandOutboxRepository,
  TypeOrmCommandRepository,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";
import { loadEnvironment } from "../../../packages/runtime-composition/src/config/environment.ts";
import {
  qaJiraGitLabLocalComposition,
  qaJiraGitLabLocalMigrationRegistry,
} from "../../../packages/runtime-composition/src/gitlab/composition.ts";
import { DurableMattermostNotificationProjection } from "../../../packages/runtime-composition/src/mattermost/notification-worker.ts";
import { createMattermostWorkerSteps } from "../../../packages/runtime-composition/src/mattermost/worker-steps.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true").each(POSTGRES_TEST_IMAGES)(
  "008 durable Mattermost notifications on %s",
  (image) => {
    let postgres: RunningPostgres,
      source: ReturnType<typeof createPlatformDataSource>,
      server: ReturnType<typeof createServer>,
      origin: string;
    let lost: boolean,
      visible: number,
      wrongScope: boolean,
      posts: Record<string, unknown>[],
      reads: number,
      readStatus: number,
      readHint: string | undefined;
    beforeAll(async () => {
      postgres = await startPostgres(image);
      source = createPlatformDataSource({
        url: postgres.url,
        entities: qaJiraGitLabLocalComposition.entities,
        migrations: migrationClasses(qaJiraGitLabLocalMigrationRegistry),
      });
      await source.initialize();
      await source.runMigrations({ transaction: "all" });
      server = createServer((request, response) => {
        void (async () => {
          if (request.method === "POST") {
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
            const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
            const post = { ...body, id: randomUUID() };
            posts.push(post); // Deliberately no provider deduplication.
            if (lost) {
              response.destroy();
              return;
            }
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify(post));
          } else {
            reads++;
            if (readStatus !== 200) {
              response.writeHead(readStatus, {
                "content-type": "application/json",
                ...(readHint ? { "retry-after": readHint } : {}),
              });
              response.end("{}");
              return;
            }
            const key = new URL(request.url!, origin).searchParams.get("effect_key");
            let found = posts
              .filter((post) => (post.props as { effectKey: string }).effectKey === key)
              .slice(0, visible);
            if (visible === 2 && found[0]) found = [found[0], { ...found[0], id: randomUUID() }];
            if (wrongScope) found = found.map((post) => ({ ...post, channel_id: "wrong-channel" }));
            response.writeHead(200, { "content-type": "application/json" });
            response.end(
              JSON.stringify({
                posts: Object.fromEntries(found.map((post) => [String(post.id), post])),
              }),
            );
          }
        })().catch(() => response.destroy());
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }, 120_000);
    afterAll(async () => {
      server?.closeAllConnections();
      if (server?.listening)
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      if (source?.isInitialized) await source.destroy();
      await postgres?.stop();
    });
    beforeEach(() => {
      lost = false;
      visible = 1;
      wrongScope = false;
      posts = [];
      reads = 0;
      readStatus = 200;
      readHint = undefined;
    });
    async function seed(options: { expired?: boolean; shadow?: boolean } = {}) {
      const workspaceId = randomUUID(),
        projectId = randomUUID(),
        commandId = randomUUID(),
        notificationId = randomUUID(),
        connectionId = randomUUID(),
        profileId = randomUUID();
      const at = new Date();
      const hash = `sha256:${"a".repeat(64)}`;
      await source.query(
        "INSERT INTO workspaces(id,key,name,state) VALUES($1,$2,'Notification fixture','ACTIVE')",
        [workspaceId, workspaceId],
      );
      await source.query(
        "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES($1,$2,'notify','Notification fixture','ACTIVE','INTERNAL')",
        [projectId, workspaceId],
      );
      await source.query(
        "INSERT INTO connection_headers(id,workspace_id,key,current_published_version) VALUES($1,$2,'mm',1)",
        [connectionId, workspaceId],
      );
      await source.query(
        "INSERT INTO connection_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,now())",
        [
          randomUUID(),
          workspaceId,
          connectionId,
          { endpoint: origin, botCredentialSecretRef: "secretref://fixture/mm" },
          hash,
        ],
      );
      await source.query(
        "INSERT INTO connector_profile_headers(id,workspace_id,key,current_published_version) VALUES($1,$2,'mm',1)",
        [profileId, workspaceId],
      );
      await source.query(
        "INSERT INTO connector_profile_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,now())",
        [
          randomUUID(),
          workspaceId,
          profileId,
          { connectionRef: { id: connectionId, version: 1 }, channelIds: ["fixture-channel"] },
          hash,
        ],
      );
      const target = { kind: "PROJECT_CHANNEL" as const, purpose: "QA_COORDINATION" },
        payload = { template: "DELIVERY_HEALTH", variables: { status: "confirmed" } };
      const intent = NotificationIntentAggregate.create({
        id: notificationId,
        workspaceId,
        projectId,
        commandId,
        dedupeKey: `effect:${commandId}`,
        sourceEventRef: randomUUID(),
        target,
        payload,
        render: "DELIVERY_HEALTH@1",
        expiresAt: new Date(at.getTime() + (options.expired ? -1 : 60_000)),
      }).snapshot();
      const command: ConnectorCommand = {
        ...InMemoryDurableCommandStore.readyFixture().command(),
        id: commandId,
        workspaceId,
        projectId,
        commandType: "notification.send",
        capability: {
          key: "messaging.notify",
          exactContractVersion: "1.0.0",
          operation: "notification.send",
          logicalRole: "NOTIFICATION_MESSAGING",
        },
        target,
        payload,
        targetHash: intent.targetHash,
        payloadHash: intent.payloadHash,
        profileRef: { id: profileId, version: 1 },
        effectIdempotencyKey: intent.dedupeKey,
        source: { notificationIntentId: notificationId },
        recoveryPolicy: "LOOKUP_REQUIRED",
        correlationId: randomUUID(),
        causationId: randomUUID(),
        createdAt: at,
        updatedAt: at,
      };
      const enqueue = async (
        manager: Parameters<Parameters<DurableMattermostNotificationProjection["project"]>[2]>[0],
      ) => {
        await new TypeOrmCommandRepository(source).insert(command, manager);
        await new TypeOrmCommandOutboxRepository(source).insert(
          {
            id: randomUUID(),
            commandId,
            workspaceId,
            projectId,
            state: "READY",
            availableAt: at,
            attempts: 0,
            envelopeHash: hash,
            createdAt: at,
          },
          manager,
        );
      };
      await new DurableMattermostNotificationProjection(source).project(
        intent,
        options.shadow ? "SHADOW" : "DELIVER",
        enqueue,
      );
      const environment = loadEnvironment({
        AWP_RUNTIME_PROFILE: "local",
        AWP_ENVIRONMENT: "LOCAL",
        AWP_COMPOSITION: "qa-jira-mattermost-local",
        AWP_DATABASE_URL: postgres.url,
      });
      const guard: ProjectEffectGuardPort = {
        assertEffectsAllowed: async (scope) => ({
          ...scope,
          operationalState: "ACTIVE",
          capabilityMode: "FULL_QA",
          onboardingVersion: 1,
          evaluatedAt: new Date().toISOString(),
        }),
      };
      const worker = () =>
        createMattermostWorkerSteps(
          source,
          environment,
          { resolve: async () => "fixture-token" },
          guard,
        );
      const state = async () =>
        (
          await source.query("SELECT state FROM notification_intents WHERE id=$1", [notificationId])
        )[0].state as string;
      const scope = { workspaceId, projectId, commandId };
      const delivery = () => new TypeOrmCommandDeliveryStore(source).load(scope);
      const expireLease = async () => {
        await source.query(
          "UPDATE connector_commands SET payload=jsonb_set(payload,'{metadata,executionLeaseExpiresAt}',to_jsonb($2::text)) WHERE id=$1",
          [commandId, new Date(Date.now() - 1000).toISOString()],
        );
      };
      return { command, intent, enqueue, worker, state, delivery, expireLease };
    }
    it("expires before invocation and never sends a duplicate of a delivered intent", async () => {
      const expired = await seed({ expired: true });
      let worker = expired.worker();
      await worker.dispatcher.run();
      await worker.commands.run();
      expect(await expired.state()).toBe("EXPIRED");
      expect(await expired.delivery()).toMatchObject({ status: "FAILED", attemptCount: 0 });
      expect((await expired.delivery())?.effectInvocationStartedAt).toBeUndefined();
      expect(posts).toHaveLength(0);
      const delivered = await seed();
      worker = delivered.worker();
      await worker.dispatcher.run();
      await worker.commands.run();
      expect(await delivered.state()).toBe("DELIVERED");
      expect((await delivered.delivery())?.status).toBe("CONFIRMED");
      await source.destroy();
      await source.initialize();
      worker = delivered.worker();
      await worker.recovery.run();
      await worker.dispatcher.run();
      await worker.commands.run();
      expect(posts).toHaveLength(1);
    });
    it("keeps a shadow decision suppressed across restart and rejects changed duplicate payloads", async () => {
      const value = await seed({ shadow: true });
      await source.destroy();
      await source.initialize();
      const projection = new DurableMattermostNotificationProjection(source);
      expect(await projection.project(value.intent, "DELIVER", value.enqueue)).toMatchObject({
        replayed: true,
        suppressed: true,
      });
      expect(await value.delivery()).toBeUndefined();
      expect(await value.state()).toBe("FAILED_FINAL");
      expect(posts).toHaveLength(0);
      await expect(
        projection.project(
          { ...value.intent, payloadHash: `sha256:${"b".repeat(64)}` },
          "DELIVER",
          value.enqueue,
        ),
      ).rejects.toThrow("NOTIFICATION_DEDUPE_CONFLICT");
    });
    it("reconciles lost response with one HTTP POST and atomic command/intent completion", async () => {
      const value = await seed();
      lost = true;
      const worker = value.worker();
      await worker.dispatcher.run();
      await worker.commands.run();
      expect(await value.state()).toBe("LOOKUP_REQUIRED");
      expect(await value.delivery()).toMatchObject({ status: "DISPATCHED", attemptCount: 1 });
      expect(posts).toHaveLength(1);
      await value.expireLease();
      await source.destroy();
      await source.initialize();
      lost = false;
      await Promise.all([value.worker().recovery.run(), value.worker().recovery.run()]);
      expect(await value.state()).toBe("DELIVERED");
      expect((await value.delivery())?.status).toBe("CONFIRMED");
      await value.worker().recovery.run();
      expect(posts).toHaveLength(1);
      expect(reads).toBe(1);
    });
    it("quarantines zero/multiple/wrong-channel matches without another POST", async () => {
      for (const scenario of ["zero", "multiple", "scope"]) {
        const value = await seed();
        lost = true;
        const worker = value.worker();
        await worker.dispatcher.run();
        await worker.commands.run();
        await value.expireLease();
        lost = false;
        visible = scenario === "zero" ? 0 : scenario === "multiple" ? 2 : 1;
        wrongScope = scenario === "scope";
        await value.worker().recovery.run();
        expect(await value.state()).toBe("AMBIGUOUS");
        expect((await value.delivery())?.status).toBe("FAILED");
      }
      expect(posts).toHaveLength(3);
      expect(reads).toBe(3);
    });
    it("rolls back the intent marker if command dispatch fails", async () => {
      const value = await seed();
      await source.query(
        "CREATE OR REPLACE FUNCTION fixture_reject_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='DISPATCHED' THEN RAISE EXCEPTION 'FIXTURE_DISPATCH_REJECTED'; END IF; RETURN NEW; END $$",
      );
      await source.query(
        "CREATE TRIGGER fixture_reject_dispatch BEFORE UPDATE ON connector_commands FOR EACH ROW EXECUTE FUNCTION fixture_reject_dispatch()",
      );
      try {
        const worker = value.worker();
        await worker.dispatcher.run();
        await worker.commands.run();
        expect(await value.state()).toBe("QUEUED");
        expect((await value.delivery())?.effectInvocationStartedAt).toBeUndefined();
        expect(posts).toHaveLength(0);
        expect(
          await source.query(
            "SELECT * FROM notification_delivery_attempts WHERE notification_intent_id=$1",
            [value.intent.id],
          ),
        ).toEqual([]);
      } finally {
        await source.query("DROP TRIGGER fixture_reject_dispatch ON connector_commands");
        await source.query("DROP FUNCTION fixture_reject_dispatch()");
        await source.query(
          "UPDATE notification_intents SET expires_at=now()-interval '1 second' WHERE id=$1",
          [value.intent.id],
        );
        await source.query(
          "UPDATE command_outbox SET next_republish_at=now()-interval '1 second' WHERE command_id=$1",
          [value.command.id],
        );
        const worker = value.worker();
        await worker.dispatcher.run();
        await worker.commands.run();
      }
    });
    it("rolls back command confirmation when intent settlement fails, then performs readback only", async () => {
      const value = await seed();
      await source.query(
        "CREATE OR REPLACE FUNCTION fixture_reject_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='DELIVERED' THEN RAISE EXCEPTION 'FIXTURE_SETTLEMENT_REJECTED'; END IF; RETURN NEW; END $$",
      );
      await source.query(
        "CREATE TRIGGER fixture_reject_settlement BEFORE UPDATE ON notification_intents FOR EACH ROW EXECUTE FUNCTION fixture_reject_settlement()",
      );
      try {
        const worker = value.worker();
        await worker.dispatcher.run();
        await worker.commands.run();
        expect(await value.state()).toBe("LOOKUP_REQUIRED");
        expect((await value.delivery())?.status).toBe("DISPATCHED");
        expect(posts).toHaveLength(1);
      } finally {
        await source.query("DROP TRIGGER fixture_reject_settlement ON notification_intents");
        await source.query("DROP FUNCTION fixture_reject_settlement()");
      }
      await value.expireLease();
      await source.destroy();
      await source.initialize();
      await value.worker().recovery.run();
      expect(await value.state()).toBe("DELIVERED");
      expect((await value.delivery())?.status).toBe("CONFIRMED");
      expect(posts).toHaveLength(1);
      expect(reads).toBe(1);
    });
    it("stops auth/oversized-rate failures and preserves a bounded readback budget through restart", async () => {
      for (const status of [401, 403, 429, 503]) {
        const value = await seed();
        lost = true;
        const worker = value.worker();
        await worker.dispatcher.run();
        await worker.commands.run();
        lost = false;
        readStatus = status;
        readHint = status === 429 ? "60" : undefined;
        const before = reads;
        for (let attempt = 1; attempt <= (status === 503 ? 4 : 1); attempt++) {
          await value.expireLease();
          await source.destroy();
          await source.initialize();
          await value.worker().recovery.run();
          expect(await value.state()).toBe(
            status === 503 && attempt < 4 ? "LOOKUP_REQUIRED" : "AMBIGUOUS",
          );
        }
        expect(reads - before).toBe(status === 503 ? 4 : 1);
        expect((await value.delivery())?.status).toBe("FAILED");
      }
      expect(posts).toHaveLength(4);
    });
  },
);
