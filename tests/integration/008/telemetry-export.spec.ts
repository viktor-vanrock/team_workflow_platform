import "../../../apps/api/node_modules/reflect-metadata/Reflect.js";

import { createServer } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Controller, Get, Module } from "../../../apps/api/node_modules/@nestjs/common/index.js";
import { NestFactory } from "../../../apps/api/node_modules/@nestjs/core/index.js";
import {
  context,
  metrics,
  trace,
} from "../../../packages/platform-runtime-nest/node_modules/@opentelemetry/api/build/src/index.js";
import {
  startTelemetry,
  type TelemetryRuntime,
} from "../../../packages/platform-runtime-nest/src/observability/bootstrap.ts";
import {
  InstrumentedRuntimeModule,
  SafeHttpTelemetryInterceptor,
  selectRuntimeTelemetry,
} from "../../../packages/platform-runtime-nest/src/observability/runtime-module.ts";
import { measured } from "../../../packages/platform-runtime-nest/src/observability/telemetry.ts";

@Controller("probe")
class ProbeController {
  @Get() read() {
    return { ok: true };
  }
}
@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe("008 actual SDK OTLP export", () => {
  let runtime: TelemetryRuntime | undefined;
  let server: ReturnType<typeof createServer> | undefined;
  afterEach(async () => {
    await runtime?.shutdown();
    runtime = undefined;
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
  async function setup() {
    const received: { path: string; data: unknown }[] = [];
    const state = { outage: false, hang: false };
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on("end", () => {
        if (state.hang) return;
        if (state.outage) {
          response.writeHead(503).end("Bearer SECRET_EXPORTER_CANARY");
          return;
        }
        received.push({ path: request.url!, data: JSON.parse(body) as unknown });
        response.writeHead(200, { "content-type": "application/json" }).end("{}");
      });
    });
    await new Promise<void>((resolve) => {
      server!.listen(0, "127.0.0.1", resolve);
    });
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const policy = {
      mode: "LOCAL_FIXTURE" as const,
      component: "api" as const,
      collectorOrigin: origin,
      deadlineMs: 200,
      exportIntervalMs: 1000,
      maximumQueueSize: 64,
      maximumBatchSize: 16,
      freshnessMs: 5000,
    };
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((value) => {
      output.push(String(value));
      return true;
    });
    runtime = await startTelemetry(policy, {
      authorizeExport: async (url) => new URL(url).origin === origin,
      headers: async () => ({}),
    });
    return { received, state, output, policy };
  }
  it("exports actual spans/metrics, preserves async parent context and removes canaries before transport", async () => {
    const { received } = await setup();
    expect(runtime!.health().ready).toBe(false);
    await measured(
      "http.request",
      {
        component: "api",
        workspaceId: "workspace",
        projectId: "project",
        correlationId: "durable-correlation",
        secret: "SECRET_EXPORTER_CANARY",
      },
      async () => {
        await Promise.resolve();
        await measured(
          "evidence.sign",
          { component: "api", causationId: "durable-cause" },
          async () => true,
        );
        const span = trace.getTracer("awp.platform").startSpan("Bearer SECRET_EXPORTER_CANARY");
        span.setAttribute("payload", "SECRET_EXPORTER_CANARY");
        span.recordException(new Error("SECRET_EXPORTER_CANARY"));
        span.setStatus({ code: 2, message: "SECRET_EXPORTER_CANARY" });
        span.end();
        metrics
          .getMeter("awp.platform")
          .createCounter("unknown.SECRET_EXPORTER_CANARY")
          .add(1, { token: "SECRET_EXPORTER_CANARY" });
      },
    );
    await runtime!.flush();
    expect(runtime!.health().ready).toBe(true);
    const text = JSON.stringify(received);
    expect(text).not.toContain("SECRET_EXPORTER_CANARY");
    expect(text).toContain("durable-correlation");
    expect(text).toContain("durable-cause");
    expect(received.map((item) => item.path)).toEqual(
      expect.arrayContaining(["/v1/traces", "/v1/metrics"]),
    );
    const traces = received
      .filter((item) => item.path === "/v1/traces")
      .map((item) => item.data) as {
      resourceSpans: {
        scopeSpans: {
          spans: { name: string; traceId: string; spanId: string; parentSpanId?: string }[];
        }[];
      }[];
    }[];
    const spans = traces.flatMap((batch) =>
      batch.resourceSpans.flatMap((resource) =>
        resource.scopeSpans.flatMap((scope) => scope.spans),
      ),
    );
    const parent = spans.find((span) => span.name === "http.request")!;
    const child = spans.find((span) => span.name === "evidence.sign")!;
    expect(child.traceId).toBe(parent.traceId);
    expect(child.parentSpanId).toBe(parent.spanId);
    const exportedMetrics = JSON.stringify(received.filter((item) => item.path === "/v1/metrics"));
    expect(exportedMetrics).not.toMatch(/workspaceId|projectId|correlationId|causationId/u);
  });
  it("degrades readiness on outage, bounds export time and leaves committed work intact", async () => {
    const { state, output } = await setup();
    let committed = 0;
    state.outage = true;
    await measured("record.publish", { component: "api" }, async () => {
      committed++;
    });
    await runtime!.flush();
    expect(runtime!.health()).toMatchObject({
      ready: false,
      reasonCode: "TELEMETRY_EXPORT_UNAVAILABLE",
    });
    expect(committed).toBe(1);
    state.outage = false;
    await measured("record.publish", { component: "api" }, async () => {
      committed++;
    });
    await runtime!.flush();
    expect(runtime!.health().ready).toBe(true);
    state.hang = true;
    const started = performance.now();
    await measured("record.publish", { component: "api" }, async () => {
      committed++;
    });
    await runtime!.flush();
    expect(performance.now() - started).toBeLessThan(2000);
    expect(committed).toBe(3);
    expect(runtime!.health().ready).toBe(false);
    expect(output.join("\n")).not.toContain("SECRET_EXPORTER_CANARY");
  });
  it("fails closed for invalid or denied Collector policy and prevents two global SDK owners", async () => {
    const { policy } = await setup();
    await expect(
      startTelemetry(policy, { authorizeExport: async () => true, headers: async () => ({}) }),
    ).rejects.toThrow("TELEMETRY_ALREADY_STARTED");
    await runtime!.shutdown();
    runtime = undefined;
    await expect(
      startTelemetry(
        { ...policy, exportIntervalMs: policy.deadlineMs },
        { authorizeExport: async () => true, headers: async () => ({}) },
      ),
    ).rejects.toThrow("TELEMETRY_POLICY_INVALID");
    await expect(
      startTelemetry(
        { ...policy, mode: "CORPORATE" },
        { authorizeExport: async () => true, headers: async () => ({}) },
      ),
    ).rejects.toThrow("TELEMETRY_POLICY_INVALID");
    await expect(
      startTelemetry(policy, { authorizeExport: async () => false, headers: async () => ({}) }),
    ).rejects.toThrow("TELEMETRY_ENDPOINT_DENIED");
  });
  it("instruments real Nest requests and flushes on app close; non-local boot requires explicit binding", async () => {
    const { received } = await setup();
    await expect(
      selectRuntimeTelemetry("api", { AWP_RUNTIME_PROFILE: "non-local" }),
    ).rejects.toThrow("CORPORATE_TELEMETRY_BINDING_REQUIRED");
    expect(
      await selectRuntimeTelemetry("api", { AWP_RUNTIME_PROFILE: "non-local" }, runtime!),
    ).toBe(runtime);
    const app = await NestFactory.create(InstrumentedRuntimeModule.compose(ProbeModule, runtime), {
      logger: false,
      abortOnError: false,
    });
    app.useGlobalInterceptors(new SafeHttpTelemetryInterceptor());
    try {
      await app.listen(0, "127.0.0.1");
      const correlationId = "11111111-1111-4111-8111-111111111111";
      const response = await fetch(`${await app.getUrl()}/probe`, {
        headers: { "x-correlation-id": correlationId },
      });
      expect(await response.json()).toEqual({ ok: true });
      expect(response.headers.get("x-correlation-id")).toBe(correlationId);
    } finally {
      await app.close();
    }
    expect(runtime!.health()).toMatchObject({ ready: false, reasonCode: "TELEMETRY_STOPPED" });
    expect(JSON.stringify(received)).toContain("http.request");
  });
});
