import { randomUUID } from "node:crypto";
import { request } from "node:https";

import { describe, expect, it } from "vitest";

import { InMemoryDurableCommandStore } from "../../../packages/platform-core/src/commanding/connector-command.ts";
import {
  coreMigrationRegistry,
  createPlatformDataSource,
  migrationClasses,
  TypeOrmCommandRepository,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { startTelemetry } from "../../../packages/platform-runtime-nest/src/observability/bootstrap.ts";
import { measured } from "../../../packages/platform-runtime-nest/src/observability/telemetry.ts";
import { startPostgres } from "../../../packages/platform-testkit/src/postgres.ts";
import {
  type OutboundNetworkPolicy,
  PinnedNetworkTransport,
} from "../../../packages/runtime-composition/src/pilot/network-policy.ts";
import {
  CapabilityCommandRouter,
  createCommandSchedulingHint,
  reconstructCommandFromHint,
} from "../../../packages/runtime-composition/src/worker/contributions.ts";
import { startCollectorFixture } from "../../support/008-collector-fixture.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")("008 real secured Collector", () => {
  it("requires mTLS, receives SDK traces/metrics and applies Collector privacy processors", async () => {
    const collector = await startCollectorFixture();
    const postgres = await startPostgres(POSTGRES_TEST_IMAGES[0]);
    const source = createPlatformDataSource({
      url: postgres.url,
      entities: [],
      migrations: migrationClasses(coreMigrationRegistry),
    });
    const networkPolicy: OutboundNetworkPolicy = {
      ref: { id: "network-policy", version: 1, contentHash: `sha256:${"a".repeat(64)}` },
      mode: "LOCAL_FIXTURE",
      validUntil: new Date(Date.now() + 60_000).toISOString(),
      deadlineMs: 1500,
      maximumRequestBytes: 4096,
      maximumResponseBytes: 4096,
      endpoints: [
        {
          origin: collector.origin,
          addressRanges: ["127.0.0.1/32"],
          routes: ["/v1/traces", "/v1/metrics"].map((path) => ({
            path,
            match: "EXACT",
            methods: ["POST"],
            queryKeys: [],
          })),
        },
      ],
    };
    const network = new PinnedNetworkTransport(networkPolicy, { tls: collector.agentOptions });
    const runtime = await startTelemetry(
      {
        mode: "CORPORATE",
        component: "worker",
        collectorOrigin: collector.origin,
        deadlineMs: 1500,
        exportIntervalMs: 2000,
        maximumQueueSize: 64,
        maximumBatchSize: 16,
        freshnessMs: 6000,
      },
      {
        agentOptions: network.agentOptionsForOrigin(collector.origin),
        authorizeExport: (url, signal) => network.authorizeEndpoint(url, "POST", signal),
        headers: async () => ({}),
      },
    );
    try {
      const send = (clientCertificate: boolean) =>
        new Promise<number>((resolve, reject) => {
          const outbound = request(
            `${collector.origin}/v1/traces`,
            {
              method: "POST",
              ca: collector.agentOptions.ca,
              ...(clientCertificate
                ? { cert: collector.agentOptions.cert, key: collector.agentOptions.key }
                : {}),
              headers: { "content-type": "application/json" },
              timeout: 1500,
            },
            (response) => {
              response.resume();
              response.once("end", () => resolve(response.statusCode!));
            },
          );
          outbound.on("error", reject);
          outbound.on("timeout", () => outbound.destroy(new Error("TIMEOUT")));
          outbound.end(
            JSON.stringify({
              resourceSpans: [
                {
                  resource: {
                    attributes: [{ key: "password", value: { stringValue: "COLLECTOR_CANARY" } }],
                  },
                  scopeSpans: [
                    {
                      scope: { name: "awp.platform" },
                      spans: [
                        {
                          traceId: "a".repeat(32),
                          spanId: "b".repeat(16),
                          name: "http.request",
                          startTimeUnixNano: "1000000",
                          endTimeUnixNano: "2000000",
                          attributes: [
                            { key: "secret", value: { stringValue: "COLLECTOR_CANARY" } },
                          ],
                          events: [{ name: "COLLECTOR_CANARY", timeUnixNano: "1000001" }],
                          status: { code: 2, message: "COLLECTOR_CANARY" },
                        },
                      ],
                    },
                  ],
                },
              ],
            }),
          );
        });
      await expect(send(false)).rejects.toThrow();
      expect(await send(true)).toBe(200);
      const post = { method: "POST", headers: { "content-type": "application/json" }, body: "{}" };
      expect((await network.fetch(`${collector.origin}/v1/traces`, post)).status).toBe(200);
      const untrusted = new PinnedNetworkTransport(networkPolicy, {
        tls: { cert: collector.agentOptions.cert, key: collector.agentOptions.key },
      });
      await expect(untrusted.fetch(`${collector.origin}/v1/traces`, post)).rejects.toThrow(
        "NETWORK_REQUEST_DENIED",
      );
      const wrongOrigin = collector.origin.replace("127.0.0.1", "wrong.example");
      const wrongName = new PinnedNetworkTransport(
        { ...networkPolicy, endpoints: [{ ...networkPolicy.endpoints[0]!, origin: wrongOrigin }] },
        { tls: collector.agentOptions, resolve: async () => ["127.0.0.1"] },
      );
      await expect(wrongName.fetch(`${wrongOrigin}/v1/traces`, post)).rejects.toThrow(
        "NETWORK_REQUEST_DENIED",
      );
      await source.initialize();
      await source.runMigrations({ transaction: "all" });
      const workspaceId = randomUUID();
      const projectId = randomUUID();
      await source.query(
        "INSERT INTO workspaces(id,key,name,state) VALUES($1,'telemetry','Telemetry','ACTIVE')",
        [workspaceId],
      );
      await source.query(
        "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES($1,$2,'p','P','ACTIVE','INTERNAL')",
        [projectId, workspaceId],
      );
      const command = {
        ...InMemoryDurableCommandStore.readyFixture().command(),
        id: randomUUID(),
        workspaceId,
        projectId,
        correlationId: randomUUID(),
        causationId: randomUUID(),
        payload: { secret: "SDK_CANARY" },
      };
      await measured(
        "http.request",
        {
          component: "api",
          workspaceId,
          projectId,
          correlationId: command.correlationId,
          causationId: command.causationId,
        },
        () => new TypeOrmCommandRepository(source).insert(command),
      );
      const hint = createCommandSchedulingHint(command);
      await source.destroy();
      await source.initialize();
      const restored = await reconstructCommandFromHint(hint, (scope) =>
        new TypeOrmCommandRepository(source).get(
          scope.workspaceId,
          scope.projectId,
          scope.commandId,
        ),
      );
      const router = new CapabilityCommandRouter([
        {
          key: "telemetry-fixture",
          capabilityKeys: [command.capability.key],
          recovery: { markedEffectPolicy: "SAFE_RETRY" },
          handle: async () => "handled",
        },
      ]);
      expect(await router.route(restored)).toBe("handled");
      await runtime.flush();
      expect(runtime.health().ready).toBe(true);
      await expect
        .poll(() => collector.output(), { timeout: 8000, interval: 100 })
        .toContain(command.correlationId);
      await expect
        .poll(() => collector.output(), { timeout: 8000, interval: 100 })
        .toContain("awp.operation.outcomes");
      expect(collector.output()).toContain(command.causationId);
      expect(collector.output()).toContain("worker.commands");
      expect(collector.output()).not.toMatch(/COLLECTOR_CANARY|SDK_CANARY/u);
    } finally {
      await runtime.shutdown();
      if (source.isInitialized) await source.destroy();
      await postgres.stop();
      await collector.stop();
    }
  }, 180_000);
});
