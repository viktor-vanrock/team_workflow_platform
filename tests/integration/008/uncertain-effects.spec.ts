import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createJiraDialect,
  JiraHttpRequestCreatePort,
  JiraRequestCreateService,
  JiraRestClient,
} from "../../../packages/connector-jira/src/index.ts";
import {
  JiraEffectRepository,
  PersistentJiraRequestCreatePort,
} from "../../../packages/connector-jira-persistence-typeorm/src/index.ts";
import { createPlatformDataSource } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";
import {
  qaJiraLocalEntities,
  qaJiraLocalMigrations,
} from "../../../packages/runtime-composition/src/qa/composition.ts";
import { uncertainGitLabFixture } from "../../support/008-uncertain-gitlab.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

// This HTTP provider deliberately creates a new issue for every POST. Effect
// counts come from the provider, independently of the application's ledger.
describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true").each(POSTGRES_TEST_IMAGES)(
  "008 uncertain Jira effects on %s",
  (image) => {
    let postgres: RunningPostgres, source: ReturnType<typeof createPlatformDataSource>;
    let server: ReturnType<typeof createServer>, origin: string;
    let issues: Array<{ id: string; fields: Record<string, unknown> }>,
      lost: boolean,
      visible: number,
      posts: number;
    beforeAll(async () => {
      postgres = await startPostgres(image);
      source = createPlatformDataSource({
        url: postgres.url,
        entities: qaJiraLocalEntities,
        migrations: qaJiraLocalMigrations,
      });
      await source.initialize();
      await source.runMigrations({ transaction: "all" });
      server = createServer((request, response) => {
        void (async () => {
          const url = new URL(request.url!, "http://fixture");
          const reply = (body: unknown) => {
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify(body));
          };
          if (request.method === "POST" && /\/issue$/u.test(url.pathname)) {
            let body = "";
            for await (const chunk of request) body += String(chunk);
            const fields = (JSON.parse(body) as { fields: Record<string, unknown> }).fields;
            posts++;
            const issue = { id: String(10000 + posts), fields };
            issues.push(issue);
            if (lost) {
              response.destroy();
              return;
            }
            reply({ id: issue.id, key: `QA-${posts}` });
            return;
          }
          if (request.method === "GET" && url.pathname.includes("/search")) {
            const matches = issues.slice(0, visible).map(({ id }) => ({ id }));
            reply({ issues: matches, total: matches.length, startAt: 0, nextPageToken: null });
            return;
          }
          const found = issues.find((issue) => url.pathname.endsWith(`/issue/${issue.id}`));
          if (request.method === "GET" && found) {
            reply({
              ...found,
              key: `QA-${found.id}`,
              updated: "2026-09-01T00:00:00Z",
              changelogId: "1",
            });
            return;
          }
          response.writeHead(404);
          response.end();
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
      issues = [];
      lost = true;
      visible = 10;
      posts = 0;
    });
    async function effect(dialect: "jira-cloud-v3" | "jira-dc-10-v2" = "jira-cloud-v3") {
      const id = randomUUID(),
        effectId = `effect:${id}`;
      const repository = () => new JiraEffectRepository(source);
      await repository().ensure({
        id,
        commandId: id,
        effectId,
        connectionRef: { id: "connection", version: 1 },
        profileRef: { id: "profile", version: 1 },
        operation: "request.create",
        targetHash: "sha256:target",
        payloadHash: "sha256:payload",
        marker: effectId,
        now: new Date(),
      });
      const port = () =>
        new JiraHttpRequestCreatePort({
          client: new JiraRestClient({
            baseUrl: origin,
            environment: "LOCAL",
            allowedOrigins: [origin],
            transport: fetch,
          }),
          dialect: createJiraDialect(dialect),
          projectId: "100",
          issueTypeId: "10001",
          markerFieldId: "customfield_10011",
        });
      const persistent = async () => {
        const now = new Date();
        const claim = await repository().claim(
          effectId,
          randomUUID(),
          now,
          new Date(now.getTime() + 60_000),
        );
        return new PersistentJiraRequestCreatePort(port(), repository(), claim);
      };
      const execute = async () =>
        new JiraRequestCreateService(await persistent()).execute({
          effectMarker: effectId,
          fields: { summary: "Uncertain effect" },
          subEffects: [],
        });
      const restart = async () => {
        await source.query(
          "UPDATE jira_effect_reconciliations SET lease_until=now()-interval '1 second' WHERE effect_id=$1",
          [effectId],
        );
        await source.destroy();
        await source.initialize();
      };
      return { effectId, repository, persistent, execute, restart };
    }
    it.each(["jira-cloud-v3", "jira-dc-10-v2"] as const)(
      "never treats delayed %s search as proof a lost write was absent",
      async (dialect) => {
        const value = await effect(dialect);
        await expect(value.execute()).rejects.toThrow();
        expect(posts).toBe(1);
        await value.restart();
        lost = false;
        visible = 0;
        expect(await value.execute()).toMatchObject({
          status: "AMBIGUOUS",
          reasonCode: "MARKER_VISIBILITY_UNKNOWN",
        });
        expect(posts).toBe(1);
        expect((await value.repository().byEffectId(value.effectId))?.state).toBe("AMBIGUOUS");
        await value.restart();
        visible = 10;
        await expect(value.execute()).rejects.toThrow("JIRA_EFFECT_AMBIGUOUS");
        expect(posts).toBe(1);
      },
    );
    it("recovers the exact marker after database restart without another write", async () => {
      const value = await effect();
      await expect(value.execute()).rejects.toThrow();
      await value.restart();
      lost = false;
      expect(await value.execute()).toMatchObject({
        status: "CONFIRMED",
        created: false,
        externalEntityId: issues[0]!.id,
      });
      expect((await value.repository().byEffectId(value.effectId))?.state).toBe("CONFIRMED");
      expect(posts).toBe(1);
    });
    it("quarantines multiple markers and prevents concurrent writes even with the same claim", async () => {
      const value = await effect();
      const port = await value.persistent();
      expect(await port.lookup(value.effectId)).toEqual({ state: "PROVEN_ABSENT" });
      await Promise.allSettled([
        port.create({ fields: {}, marker: value.effectId }),
        port.create({ fields: {}, marker: value.effectId }),
      ]);
      expect(posts).toBe(1);
      issues.push({ ...issues[0]!, id: "99999" });
      await value.restart();
      lost = false;
      expect(await value.execute()).toMatchObject({
        status: "AMBIGUOUS",
        reasonCode: "MARKER_MULTIPLE_MATCHES",
      });
      expect((await value.repository().byEffectId(value.effectId))?.state).toBe("AMBIGUOUS");
      expect(posts).toBe(1);
    });
  },
);

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true").each(POSTGRES_TEST_IMAGES)(
  "008 uncertain GitLab effects on %s",
  (image) => {
    it.each([
      "delayed",
      "zero",
      "multiple",
      "actual-sha",
      "forged-sha",
      "unavailable",
      "confirmation-rollback",
    ])(
      "recovers %s with one independent provider POST",
      async (scenario) => {
        const value = await uncertainGitLabFixture(image);
        try {
          if (scenario === "actual-sha") value.state.sha = "b".repeat(40);
          const worker = value.worker();
          await worker.dispatch(value.state.now);
          expect(await worker.work(value.state.now)).toBe("DEFERRED");
          expect(value.state.pipelines).toHaveLength(1);
          const initialReads = value.state.reads;
          expect(await value.worker().execute(value.scope, value.state.now)).toBe("DEFERRED");
          expect(value.state.reads).toBe(initialReads);
          await value.restart();
          value.state.visible = scenario === "zero" ? 0 : 1;
          if (scenario === "multiple") value.state.copies = 2;
          if (scenario === "forged-sha") value.state.forgedReceipt = true;
          if (scenario === "unavailable") value.state.readStatus = 503;
          if (["zero", "actual-sha", "unavailable"].includes(scenario))
            value.state.now = new Date("2026-09-01T08:02:05Z");
          if (scenario === "confirmation-rollback") {
            await value.source.query(
              "CREATE FUNCTION fixture_reject_gitlab_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='CONFIRMED' THEN RAISE EXCEPTION 'FIXTURE_CONFIRMATION_REJECTED'; END IF; RETURN NEW; END $$",
            );
            await value.source.query(
              "CREATE TRIGGER fixture_reject_gitlab_confirmation BEFORE UPDATE ON connector_commands FOR EACH ROW EXECUTE FUNCTION fixture_reject_gitlab_confirmation()",
            );
            await expect(value.worker().execute(value.scope, value.state.now)).rejects.toThrow(
              "FIXTURE_CONFIRMATION_REJECTED",
            );
            expect((await value.command())?.status).toBe("DISPATCHED");
            expect((await value.effect()).state).toBe("LOOKUP_REQUIRED");
            await value.source.query(
              "DROP TRIGGER fixture_reject_gitlab_confirmation ON connector_commands",
            );
            await value.source.query("DROP FUNCTION fixture_reject_gitlab_confirmation()");
            await value.restart();
          }
          let outcome;
          if (scenario === "delayed") {
            const before = value.state.reads;
            const results = await Promise.allSettled([
              value.worker().execute(value.scope, value.state.now),
              value.worker().execute(value.scope, value.state.now),
            ]);
            expect(
              results.some(
                (result) => result.status === "fulfilled" && result.value === "CONFIRMED",
              ),
            ).toBe(true);
            expect(value.state.reads - before).toBe(2); // One list and one marker read, despite two workers.
            outcome = "CONFIRMED";
          } else outcome = await value.worker().execute(value.scope, value.state.now);
          expect(outcome).toBe(
            ["delayed", "confirmation-rollback"].includes(scenario) ? "CONFIRMED" : "AMBIGUOUS",
          );
          expect((await value.command())?.status).toBe(
            outcome === "CONFIRMED" ? "CONFIRMED" : "FAILED",
          );
          expect((await value.effect()).state).toBe(
            outcome === "CONFIRMED" ? "CONFIRMED" : "AMBIGUOUS",
          );
          const reads = value.state.reads;
          await value.worker().recover(new Date(value.state.now.getTime() + 31_000));
          expect(value.state.pipelines).toHaveLength(1);
          expect(value.state.reads).toBe(reads);
        } finally {
          await value.stop();
        }
      },
      120_000,
    );
  },
);
