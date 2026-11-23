import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import { DurableWorkerLoops } from "../../../../apps/worker/src/app.module.ts";
import {
  measured,
  redactTelemetryAttributes,
  runSafeRuntimeEntrypoint,
  SafeNestLogger,
  StructuredLogger,
} from "../../../../packages/platform-runtime-nest/src/observability/telemetry.ts";

const captured = vi.hoisted(() => ({
  spans: [] as { name: string; attributes: Record<string, unknown> }[],
  measurements: [] as { instrument: string; value: number; attributes: Record<string, unknown> }[],
  statuses: [] as unknown[],
  ended: 0,
}));
vi.mock("../../../../packages/platform-runtime-nest/node_modules/@opentelemetry/api", () => ({
  SpanStatusCode: { OK: 1, ERROR: 2 },
  trace: {
    getTracer: () => ({
      startSpan: (name: string, options: { attributes: Record<string, unknown> }) => {
        captured.spans.push({ name, attributes: options.attributes });
        return {
          setStatus: (status: unknown) => {
            captured.statuses.push(status);
          },
          end: () => {
            captured.ended++;
          },
        };
      },
      startActiveSpan: (
        name: string,
        options: { attributes: Record<string, unknown> },
        work: (span: unknown) => unknown,
      ) => {
        captured.spans.push({ name, attributes: options.attributes });
        return work({
          setStatus: (status: unknown) => {
            captured.statuses.push(status);
          },
          end: () => {
            captured.ended++;
          },
        });
      },
    }),
  },
  metrics: {
    getMeter: () => ({
      createHistogram: () => ({
        record: (value: number, attributes: Record<string, unknown>) => {
          captured.measurements.push({ instrument: "latency", value, attributes });
        },
      }),
      createCounter: () => ({
        add: (value: number, attributes: Record<string, unknown>) => {
          captured.measurements.push({ instrument: "outcomes", value, attributes });
        },
      }),
    }),
  },
}));

describe("008 safe runtime telemetry", () => {
  let write: MockInstance<typeof process.stdout.write>;
  beforeEach(() => {
    captured.spans.length = 0;
    captured.measurements.length = 0;
    captured.statuses.length = 0;
    captured.ended = 0;
    write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const logs = () => write.mock.calls.map((call) => String(call[0])).join("");

  it("keeps project/request correlation in spans and logs while metric series remain bounded", async () => {
    for (let index = 0; index < 1000; index++)
      await measured(
        "http.request",
        {
          component: "api",
          workspaceId: `workspace-${index}`,
          projectId: `project-${index}`,
          correlationId: `request-${index}`,
          causationId: `cause-${index}`,
          version: index,
          reasonCode: `USER_REASON_${index}`,
        },
        async () => index,
      );
    const series = new Set(
      captured.measurements.map((measurement) => JSON.stringify(measurement.attributes)),
    );
    expect(series.size).toBe(1);
    expect(captured.measurements[0]?.attributes).toEqual({
      operation: "http.request",
      component: "api",
      outcome: "SUCCEEDED",
    });
    expect(captured.spans[999]?.attributes).toMatchObject({
      workspaceId: "workspace-999",
      projectId: "project-999",
      correlationId: "request-999",
      causationId: "cause-999",
    });
    expect(logs()).toContain('"correlationId":"request-999"');
    expect(captured.ended).toBe(1000);
  });

  it("normalizes dynamic operation/component names and never exports provider errors", async () => {
    const canary = "provider-error-canary-008";
    const failure = new Error(`https://credential:password@vault.internal ${canary}`, {
      cause: { token: canary },
    });
    await expect(
      measured(
        canary,
        { component: canary, reasonCode: canary, payload: canary, token: canary },
        async () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
    expect(captured.measurements[0]?.attributes).toEqual({
      operation: "other",
      component: "other",
      outcome: "FAILED",
    });
    expect(captured.spans[0]?.name).toBe("other");
    expect(captured.statuses).toEqual([{ code: 2 }]);
    expect(captured.ended).toBe(1);
    expect(JSON.stringify(captured) + logs()).not.toContain(canary);
    expect(logs()).not.toContain("credential");
  });

  it("drops unknown log messages, oversized identifiers, control characters and non-finite numbers", () => {
    new StructuredLogger().write("error", "raw-provider-canary", {
      workspaceId: "x".repeat(500),
      projectId: "line\nbreak",
      latencyMs: Infinity,
      version: NaN,
      reasonCode: "PROVIDER_CANARY",
    });
    expect(logs()).toContain("redacted.event");
    expect(logs()).not.toMatch(/raw-provider|PROVIDER_CANARY|line|Infinity|NaN|xxx/u);
    expect(
      redactTelemetryAttributes({
        operation: "record.publish",
        workspaceId: "workspace",
        latencyMs: 4,
      }),
    ).toEqual({ operation: "record.publish", workspaceId: "workspace", latencyMs: 4 });
  });

  it("uses safe Nest lifecycle logging without serializing arbitrary exception objects", () => {
    const hostile = {
      toString: () => {
        throw new Error("MUST_NOT_STRINGIFY");
      },
      password: "nest-canary-008",
    };
    const logger = new SafeNestLogger("api");
    logger.error(hostile, "stack nest-canary-008", "context nest-canary-008");
    logger.warn(hostile);
    logger.log(hostile);
    logger.debug(hostile);
    logger.verbose(hostile);
    logger.fatal(hostile);
    expect(logs()).not.toContain("nest-canary-008");
    expect(logs()).toContain("framework.error");
  });

  it("contains startup exceptions at the process entry boundary", async () => {
    expect(
      await runSafeRuntimeEntrypoint("api", async () => {
        throw new Error("startup-canary-008");
      }),
    ).toBe(false);
    expect(logs()).toContain("runtime.startup.failed");
    expect(logs()).not.toContain("startup-canary-008");
    expect(await runSafeRuntimeEntrypoint("worker", async () => undefined)).toBe(true);
  });

  it("continues durable worker contributions after a safe error and never calls console.error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let calls = 0;
    const success = {
      run: async () => {
        calls++;
      },
    };
    const failed = {
      run: async () => {
        throw new Error("worker-canary-008");
      },
    };
    await new DurableWorkerLoops([
      { key: "unknown-dynamic-key", recovery: failed, dispatcher: success, commands: success },
    ]).tick();
    expect(calls).toBe(2);
    expect(consoleError).not.toHaveBeenCalled();
    expect(logs()).toContain("worker.contribution.deferred");
    expect(logs()).not.toMatch(/worker-canary|unknown-dynamic-key/u);
  });
});
