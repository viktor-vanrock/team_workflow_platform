import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  GitLabAuth,
  type GitLabConnectionConfiguration,
  gitLabOperationIdentityRouting,
  GitLabRestClient,
} from "../../../packages/connector-gitlab/src/index.ts";
import { TypeOrmGitLabReconciliationRepository } from "../../../packages/connector-gitlab-persistence-typeorm/src/index.ts";
import {
  createPlatformDataSource,
  migrationClasses,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";
import {
  qaJiraGitLabLocalComposition,
  qaJiraGitLabLocalMigrationRegistry,
} from "../../../packages/runtime-composition/src/gitlab/composition.ts";
import { TypeOrmGitLabAuthoritativeReadOutboxWorker } from "../../../packages/runtime-composition/src/gitlab/reconciliation-worker.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

const ref = (id = randomUUID()) => ({ id, version: 1, contentHash: `sha256:${"a".repeat(64)}` });
const common = {
  ownerRef: "team:qa",
  rotationPolicyRef: "rotation",
  revocationRunbookRef: "revoke",
};
const connection: GitLabConnectionConfiguration = {
  schemaVersion: "gitlab-connection-configuration@1.0.0",
  operationIdentityRouting: gitLabOperationIdentityRouting,
  identitySeparationEvidenceHash: `sha256:${"d".repeat(64)}`,
  identityReferences: {
    read: {
      ...common,
      reference: "secretref://fixture/read",
      referenceFingerprint: `sha256:${"a".repeat(64)}`,
      identityKind: "NON_HUMAN_PROJECT",
      scope: "read_api",
      nonHumanIdentityEvidenceRef: "proof:read",
    },
    trigger: {
      ...common,
      reference: "secretref://fixture/trigger",
      referenceFingerprint: `sha256:${"b".repeat(64)}`,
      identityKind: "NON_HUMAN_PROJECT",
      scope: "pipeline_trigger",
      nonHumanIdentityEvidenceRef: "proof:trigger",
    },
    webhook: {
      ...common,
      reference: "secretref://fixture/webhook",
      referenceFingerprint: `sha256:${"c".repeat(64)}`,
      identityMaterialKind: "STANDARD_WEBHOOK_HMAC_KEY",
      keyVersionRef: "key:webhook",
    },
  },
};

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true").each(POSTGRES_TEST_IMAGES)(
  "008 durable retry with real HTTP on %s",
  (image) => {
    let postgres: RunningPostgres, source: ReturnType<typeof createPlatformDataSource>;
    let server: ReturnType<typeof createServer>, origin: string;
    let status: number,
      retryAfter: string | undefined,
      hang: boolean,
      drop: boolean,
      calls: string[],
      leases: string[],
      now: Date;
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
        calls.push(request.method ?? "UNKNOWN");
        if (drop) {
          response.destroy();
          return;
        }
        if (hang) return;
        response.writeHead(status, {
          "content-type": "application/json",
          ...(retryAfter === undefined ? {} : { "retry-after": retryAfter }),
        });
        response.end(
          JSON.stringify(status === 200 ? { id: 42 } : { error: "SECRET_PROVIDER_CANARY" }),
        );
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
      status = 503;
      retryAfter = undefined;
      hang = false;
      drop = false;
      calls = [];
      leases = [];
      now = new Date();
    });
    async function job() {
      const workspaceId = randomUUID(),
        projectId = randomUUID(),
        id = randomUUID(),
        profileRef = ref(),
        connectionRef = ref();
      await source.query(
        "INSERT INTO workspaces(id,key,name,state) VALUES($1,$2,'Retry fixture','ACTIVE')",
        [workspaceId, workspaceId],
      );
      await source.query(
        "INSERT INTO projects(id,workspace_id,key,name,state,classification_key,registration_status) VALUES($1,$2,$3,'Retry fixture','ACTIVE','INTERNAL','ACTIVE')",
        [projectId, workspaceId, projectId],
      );
      const envelope = {
        schemaVersion: "gitlab-authoritative-read-request@1.0.0",
        receiptId: randomUUID(),
        signal: { deliveryId: randomUUID(), externalPipelineId: 42, numericGitLabProjectId: 5001 },
        profileRef,
        connectionRef,
      };
      await source.query(
        "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,'gitlab.authoritative-read.requested.v1',$4,$5,'READY',$6)",
        [id, workspaceId, projectId, envelope, ref().contentHash, now],
      );
      const client = new GitLabRestClient({
        baseUrl: origin,
        numericProjectId: 5001,
        environmentClass: "LOCAL",
        allowedOrigins: [origin],
        requestTimeoutMs: 150,
        clock: { now: () => now },
        auth: new GitLabAuth(connection, {
          resolve: async (reference) => {
            leases.push(reference);
            return {
              metadata: {},
              use: async (_time, consume) =>
                consume(new TextEncoder().encode("fixture-read-credential")),
            };
          },
        }),
      });
      const worker = () =>
        new TypeOrmGitLabAuthoritativeReadOutboxWorker(
          source,
          {
            read: async () => {
              await client.get("/api/v4/projects/5001/pipelines/42");
              return undefined;
            },
          },
          { now: () => now },
        );
      const state = async () =>
        (
          await source.query("SELECT state,envelope,envelope_hash FROM event_outbox WHERE id=$1", [
            id,
          ])
        )[0];
      const snapshots = async () =>
        (await source.query(
          "SELECT decision,error_code,http_status,next_eligible_at FROM gitlab_rate_limit_snapshots WHERE workspace_id=$1 ORDER BY observed_at",
          [workspaceId],
        )) as Record<string, unknown>[];
      return {
        id,
        workspaceId,
        projectId,
        profileRef,
        connectionRef,
        envelope,
        worker,
        state,
        snapshots,
      };
    }
    it("executes the 401/403/429/5xx and business failure matrix without writes or credential escalation", async () => {
      for (const code of [401, 403, 400, 404, 409, 412, 422, 501, 429, 500, 502, 503, 504]) {
        const value = await job();
        status = code;
        const before = calls.length;
        const retryable = [429, 500, 502, 503, 504].includes(code);
        expect(await value.worker().runOne()).toBe(
          [401, 403].includes(code) ? "AUTH_DEGRADED" : retryable ? "BACKOFF" : "UNAVAILABLE",
        );
        expect(calls.length - before).toBe(1);
        expect((await value.state()).state).toBe(retryable ? "READY" : "FAILED");
        expect(await value.worker().runOne()).toBe(retryable ? "BACKOFF" : "IDLE");
        expect(calls.length - before).toBe(1);
        if (retryable) {
          now = new Date(now.getTime() + 2000);
          status = 200;
          expect(await value.worker().runOne()).toBe("IGNORED");
        }
      }
      expect(new Set(calls)).toEqual(new Set(["GET"]));
      expect(new Set(leases)).toEqual(new Set(["secretref://fixture/read"]));
    });
    it("keeps four attempts across database/worker restart without charging unrelated observations", async () => {
      const value = await job();
      const original = await value.state();
      for (let attempt = 1; attempt <= 4; attempt++) {
        expect(await value.worker().runOne()).toBe(attempt < 4 ? "BACKOFF" : "UNAVAILABLE");
        expect(calls).toHaveLength(attempt);
        if (attempt < 4) {
          now = new Date(now.getTime() + 8000);
          await new TypeOrmGitLabReconciliationRepository(source).appendRateLimitSnapshot({
            rateLimitSnapshotId: randomUUID(),
            scope: {
              workspaceId: value.workspaceId,
              connectionHeaderId: value.connectionRef.id,
              numericProjectId: 5001,
            },
            profileRef: value.profileRef,
            lane: "READ",
            httpStatus: 200,
            decision: "AVAILABLE",
            observedAt: now.toISOString(),
            contentHash: `sha256:${String(attempt).repeat(64)}`,
          });
          now = new Date(now.getTime() + 1);
          await source.destroy();
          await source.initialize();
        }
      }
      expect((await value.snapshots()).at(-1)).toMatchObject({
        error_code: "RETRY_BUDGET_EXHAUSTED",
      });
      expect(await value.state()).toEqual({ ...original, state: "FAILED" });
      expect(await value.worker().runOne()).toBe("IDLE");
      expect(calls).toHaveLength(4);
    });
    it("honors Retry-After across restart and stops oversized or invalid hints", async () => {
      retryAfter = "17";
      status = 429;
      const value = await job();
      expect(await value.worker().runOne()).toBe("BACKOFF");
      await source.destroy();
      await source.initialize();
      now = new Date(now.getTime() + 16_000);
      await new TypeOrmGitLabReconciliationRepository(source).appendRateLimitSnapshot({
        rateLimitSnapshotId: randomUUID(),
        scope: {
          workspaceId: value.workspaceId,
          connectionHeaderId: value.connectionRef.id,
          numericProjectId: 5001,
        },
        profileRef: value.profileRef,
        lane: "READ",
        decision: "AVAILABLE",
        observedAt: now.toISOString(),
        contentHash: `sha256:${"e".repeat(64)}`,
      });
      expect(await value.worker().runOne()).toBe("BACKOFF");
      expect(calls).toHaveLength(1);
      now = new Date(now.getTime() + 1000);
      status = 200;
      expect(await value.worker().runOne()).toBe("IGNORED");
      for (const hint of [
        "60",
        "broken",
        "999999999999999999999999999999",
        new Date(now.getTime() + 120_000).toUTCString(),
      ]) {
        const next = await job();
        status = 429;
        retryAfter = hint;
        const before = calls.length;
        expect(await next.worker().runOne()).toBe("UNAVAILABLE");
        expect((await next.state()).state).toBe("FAILED");
        expect(await next.worker().runOne()).toBe("IDLE");
        expect(calls.length - before).toBe(1);
      }
    });
    it("expires a stalled retry before making another HTTP request", async () => {
      const value = await job();
      expect(await value.worker().runOne()).toBe("BACKOFF");
      now = new Date(now.getTime() + 300_000);
      await source.destroy();
      await source.initialize();
      expect(await value.worker().runOne()).toBe("UNAVAILABLE");
      expect(calls).toHaveLength(1);
      expect((await value.state()).state).toBe("FAILED");
    });
    it("retries actual transport timeout and reset only within the original read budget", async () => {
      for (const fault of ["timeout", "reset"]) {
        const value = await job();
        hang = fault === "timeout";
        drop = fault === "reset";
        expect(await value.worker().runOne()).toBe("BACKOFF");
        expect(await value.snapshots()).toEqual([
          expect.objectContaining({
            error_code: fault === "timeout" ? "GITLAB_TIMEOUT" : "GITLAB_NETWORK_ERROR",
          }),
        ]);
        hang = false;
        drop = false;
        status = 200;
        now = new Date(now.getTime() + 2000);
        expect(await value.worker().runOne()).toBe("IGNORED");
      }
      expect(new Set(calls)).toEqual(new Set(["GET"]));
    });
    it("persists an assertion/type error as terminal rather than retrying a business handler", async () => {
      const value = await job();
      let invoked = 0;
      const worker = new TypeOrmGitLabAuthoritativeReadOutboxWorker(
        source,
        {
          read: async () => {
            invoked++;
            throw new TypeError("ASSERTION_SECRET_CANARY");
          },
        },
        { now: () => now },
      );
      expect(await worker.runOne()).toBe("UNAVAILABLE");
      expect(await worker.runOne()).toBe("IDLE");
      expect(invoked).toBe(1);
      expect((await value.state()).state).toBe("FAILED");
      expect(JSON.stringify(await value.snapshots())).not.toContain("SECRET_CANARY");
      expect(calls).toHaveLength(0);
    });
  },
);
