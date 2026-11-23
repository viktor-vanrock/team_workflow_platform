import type { AgentOptions } from "node:https";

import { type Attributes, context, diag, metrics, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  type ExportResult,
  ExportResultCode,
  setGlobalErrorHandler,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
  type ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import {
  AlwaysOnSampler,
  BatchSpanProcessor,
  NodeTracerProvider,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-node";

import { redactTelemetryAttributes } from "./telemetry.ts";

export interface TelemetryPolicy {
  readonly mode: "LOCAL_FIXTURE" | "CORPORATE";
  readonly component: "api" | "worker";
  readonly collectorOrigin: string;
  readonly deadlineMs: number;
  readonly exportIntervalMs: number;
  readonly maximumQueueSize: number;
  readonly maximumBatchSize: number;
  readonly freshnessMs: number;
}
export interface TelemetryTransport {
  /** Must apply the deployment network policy; called again before each export. */
  authorizeExport(url: string, signal: AbortSignal): Promise<boolean>;
  /** Runtime credential resolution only. No credential belongs in TelemetryPolicy. */
  headers(signal: AbortSignal): Promise<Readonly<Record<string, string>>>;
  readonly agentOptions?: AgentOptions;
}
export interface TelemetryRuntime {
  health(): Readonly<{
    ready: boolean;
    reasonCode:
      "READY" | "TELEMETRY_EXPORT_UNAVAILABLE" | "TELEMETRY_NOT_OBSERVED" | "TELEMETRY_STOPPED";
  }>;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}
let running = false;
const failedExport: ExportResult = Object.freeze({ code: ExportResultCode.FAILED });
const metricAttributes = (attributes: Attributes): Attributes => {
  const value = redactTelemetryAttributes(attributes);
  return {
    operation: value.operation ?? "other",
    component: value.component ?? "other",
    outcome: value.outcome ?? "FAILED",
  };
};

async function bounded<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("TELEMETRY_EXPORT_UNAVAILABLE")), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Explicit SDK providers: no environment resource detectors or automatic HTTP/payload instrumentation. */
export async function startTelemetry(
  policy: TelemetryPolicy,
  transport: TelemetryTransport,
): Promise<TelemetryRuntime> {
  if (running) throw new Error("TELEMETRY_ALREADY_STARTED");
  policy = Object.freeze({ ...policy });
  try {
    const url = new URL(policy.collectorOrigin);
    if (
      url.origin !== policy.collectorOrigin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["api", "worker"].includes(policy.component) ||
      !["LOCAL_FIXTURE", "CORPORATE"].includes(policy.mode) ||
      (policy.mode === "CORPORATE"
        ? url.protocol !== "https:"
        : url.protocol !== "http:" || !["127.0.0.1", "otel-collector"].includes(url.hostname)) ||
      !Number.isSafeInteger(policy.deadlineMs) ||
      policy.deadlineMs < 100 ||
      policy.deadlineMs > 10_000 ||
      !Number.isSafeInteger(policy.exportIntervalMs) ||
      policy.exportIntervalMs < policy.deadlineMs + 50 ||
      policy.exportIntervalMs > 60_000 ||
      !Number.isSafeInteger(policy.maximumQueueSize) ||
      policy.maximumQueueSize < 16 ||
      policy.maximumQueueSize > 2048 ||
      !Number.isSafeInteger(policy.maximumBatchSize) ||
      policy.maximumBatchSize < 1 ||
      policy.maximumBatchSize > Math.min(128, policy.maximumQueueSize) ||
      !Number.isSafeInteger(policy.freshnessMs) ||
      policy.freshnessMs < policy.exportIntervalMs * 2 ||
      policy.freshnessMs > 300_000 ||
      transport.agentOptions?.rejectUnauthorized === false
    )
      throw new Error();
  } catch {
    throw new Error("TELEMETRY_POLICY_INVALID");
  }
  const endpoints = {
    traces: `${policy.collectorOrigin}/v1/traces`,
    metrics: `${policy.collectorOrigin}/v1/metrics`,
  };
  const allowed = await bounded(
    Promise.all(
      Object.values(endpoints).map((url) =>
        transport.authorizeExport(url, AbortSignal.timeout(policy.deadlineMs)),
      ),
    ),
    policy.deadlineMs,
  ).catch(() => []);
  if (allowed.length !== 2 || allowed.some((value) => !value))
    throw new Error("TELEMETRY_ENDPOINT_DENIED");
  // Reserve the process-level API after asynchronous policy validation as well.
  if (running) throw new Error("TELEMETRY_ALREADY_STARTED");
  running = true;
  let stopped = false;
  let shuttingDown: Promise<void> | undefined;
  const receipt: Record<"traces" | "metrics", { at: number; ok: boolean } | undefined> = {
    traces: undefined,
    metrics: undefined,
  };
  const fail = () => {
    const value = { at: Date.now(), ok: false };
    receipt.traces = value;
    receipt.metrics = value;
  };
  diag.disable();
  setGlobalErrorHandler(fail);
  const resource = resourceFromAttributes({
    "service.name": `awp-${policy.component}`,
    "service.namespace": "awp",
  });
  const manager = new AsyncLocalStorageContextManager();
  const options = (url: string) => ({
    url,
    timeoutMillis: policy.deadlineMs,
    concurrencyLimit: 1,
    keepAlive: false,
    httpAgentOptions: {
      ...transport.agentOptions,
      keepAlive: false,
      maxSockets: 2,
      rejectUnauthorized: true,
    },
    headers: async () => {
      const signal = AbortSignal.timeout(policy.deadlineMs);
      const headers = await bounded(
        (async () => {
          if (!(await transport.authorizeExport(url, signal)))
            throw new Error("TELEMETRY_ENDPOINT_DENIED");
          return await transport.headers(signal);
        })(),
        policy.deadlineMs,
      );
      if (
        Object.keys(headers).some(
          (name) => !["authorization", "x-api-key"].includes(name.toLowerCase()),
        ) ||
        Object.values(headers).some(
          (value) => !value || value.length > 8192 || /[\r\n]/u.test(value),
        )
      )
        throw new Error("TELEMETRY_CREDENTIAL_INVALID");
      return { ...headers };
    },
  });
  const rawTraces = new OTLPTraceExporter(options(endpoints.traces));
  const rawMetrics = new OTLPMetricExporter(options(endpoints.metrics));
  const record =
    (signal: "traces" | "metrics", callback: (value: ExportResult) => void) =>
    (result: ExportResult) => {
      receipt[signal] = { at: Date.now(), ok: result.code === ExportResultCode.SUCCESS };
      callback(
        result.code === ExportResultCode.SUCCESS
          ? { code: ExportResultCode.SUCCESS }
          : failedExport,
      );
    };
  const cleanSpan = (span: ReadableSpan): ReadableSpan => {
    const sc = span.spanContext();
    const pc = span.parentSpanContext;
    return {
      ...span,
      name: String(redactTelemetryAttributes({ operation: span.name }).operation),
      attributes: redactTelemetryAttributes(span.attributes),
      status: { code: span.status.code },
      events: [],
      links: [],
      resource,
      instrumentationScope: { name: "awp.platform", version: "1.0.0" },
      spanContext: () => ({ traceId: sc.traceId, spanId: sc.spanId, traceFlags: sc.traceFlags }),
      ...(pc
        ? {
            parentSpanContext: {
              traceId: pc.traceId,
              spanId: pc.spanId,
              traceFlags: pc.traceFlags,
            },
          }
        : {}),
    };
  };
  const traceExporter: SpanExporter = {
    export: (spans, callback) => {
      try {
        rawTraces.export(
          spans.filter((span) => span.instrumentationScope.name === "awp.platform").map(cleanSpan),
          record("traces", callback),
        );
      } catch {
        record("traces", callback)(failedExport);
      }
    },
    shutdown: () => rawTraces.shutdown(),
    forceFlush: () => rawTraces.forceFlush(),
  };
  const cleanMetrics = (data: ResourceMetrics): ResourceMetrics => ({
    resource,
    scopeMetrics: data.scopeMetrics
      .filter((scope) => scope.scope.name === "awp.platform")
      .map((scope) => ({
        scope: { name: "awp.platform", version: "1.0.0" },
        metrics: scope.metrics
          .filter((metric) =>
            ["awp.operation.latency", "awp.operation.outcomes"].includes(metric.descriptor.name),
          )
          .map(
            (metric) =>
              ({
                ...metric,
                descriptor: {
                  ...metric.descriptor,
                  description: "",
                  unit: metric.descriptor.name === "awp.operation.latency" ? "ms" : "",
                },
                dataPoints: metric.dataPoints.map((point) => ({
                  ...point,
                  attributes: metricAttributes(point.attributes),
                })),
              }) as typeof metric,
          ),
      })),
  });
  const metricExporter: PushMetricExporter = {
    export: (data, callback) => {
      try {
        rawMetrics.export(cleanMetrics(data), record("metrics", callback));
      } catch {
        record("metrics", callback)(failedExport);
      }
    },
    selectAggregationTemporality: (kind) => rawMetrics.selectAggregationTemporality(kind),
    forceFlush: () => rawMetrics.forceFlush(),
    shutdown: () => rawMetrics.shutdown(),
  };
  const reader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: policy.exportIntervalMs,
    exportTimeoutMillis: policy.deadlineMs + 50,
    cardinalityLimits: { default: 256 },
    maxExportBatchSize: 256,
  });
  const meter = new MeterProvider({
    resource,
    readers: [reader],
    views: [
      {
        instrumentName: "*",
        aggregationCardinalityLimit: 256,
        attributesProcessors: [{ process: metricAttributes }],
      },
    ],
  });
  const tracer = new NodeTracerProvider({
    resource,
    sampler: new AlwaysOnSampler(),
    spanLimits: {
      attributeCountLimit: 16,
      attributeValueLengthLimit: 128,
      eventCountLimit: 0,
      linkCountLimit: 0,
    },
    spanProcessors: [
      new BatchSpanProcessor(traceExporter, {
        maxQueueSize: policy.maximumQueueSize,
        maxExportBatchSize: policy.maximumBatchSize,
        scheduledDelayMillis: policy.exportIntervalMs,
        exportTimeoutMillis: policy.deadlineMs + 50,
      }),
    ],
  });
  const ownedTrace = trace.setGlobalTracerProvider(tracer);
  const ownedMeter = ownedTrace && metrics.setGlobalMeterProvider(meter);
  const ownedContext = ownedMeter && context.setGlobalContextManager(manager.enable());
  const ownedPropagation =
    ownedContext && propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  if (!ownedPropagation) {
    await Promise.allSettled([tracer.shutdown(), meter.shutdown()]);
    manager.disable();
    if (ownedTrace) trace.disable();
    if (ownedMeter) metrics.disable();
    if (ownedContext) context.disable();
    setGlobalErrorHandler(() => undefined);
    running = false;
    throw new Error("TELEMETRY_GLOBAL_PROVIDER_CONFLICT");
  }
  const heartbeat = setInterval(() => {
    tracer
      .getTracer("awp.platform", "1.0.0")
      .startSpan("runtime.heartbeat", { attributes: { component: policy.component } })
      .end();
    meter.getMeter("awp.platform", "1.0.0").createCounter("awp.operation.outcomes").add(1, {
      operation: "runtime.heartbeat",
      component: policy.component,
      outcome: "SUCCEEDED",
    });
  }, policy.exportIntervalMs);
  heartbeat.unref();
  return Object.freeze({
    health: () => {
      if (stopped) return { ready: false, reasonCode: "TELEMETRY_STOPPED" as const };
      const values = Object.values(receipt);
      if (
        values.some((value) => value && (!value.ok || Date.now() - value.at > policy.freshnessMs))
      )
        return { ready: false, reasonCode: "TELEMETRY_EXPORT_UNAVAILABLE" as const };
      if (values.some((value) => !value))
        return { ready: false, reasonCode: "TELEMETRY_NOT_OBSERVED" as const };
      return { ready: true, reasonCode: "READY" as const };
    },
    flush: async () => {
      if (stopped) return;
      try {
        await bounded(
          Promise.all([tracer.forceFlush(), meter.forceFlush()]),
          policy.deadlineMs + 250,
        );
      } catch {
        fail();
      }
    },
    shutdown: () => {
      shuttingDown ??= (async () => {
        clearInterval(heartbeat);
        try {
          await bounded(
            Promise.all([tracer.shutdown(), meter.shutdown()]),
            policy.deadlineMs + 500,
          );
        } catch {
          fail();
        } finally {
          stopped = true;
          manager.disable();
          trace.disable();
          metrics.disable();
          context.disable();
          propagation.disable();
          setGlobalErrorHandler(() => undefined);
          running = false;
        }
      })();
      return shuttingDown;
    },
  });
}
