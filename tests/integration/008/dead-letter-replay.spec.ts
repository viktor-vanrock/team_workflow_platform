import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NestFactory } from "../../../apps/api/node_modules/@nestjs/core/index.js";
import { PilotDeadLetterModule } from "../../../apps/api/src/extensions/pilot/dead-letter.module.ts";
import type { QaSessionRequest } from "../../../apps/api/src/extensions/qa-api-authorization.ts";
import { sha256 } from "../../../packages/platform-contracts/src/index.ts";
import {
  coreEntities,
  coreMigrationRegistry,
  createPlatformDataSource,
  migrationClasses,
  TypeOrmCommandDeliveryStore,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";
import { seedDeadLetterFixture } from "../../support/008-dead-letter.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true").each(POSTGRES_TEST_IMAGES)(
  "008 dead-letter replay on %s",
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
    it("persists owner/original age and replays one command atomically across concurrency and restart", async () => {
      const f = await seedDeadLetterFixture(source),
        input = await f.input();
      const first = await f.service().list(f.context);
      expect(first.items[0]).toMatchObject({
        ownerRef: f.operator,
        eligibility: "ELIGIBLE",
        commandAgeMs: 1000,
        replayCount: 0,
      });
      expect(JSON.stringify(first)).not.toContain("PRIVATE_PROVIDER_PAYLOAD_CANARY");
      const decisions = await Promise.all(
        Array.from({ length: 5 }, () => f.service().replay(f.context, input)),
      );
      expect(new Set(decisions.map((value) => value.decisionId)).size).toBe(1);
      expect(await f.current()).toMatchObject({
        status: "QUEUED",
        outboxStatus: "READY",
        rowVersion: f.command.rowVersion + 1,
        effectIdempotencyKey: f.command.effectIdempotencyKey,
        payloadHash: f.command.payloadHash,
        payload: f.command.payload,
      });
      await source.destroy();
      await source.initialize();
      expect(await f.service().replay(f.context, input)).toEqual(decisions[0]);
      expect(
        await source.query("SELECT * FROM pilot_replay_decisions WHERE command_id=$1", [
          f.command.id,
        ]),
      ).toHaveLength(1);
      expect(
        await source.query(
          "SELECT * FROM audit_events WHERE workspace_id=$1 AND action='pilot.replay.decide'",
          [f.command.workspaceId],
        ),
      ).toHaveLength(1);
      await expect(
        f.service().replay(f.context, { ...input, reason: "ACCESS_RESTORED" }),
      ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
      f.state.operatorAllowed = false;
      await expect(f.service().replay(f.context, input)).rejects.toThrow();
    });
    it.each([
      "invoked",
      "payload",
      "hash",
      "approval-expired",
      "approval-swapped",
      "rights",
      "approver",
      "pins",
      "age",
      "version",
    ])("denies %s without releasing any outbox", async (scenario) => {
      const f = await seedDeadLetterFixture(source, {
        approval: scenario.startsWith("approval") || scenario === "approver",
        invoked: scenario === "invoked",
      });
      const input = await f.input();
      if (scenario === "payload" || scenario === "hash") {
        const payload = { privateText: "altered" };
        await source.query(
          "UPDATE connector_commands SET payload=jsonb_set(payload,'{value}',$2::jsonb) WHERE id=$1",
          [f.command.id, JSON.stringify(payload)],
        );
        if (scenario === "hash")
          await source.query(
            "UPDATE connector_commands SET payload=jsonb_set(payload,'{metadata,payloadHash}',$2::jsonb) WHERE id=$1",
            [f.command.id, JSON.stringify(sha256(payload))],
          );
      }
      if (scenario === "approval-expired")
        f.state.now = new Date(f.command.createdAt.getTime() + 60000);
      if (scenario === "approval-swapped")
        await source.query(
          "UPDATE approvals SET subject=jsonb_set(subject,'{action,actionId}',$2::jsonb) WHERE id=$1",
          [f.command.approvalId, JSON.stringify(randomUUID())],
        );
      if (scenario === "rights") f.state.originalAllowed = false;
      if (scenario === "approver") f.state.approverAllowed = false;
      if (scenario === "pins") f.state.corruptPins = true;
      if (scenario === "age") f.state.now = new Date(f.command.createdAt.getTime() + 120000);
      await expect(
        f.service().replay(f.context, {
          ...input,
          ...(scenario === "version" ? { expectedRowVersion: 999 } : {}),
        }),
      ).rejects.toThrow();
      expect((await f.current()).outboxStatus).toBe("DEAD");
      expect(
        await source.query("SELECT * FROM pilot_replay_decisions WHERE command_id=$1", [
          f.command.id,
        ]),
      ).toHaveLength(0);
    });
    it("preserves exact consumed approval and stops dispatch after the original expiry", async () => {
      const f = await seedDeadLetterFixture(source, { approval: true }),
        input = await f.input();
      await f.service().replay(f.context, input);
      expect((await f.current()).effectAuthorizationStatus).toBe("CONSUMED");
      expect((await f.current()).approvalId).toBe(f.command.approvalId);
      const store = new TypeOrmCommandDeliveryStore(source);
      const claim = (
        await store.claim(f.state.now, new Date(f.state.now.getTime() + 120000), 100)
      ).find((value) => value.command.id === f.command.id)!;
      expect(claim).toBeDefined();
      await expect(
        store.markDispatched(claim.outbox, new Date(f.command.createdAt.getTime() + 60000), 30000),
      ).rejects.toThrow("COMMAND_REPLAY_AUTHORIZATION_EXPIRED");
      expect((await f.current()).effectInvocationStartedAt).toBeUndefined();
    });
    it("rolls command/outbox/decision back when durable audit fails", async () => {
      const f = await seedDeadLetterFixture(source),
        input = await f.input();
      await source.query(
        "CREATE FUNCTION fixture_deny_replay_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='pilot.replay.decide' THEN RAISE EXCEPTION 'FIXTURE_AUDIT_FAILED'; END IF; RETURN NEW; END $$",
      );
      await source.query(
        "CREATE TRIGGER fixture_deny_replay_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fixture_deny_replay_audit()",
      );
      try {
        await expect(f.service().replay(f.context, input)).rejects.toThrow("FIXTURE_AUDIT_FAILED");
      } finally {
        await source.query("DROP TRIGGER fixture_deny_replay_audit ON audit_events");
        await source.query("DROP FUNCTION fixture_deny_replay_audit()");
      }
      expect((await f.current()).outboxStatus).toBe("DEAD");
      expect(
        await source.query("SELECT * FROM pilot_replay_decisions WHERE command_id=$1", [
          f.command.id,
        ]),
      ).toHaveLength(0);
      expect((await f.service().replay(f.context, input)).outcome).toBe("REQUEUED");
    });
    it("rechecks operator and original authority immediately before committing", async () => {
      const operator = await seedDeadLetterFixture(source),
        operatorInput = await operator.input();
      operator.state.revokeOnCall = 5;
      await expect(operator.service().replay(operator.context, operatorInput)).rejects.toThrow();
      expect((await operator.current()).outboxStatus).toBe("DEAD");
      const original = await seedDeadLetterFixture(source),
        originalInput = await original.input(),
        check = original.guard.check.bind(original.guard);
      original.guard.check = async (...args) => {
        const proof = await check(...args);
        original.state.originalAllowed = false;
        return proof;
      };
      await expect(original.service().replay(original.context, originalInput)).rejects.toThrow();
      expect((await original.current()).outboxStatus).toBe("DEAD");
    });
    it("dispatches a requeued original once through the shared durable dispatcher", async () => {
      const f = await seedDeadLetterFixture(source, { approval: true }),
        input = await f.input();
      await f.service().replay(f.context, input);
      const store = new TypeOrmCommandDeliveryStore(source);
      const claim = (
        await store.claim(f.state.now, new Date(f.state.now.getTime() + 30000), 100)
      ).find((value) => value.command.id === f.command.id)!;
      let invocations = 0;
      const invoke = () =>
        store.markDispatched(claim.outbox, f.state.now, 30000, undefined, async () => {
          invocations++;
        });
      const dispatched = await invoke();
      expect(dispatched.effectIdempotencyKey).toBe(f.command.effectIdempotencyKey);
      expect(dispatched.approvalId).toBe(f.command.approvalId);
      await expect(invoke()).rejects.toThrow();
      expect(invocations).toBe(1);
      const notDue = await store.quarantineExpiredConfirmation(
        {
          workspaceId: f.command.workspaceId,
          projectId: f.command.projectId,
          commandId: f.command.id,
        },
        "QA_COMPLETION_EFFECT_UNRESOLVED",
        f.state.now,
        { maximumAttempts: 1, maximumElapsedMs: 30000 },
      );
      expect(notDue).toBeUndefined();
      const quarantined = await store.quarantineExpiredConfirmation(
        {
          workspaceId: f.command.workspaceId,
          projectId: f.command.projectId,
          commandId: f.command.id,
        },
        "QA_COMPLETION_EFFECT_UNRESOLVED",
        new Date(f.state.now.getTime() + 30000),
        { maximumAttempts: 1, maximumElapsedMs: 30000 },
      );
      expect(quarantined).toMatchObject({
        status: "FAILED",
        outboxStatus: "DEAD",
        terminalResult: { code: "QA_COMPLETION_EFFECT_UNRESOLVED" },
        effectInvocationStartedAt: f.state.now,
      });
      expect(invocations).toBe(1);
    });
    it("rejects cross-scope queries, mutation of immutable records and low classification", async () => {
      const f = await seedDeadLetterFixture(source);
      await f.input();
      await expect(f.service().list({ ...f.context, projectId: randomUUID() })).rejects.toThrow();
      await expect(
        f.service().list({
          ...f.context,
          authorize: async (permission) => ({
            ...(await f.context.authorize(permission)),
            classificationCeiling: "PUBLIC",
          }),
        }),
      ).rejects.toThrow();
      await expect(
        source.query("UPDATE pilot_dead_letters SET owner_ref=$2 WHERE command_id=$1", [
          f.command.id,
          f.command.actor.principalId,
        ]),
      ).rejects.toThrow();
      await expect(f.service().list(f.context, { limit: 101 })).rejects.toThrow();
      await expect(f.service().list(f.context, { after: "forged-cursor" })).rejects.toThrow();
    });
    it("serves the scoped HTTP workflow with verified identity, CSRF, pagination and redacted failures", async () => {
      const f = await seedDeadLetterFixture(source);
      const app = await NestFactory.create(
        PilotDeadLetterModule.register({
          source,
          service: f.service(),
          identity: {
            authenticate: async (execution) => {
              const request = execution.switchToHttp().getRequest<QaSessionRequest>();
              if (
                request.headers.cookie !== "fixture-session=operator" ||
                (request.method === "POST" && request.headers["x-csrf-token"] !== "fixture-csrf")
              )
                throw new Error("PRIVATE_IDENTITY_CANARY");
              return async ({ scope, permission }) => {
                if (
                  scope.workspaceId !== f.context.workspaceId ||
                  scope.projectId !== f.context.projectId ||
                  !["pilot.replay.read", "pilot.replay.decide"].includes(permission)
                )
                  throw new Error("PRIVATE_SCOPE_CANARY");
                const access = await f.context.authorize(
                  permission as "pilot.replay.read" | "pilot.replay.decide",
                );
                return {
                  actor: {
                    kind: "HUMAN",
                    principalId: f.operator,
                    issuer: "https://fixture.invalid",
                    subject: f.operator,
                  },
                  basis: { ...access.basis, kind: "PROJECT" },
                  classificationCeiling: "CONFIDENTIAL",
                  scope,
                };
              };
            },
          },
        }),
        { logger: false, abortOnError: false },
      );
      try {
        await app.listen(0, "127.0.0.1");
        const path = `${await app.getUrl()}/api/v1/workspaces/${f.context.workspaceId}/projects/${f.context.projectId}/pilot`;
        const headers = {
          cookie: "fixture-session=operator",
          "content-type": "application/json",
          "x-csrf-token": "fixture-csrf",
        };
        expect((await fetch(`${path}/dead-letters`)).status).toBe(401);
        const list = await fetch(`${path}/dead-letters?limit=1`, { headers });
        expect(list.status).toBe(200);
        expect(list.headers.get("cache-control")).toContain("no-store");
        expect(await list.text()).not.toContain("PRIVATE_PROVIDER_PAYLOAD_CANARY");
        expect((await fetch(`${path}/dead-letters?limit=101`, { headers })).status).toBe(400);
        expect((await fetch(`${path}/dead-letters?payload=true`, { headers })).status).toBe(400);
        expect(
          (
            await fetch(`${path.replace(f.context.projectId, randomUUID())}/dead-letters`, {
              headers,
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await fetch(`${path}/dead-letters/${f.command.id}/diagnostics`, {
              method: "POST",
              headers: { cookie: headers.cookie },
            })
          ).status,
        ).toBe(401);
        const capture = await fetch(`${path}/dead-letters/${f.command.id}/diagnostics`, {
          method: "POST",
          headers,
          body: "{}",
        });
        expect(capture.status).toBe(201);
        const { recordRef } = (await capture.json()) as Awaited<ReturnType<typeof f.input>>;
        const body = JSON.stringify({
          commandId: f.command.id,
          recordRef,
          expectedRowVersion: f.command.rowVersion,
          requestKey: randomUUID(),
          reason: "DEPENDENCY_REPAIRED",
        });
        const post = () => fetch(`${path}/replay-decisions`, { method: "POST", headers, body });
        const first = await post(),
          retry = await post();
        expect(first.status).toBe(201);
        expect(await first.json()).toEqual(await retry.json());
        f.state.operatorAllowed = false;
        const denied = await post();
        expect(denied.status).toBe(403);
        expect(await denied.text()).not.toContain("CANARY");
      } finally {
        await app.close();
      }
    });
  },
);
