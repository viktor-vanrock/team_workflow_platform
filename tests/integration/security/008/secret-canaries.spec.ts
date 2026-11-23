import { createServer } from "node:http";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  coreEntities,
  coreMigrationRegistry,
  createPlatformDataSource,
  migrationClasses,
} from "../../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  context,
  metrics,
  trace,
} from "../../../../packages/platform-runtime-nest/node_modules/@opentelemetry/api/build/src/index.js";
import {
  startTelemetry,
  type TelemetryRuntime,
} from "../../../../packages/platform-runtime-nest/src/observability/bootstrap.ts";
import {
  measured,
  SafeNestLogger,
  StructuredLogger,
} from "../../../../packages/platform-runtime-nest/src/observability/telemetry.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../../packages/platform-testkit/src/postgres.ts";
import { VaultHttpClient } from "../../../../packages/runtime-composition/src/security/vault-http-client.ts";
import {
  secretAllowedUseHash,
  type VaultSecretMapping,
  VaultSecretResolver,
  type VaultSecretUse,
} from "../../../../packages/runtime-composition/src/security/vault-secret-resolver.ts";
import { seedDeadLetterFixture } from "../../../support/008-dead-letter.ts";
import { startVaultFixture008 } from "../../../support/008-vault-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../../testcontainers.config.ts";

const canary = "SECRET_CANARY_008_DO_NOT_EXPORT";
const ref = { id: "published", version: 1, contentHash: `sha256:${"a".repeat(64)}` as const };
const use: VaultSecretUse = {
  workspaceId: "w1",
  projectId: "p1",
  servicePrincipalId: "worker",
  purpose: "CONNECTOR_READ",
  profileRef: ref,
  connectionRef: ref,
  policyRef: ref,
};
const mapping: VaultSecretMapping = {
  ref,
  secretRef: "secret-ref:qa/read",
  use,
  mount: "secret",
  path: "qa/read",
  field: "credential",
  secretVersion: 3,
  maximumLeaseMs: 1000,
};

describe("008 actual output secret canaries", () => {
  let telemetry: TelemetryRuntime | undefined, server: ReturnType<typeof createServer> | undefined;
  afterEach(async () => {
    await telemetry?.shutdown();
    telemetry = undefined;
    server?.closeAllConnections();
    await new Promise<void>((resolve) => {
      if (server) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
    trace.disable();
    metrics.disable();
    context.disable();
    vi.restoreAllMocks();
  });

  it("removes canaries from actual logs, OTLP traces and metrics", async () => {
    const exported: string[] = [];
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += String(chunk);
      });
      request.on("end", () => {
        exported.push(body);
        response.writeHead(200, { "content-type": "application/json" }).end("{}");
      });
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", resolve);
    });
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      logs: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((value) => {
      logs.push(String(value));
      return true;
    });
    telemetry = await startTelemetry(
      {
        mode: "LOCAL_FIXTURE",
        component: "api",
        collectorOrigin: origin,
        deadlineMs: 200,
        exportIntervalMs: 1000,
        maximumQueueSize: 64,
        maximumBatchSize: 16,
        freshnessMs: 5000,
      },
      { authorizeExport: async (url) => new URL(url).origin === origin, headers: async () => ({}) },
    );
    await measured(
      "http.request",
      {
        component: "api",
        workspaceId: "workspace",
        projectId: "project",
        payload: canary,
        token: canary,
      },
      async () => {
        const span = trace.getTracer("awp.platform").startSpan(canary);
        span.setAttribute("password", canary);
        span.recordException(new Error(canary));
        span.setStatus({ code: 2, message: canary });
        span.end();
        metrics.getMeter("awp.platform").createCounter(canary).add(1, { authorization: canary });
      },
    );
    new StructuredLogger().write("error", "runtime.startup.failed", {
      token: canary,
      payload: canary,
    });
    new SafeNestLogger("api").error(new Error(canary), canary, canary);
    await telemetry.flush();
    const actual = JSON.stringify({ logs, exported });
    expect(exported.length).toBeGreaterThan(0);
    expect(actual).not.toContain(canary);
    expect(actual).not.toMatch(/password|authorization/u);
  });

  it("redacts secret-store response bodies and errors without retry or fallback", async () => {
    const fixture = await startVaultFixture008(),
      logs: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((value) => {
      logs.push(String(value));
      return true;
    });
    try {
      fixture.state.status = 503;
      fixture.state.credentials[mapping.path] = canary;
      const client = new VaultHttpClient({
        baseUrl: fixture.origin,
        namespace: "pilot/",
        mode: "LOCAL_FIXTURE",
        deadlineMs: 100,
        maximumResponseBytes: 8192,
        authorizeEndpoint: async () => true,
        credentials: {
          withToken: async (_use, _signal, consume) => consume(canary, Date.now() + 5000),
        },
      });
      const resolver = new VaultSecretResolver(client, use, [mapping], {
        authorize: async () => true,
        isCurrent: () => true,
      });
      const error = await resolver
        .resolve(mapping.secretRef, secretAllowedUseHash(mapping), new AbortController().signal)
        .catch((value: unknown) => value);
      new SafeNestLogger("api").error(error);
      expect(String(error)).toBe("Error: VAULT_REQUEST_FAILED");
      expect(fixture.requests).toHaveLength(1);
      expect(JSON.stringify(logs)).not.toContain(canary);
    } finally {
      await fixture.stop();
    }
  });
});

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true").each(POSTGRES_TEST_IMAGES)(
  "008 durable audit/evidence canaries on %s",
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
    it("keeps private command material out of dead-letter reports, audit and evidence records", async () => {
      const f = await seedDeadLetterFixture(source),
        input = await f.input();
      const report = await f.service().list(f.context);
      await f.service().replay(f.context, input);
      const [audit, records, decisions] = await Promise.all([
        source.query(
          "SELECT actor,action,outcome,reason_code,authorization_basis,attributes FROM audit_events WHERE workspace_id=$1",
          [f.command.workspaceId],
        ),
        source.query(
          "SELECT owner_ref,semantic_body,content_hash FROM pilot_dead_letters WHERE workspace_id=$1",
          [f.command.workspaceId],
        ),
        source.query(
          "SELECT actor_ref,semantic_body,content_hash FROM pilot_replay_decisions WHERE workspace_id=$1",
          [f.command.workspaceId],
        ),
      ]);
      const actual = JSON.stringify({ report, audit, records, decisions });
      expect(actual).not.toContain("PRIVATE_PROVIDER_PAYLOAD_CANARY");
      expect(actual).not.toContain(f.command.payloadHash);
      expect(actual).not.toContain(f.command.effectIdempotencyKey);
    });
  },
);
