import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { createHmac, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NestFactory } from "../../../apps/api/node_modules/@nestjs/core/index.js";
import type { NestExpressApplication } from "../../../apps/api/node_modules/@nestjs/platform-express/index.js";
import { ProviderIngressModule } from "../../../apps/api/src/extensions/pilot/provider-ingress.module.ts";
import { canonicalize, type JsonValue } from "../../../packages/platform-contracts/src/index.ts";
import { createPlatformDataSource } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";
import { GitLabNativeIngressSource } from "../../../packages/runtime-composition/src/gitlab/corporate-ingress.ts";
import { JiraNativeIngressSource } from "../../../packages/runtime-composition/src/jira/corporate-ingress.ts";
import { MattermostCorporateIngressSource } from "../../../packages/runtime-composition/src/mattermost/corporate-ingress.ts";
import { ProviderIngressRuntime } from "../../../packages/runtime-composition/src/pilot/ingress-runtime.ts";
import {
  type ProviderIngressAuthority,
  TypeOrmProviderIngressAuthority,
} from "../../../packages/runtime-composition/src/pilot/provider-conformance.ts";
import {
  IngressHmacKeys,
  ingressRawHash,
  type ProviderIngressRequest,
  TrustedIngressAdapter,
  type TrustedIngressEnvelope,
} from "../../../packages/runtime-composition/src/pilot/trusted-ingress.ts";
import {
  qaLocalEntities,
  qaLocalMigrations,
} from "../../../packages/runtime-composition/src/qa/composition.ts";
import { ingressFixture } from "../../support/008-ingress.ts";
import { ingressTlsFixture } from "../../support/008-ingress-tls.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true").each(POSTGRES_TEST_IMAGES)(
  "008 provider ingress on %s",
  (image) => {
    let postgres: RunningPostgres, database: ReturnType<typeof createPlatformDataSource>;
    let tls: ReturnType<typeof ingressTlsFixture>;
    const apps: NestExpressApplication[] = [];
    beforeAll(async () => {
      tls = ingressTlsFixture();
      postgres = await startPostgres(image);
      database = createPlatformDataSource({
        url: postgres.url,
        entities: qaLocalEntities,
        migrations: qaLocalMigrations,
      });
      await database.initialize();
      await database.runMigrations({ transaction: "all" });
    }, 120000);
    afterAll(async () => {
      for (const app of apps) await app.close();
      if (database?.isInitialized) await database.destroy();
      await postgres?.stop();
      tls?.stop();
    });
    async function seed(f: ReturnType<typeof ingressFixture>) {
      const s = f.policy.subject;
      await database.query(
        "INSERT INTO workspaces(id,key,name,state) VALUES($1,$2,'Ingress fixture','ACTIVE')",
        [s.workspaceId, s.workspaceId],
      );
      await database.query(
        "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES($1,$2,$3,'Ingress fixture','ACTIVE','INTERNAL')",
        [s.projectId, s.workspaceId, s.projectId],
      );
      for (const [table, ref, content] of [
        ["connection", s.connectionRef, {}],
        ["connector_profile", s.profileRef, { connectionRef: s.connectionRef }],
      ] as const) {
        await database.query(
          `INSERT INTO ${table}_headers(id,workspace_id,key,current_published_version) VALUES($1,$2,$3,1)`,
          [ref.id, s.workspaceId, ref.id],
        );
        await database.query(
          `INSERT INTO ${table}_revisions(id,workspace_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,1,'PUBLISHED',$4,$5,now())`,
          [randomUUID(), s.workspaceId, ref.id, JSON.stringify(content), ref.contentHash],
        );
      }
      await database.query(
        "INSERT INTO project_integration_binding_headers(id,workspace_id,project_id,key,current_published_version) VALUES($1,$2,$3,$4,1)",
        [s.bindingRef.id, s.workspaceId, s.projectId, s.bindingRef.id],
      );
      await database.query(
        "INSERT INTO project_integration_binding_revisions(id,workspace_id,project_id,header_id,version,status,content,content_hash,created_at) VALUES($1,$2,$3,$4,1,'PUBLISHED',$5,$6,now())",
        [
          randomUUID(),
          s.workspaceId,
          s.projectId,
          s.bindingRef.id,
          JSON.stringify({ entries: [{ profileRef: s.profileRef }] }),
          s.bindingRef.contentHash,
        ],
      );
    }
    async function http(
      runtime: ProviderIngressRuntime,
      mode: "GATEWAY" | "RECEIVER",
      secure = false,
    ) {
      const app = await NestFactory.create<NestExpressApplication>(
        await ProviderIngressModule.register({ mode, runtimes: [runtime] }),
        { logger: false, rawBody: true, ...(secure ? { httpsOptions: tls.server } : {}) },
      );
      apps.push(app);
      await app.listen(0, "127.0.0.1");
      return { app, origin: await app.getUrl() };
    }
    async function send(
      origin: string,
      request: ProviderIngressRequest,
      envelope?: TrustedIngressEnvelope,
    ) {
      const response = await fetch(`${origin}${request.route}`, {
        method: "POST",
        headers: {
          ...request.headers,
          "content-type": request.contentType,
          ...(envelope
            ? {
                "x-awp-ingress-envelope": Buffer.from(JSON.stringify(envelope)).toString(
                  "base64url",
                ),
              }
            : {}),
        },
        body: Buffer.from(request.rawBody),
      });
      return {
        status: response.status,
        body: (await response.json()) as { status?: string; receiptId?: string; code?: string },
        cache: response.headers.get("cache-control"),
      };
    }
    const events = async (f: ReturnType<typeof ingressFixture>) =>
      database.query("SELECT * FROM event_outbox WHERE workspace_id=$1", [
        f.policy.subject.workspaceId,
      ]) as Promise<Array<{ envelope: Record<string, unknown> }>>;

    it.each(["JIRA", "GITLAB"] as const)(
      "mounts the explicitly selected native %s receiver without proxy fallback",
      async (provider) => {
        const f = ingressFixture(provider);
        await seed(f);
        const policy = { ...f.policy, transport: "NATIVE" as const };
        const source =
          provider === "JIRA"
            ? new JiraNativeIngressSource(policy, f.sourceKeys)
            : new GitLabNativeIngressSource(policy, f.sourceKeys);
        const runtime = new ProviderIngressRuntime(
          database,
          policy,
          f.conformance,
          f.authority,
          source,
          new TrustedIngressAdapter(policy, source, f.proxyKeys),
          () => f.now,
        );
        const host = await http(runtime, "RECEIVER");
        expect((await send(host.origin, { ...f.request(), headers: {} })).status).toBe(403);
        expect(
          (await send(host.origin, f.request(), await runtime.attest(f.request()))).status,
        ).toBe(403);
        expect((await send(host.origin, f.request())).body.status).toBe("ACCEPTED");
        expect((await send(host.origin, f.request())).body.status).toBe("DUPLICATE");
        expect(await events(f)).toHaveLength(1);
      },
    );

    it.each(["JIRA", "GITLAB"] as const)(
      "atomically deduplicates %s hints across concurrent delivery and restart",
      async (provider) => {
        const f = ingressFixture(provider);
        await seed(f);
        let allowed = true;
        const authority = new TypeOrmProviderIngressAuthority(
          database,
          async () => true,
          async () => {
            if (!allowed) throw new Error("REVOKED");
          },
        );
        const source =
          provider === "JIRA"
            ? new JiraNativeIngressSource(f.policy, f.sourceKeys)
            : new GitLabNativeIngressSource(f.policy, f.sourceKeys);
        const proxy = new TrustedIngressAdapter(f.policy, source, f.proxyKeys);
        const runtime = () =>
          new ProviderIngressRuntime(
            database,
            f.policy,
            f.conformance,
            authority,
            source,
            proxy,
            () => f.now,
          );
        let host = await http(runtime(), "RECEIVER");
        const envelope = await runtime().attest(f.request());
        expect((await send(host.origin, f.request())).status).toBe(403);
        const results = await Promise.all(
          Array.from({ length: 6 }, () => send(host.origin, f.request(), envelope)),
        );
        expect(results.filter((value) => value.body.status === "ACCEPTED")).toHaveLength(1);
        expect(results.filter((value) => value.body.status === "DUPLICATE")).toHaveLength(5);
        expect(await events(f)).toHaveLength(1);
        expect(results[0]!.cache).toBe("no-store");
        await host.app.close();
        await database.destroy();
        await database.initialize();
        host = await http(runtime(), "RECEIVER");
        expect((await send(host.origin, f.request(), envelope)).body.status).toBe("DUPLICATE");
        const changed =
          provider === "JIRA"
            ? f.request({ issue: { id: "10002", fields: { project: { id: "100" } } } })
            : f.request({
                object_attributes: {
                  id: 202,
                  status: "pending",
                  sha: "a".repeat(40),
                  updated_at: f.now.toISOString(),
                },
              });
        expect((await send(host.origin, changed, await runtime().attest(changed))).status).toBe(
          409,
        );
        if (provider === "JIRA") {
          const relabeled = {
            ...f.request(),
            headers: {
              ...f.request().headers,
              "x-atlassian-webhook-identifier": "different-unsigned-delivery",
            },
          };
          expect(
            (await send(host.origin, relabeled, await runtime().attest(relabeled))).body.status,
          ).toBe("DUPLICATE");
        }
        expect(await events(f)).toHaveLength(1);
        for (const [table, id] of [
          ["connection", f.policy.subject.connectionRef.id],
          ["connector_profile", f.policy.subject.profileRef.id],
          ["project_integration_binding", f.policy.subject.bindingRef.id],
        ]) {
          await database.query(
            `UPDATE ${table}_headers SET current_published_version=2 WHERE id=$1`,
            [id],
          );
          expect((await send(host.origin, f.request(), envelope)).status).toBe(403);
          await database.query(
            `UPDATE ${table}_headers SET current_published_version=1 WHERE id=$1`,
            [id],
          );
        }
        allowed = false;
        expect((await send(host.origin, f.request(), envelope)).status).toBe(403);
        expect(await events(f)).toHaveLength(1);
      },
      30000,
    );

    it("rolls receipts back with a failed outbox insert and rechecks authority after verification", async () => {
      const f = ingressFixture();
      await seed(f);
      const source = new JiraNativeIngressSource(f.policy, f.sourceKeys),
        proxy = new TrustedIngressAdapter(f.policy, source, f.proxyKeys);
      const runtime = new ProviderIngressRuntime(
          database,
          f.policy,
          f.conformance,
          f.authority,
          source,
          proxy,
          () => f.now,
        ),
        envelope = await runtime.attest(f.request());
      await database.query(
        "CREATE FUNCTION fixture_deny_ingress_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FIXTURE_OUTBOX_FAILED'; END $$",
      );
      await database.query(
        "CREATE TRIGGER fixture_deny_ingress_outbox BEFORE INSERT ON event_outbox FOR EACH ROW EXECUTE FUNCTION fixture_deny_ingress_outbox()",
      );
      try {
        await expect(runtime.accept(f.request(), envelope)).rejects.toThrow(
          "FIXTURE_OUTBOX_FAILED",
        );
      } finally {
        await database.query("DROP TRIGGER fixture_deny_ingress_outbox ON event_outbox");
        await database.query("DROP FUNCTION fixture_deny_ingress_outbox()");
      }
      expect(
        await database.query("SELECT * FROM webhook_receipts WHERE connector_key LIKE $1", [
          `%${f.policy.subject.connectionRef.id}`,
        ]),
      ).toHaveLength(0);
      expect(await events(f)).toHaveLength(0);
      expect((await runtime.accept(f.request(), envelope)).status).toBe("ACCEPTED");
      let calls = 0;
      const authority: ProviderIngressAuthority = {
        ...f.authority,
        assertCurrent: async () => {
          if (++calls === 2) throw new Error("REVOKED_AFTER_VERIFY");
        },
      };
      await expect(
        new ProviderIngressRuntime(
          database,
          f.policy,
          f.conformance,
          authority,
          source,
          proxy,
          () => f.now,
        ).accept(f.request(), envelope),
      ).rejects.toThrow("REVOKED_AFTER_VERIFY");
      expect(await events(f)).toHaveLength(1);
    });

    it.each(["POST_ACTION", "DIALOG_SUBMISSION"] as const)(
      "requires actual source mTLS, current human and original one-use %s intent",
      async (kind) => {
        const f = ingressFixture("MATTERMOST");
        await seed(f);
        let allowed = true;
        let now = f.now;
        const policy = {
          ...f.policy,
          sourceKeys: [
            {
              ...f.policy.sourceKeys[0]!,
              ref: { ...f.policy.sourceKeys[0]!.ref, contentHash: tls.fingerprint },
            },
          ],
        };
        const source = new MattermostCorporateIngressSource(
          database,
          policy,
          {
            assertCurrent: async () => {
              if (!allowed) throw new Error("HUMAN_REVOKED");
            },
          },
          kind,
        );
        const proxy = new TrustedIngressAdapter(
          policy,
          source,
          new IngressHmacKeys(policy, policy.proxyKeys, {
            use: async (_ref, consume) => consume(f.proxySecret),
          }),
        );
        const runtime = () =>
          new ProviderIngressRuntime(
            database,
            policy,
            f.conformance,
            f.authority,
            source,
            proxy,
            () => now,
          );
        const gateway = await http(runtime(), "GATEWAY", true),
          receiver = await http(runtime(), "RECEIVER");
        const intentId = randomUUID(),
          token = randomUUID(),
          actor = randomUUID();
        const body =
          kind === "POST_ACTION"
            ? {
                user_id: "human-1",
                team_id: "100",
                channel_id: "channel-1",
                post_id: "post-1",
                action_id: "approve",
                context: { intentToken: token },
              }
            : {
                user_id: "human-1",
                team_id: "100",
                channel_id: "channel-1",
                callback_id: "callback-1",
                state: token,
                submission: { choice: "accept" },
              };
        const request = (patch: Record<string, unknown> = {}): ProviderIngressRequest => ({
          route: policy.route,
          method: "POST",
          contentType: "application/json",
          headers: {},
          rawBody: Buffer.from(JSON.stringify({ ...body, ...patch })),
        });
        await database.query(
          "INSERT INTO interaction_intents(id,workspace_id,project_id,actor_principal_id,action,subject,transport,nonce_hash,token_handling,state,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'{}','PENDING',$9,$10)",
          [
            intentId,
            policy.subject.workspaceId,
            policy.subject.projectId,
            actor,
            JSON.stringify({ kind: "FIXTURE_REVIEW" }),
            JSON.stringify({ id: "request-1" }),
            JSON.stringify({
              kind: `MATTERMOST_${kind}`,
              externalUserId: "human-1",
              teamId: "100",
              channelId: "channel-1",
              postId: "post-1",
              actionId: "approve",
              callbackId: "callback-1",
              bindingRef: policy.subject.bindingRef,
              profileRef: policy.subject.profileRef,
              connectionRef: policy.subject.connectionRef,
            }),
            ingressRawHash(token),
            new Date(now.getTime() + 120000),
            now,
          ],
        );
        await expect(tls.post(gateway.origin, request(), "none")).rejects.toThrow();
        expect((await tls.post(gateway.origin, request(), "other")).status).toBe(403);
        const forged = { ...request(), headers: { "x-forwarded-client-cert": tls.fingerprint } };
        await expect(runtime().attest(forged)).rejects.toThrow("INGRESS_SOURCE_MTLS_REQUIRED");
        for (const patch of [
          { user_id: "other-human" },
          { team_id: "other-team" },
          { channel_id: "other-channel" },
          kind === "POST_ACTION"
            ? { action_id: "other-action" }
            : { callback_id: "other-callback" },
        ])
          expect((await tls.post(gateway.origin, request(patch))).status).toBe(403);
        const signed = await tls.post(gateway.origin, request());
        expect(signed.status).toBe(201);
        const envelope = signed.body as TrustedIngressEnvelope;
        expect(JSON.stringify(envelope)).not.toContain(token);
        await database.query(
          "CREATE FUNCTION fixture_deny_intent_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FIXTURE_INTENT_OUTBOX_FAILED'; END $$",
        );
        await database.query(
          "CREATE TRIGGER fixture_deny_intent_outbox BEFORE INSERT ON event_outbox FOR EACH ROW EXECUTE FUNCTION fixture_deny_intent_outbox()",
        );
        try {
          await expect(runtime().accept(request(), envelope)).rejects.toThrow(
            "FIXTURE_INTENT_OUTBOX_FAILED",
          );
        } finally {
          await database.query("DROP TRIGGER fixture_deny_intent_outbox ON event_outbox");
          await database.query("DROP FUNCTION fixture_deny_intent_outbox()");
        }
        expect(
          (
            (await database.query("SELECT state FROM interaction_intents WHERE id=$1", [
              intentId,
            ])) as Array<{ state: string }>
          )[0]!.state,
        ).toBe("PENDING");
        expect(await events(f)).toHaveLength(0);
        const accepted = await Promise.all(
          Array.from({ length: 4 }, () => send(receiver.origin, request(), envelope)),
        );
        expect(accepted.filter((value) => value.body.status === "ACCEPTED")).toHaveLength(1);
        expect(accepted.filter((value) => value.body.status === "DUPLICATE")).toHaveLength(3);
        await database.destroy();
        await database.initialize();
        expect((await runtime().accept(request(), envelope)).status).toBe("DUPLICATE");
        expect(await events(f)).toHaveLength(1);
        const rows = (await database.query(
          "SELECT raw_body FROM webhook_receipts WHERE connector_key LIKE $1",
          [`%${policy.subject.connectionRef.id}`],
        )) as Array<{ raw_body: Buffer }>;
        expect(rows.every((row) => row.raw_body.length === 0)).toBe(true);
        expect(
          (await tls.post(gateway.origin, request({ extra: "changed-raw-bytes" }))).status,
        ).toBe(409);
        allowed = false;
        expect((await send(receiver.origin, request(), envelope)).status).toBe(403);
        allowed = true;
        await database.query("UPDATE interaction_intents SET state='INVALIDATED' WHERE id=$1", [
          intentId,
        ]);
        expect((await send(receiver.origin, request(), envelope)).status).toBe(403);
        await database.query("UPDATE interaction_intents SET state='CONSUMED' WHERE id=$1", [
          intentId,
        ]);
        now = new Date(f.now.getTime() + 121000);
        expect((await tls.post(gateway.origin, request())).status).toBe(403);
        const freshStatement = { ...envelope.statement, signedAt: now.toISOString() };
        const freshEnvelope = {
          ...envelope,
          statement: freshStatement,
          signature: createHmac("sha256", f.proxySecret)
            .update(canonicalize(freshStatement as unknown as JsonValue))
            .digest("hex"),
        };
        expect((await send(receiver.origin, request(), freshEnvelope)).status).toBe(403);
      },
      30000,
    );
  },
);
