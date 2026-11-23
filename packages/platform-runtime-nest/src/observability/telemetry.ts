import type { LoggerService } from "@nestjs/common";
import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";

const secretPattern =
  /authorization|cookie|secret|token|password|payload|locator|object[_-]?key|evidence|prompt|foreign|cross[_-]?project|other[_-]?project/iu;
const secretValuePattern =
  /(?:bearer\s+[a-z0-9._~+/-]+=*|secretref:\/\/|s3:\/\/|https?:\/\/[^\s/@]+:[^\s/@]+@|eyJ[a-z0-9_-]{12,}\.)/iu;
const identifiers = new Set(["workspaceId", "projectId", "correlationId", "causationId"]);
const operations = new Set([
  "other",
  "runtime.heartbeat",
  "http.request",
  "worker.recovery",
  "worker.dispatcher",
  "worker.commands",
  "connector.read",
  "connector.write",
  "artifact.retention",
  "evidence.sign",
  "identity.authenticate",
  "record.publish",
  "qa.complete",
  "qa.approval",
]);
const components = new Set([
  "other",
  "api",
  "worker",
  "qa-jira",
  "mattermost",
  "gitlab.automation-trigger",
  "gitlab.webhook-reconciliation",
  "gitlab.automation-events",
  "project-onboarding-events",
  "project-onboarding-probes",
  "artifact-retention",
  "project-suspension-recovery",
  "queue-foundation",
]);
const outcomes = new Set(["SUCCEEDED", "FAILED", "DENIED", "DEFERRED"]);
const reasons = new Set([
  "DENIED",
  "CONFIRMED",
  "UNEXPECTED_FAILURE",
  "STARTUP_FAILED",
  "DEFERRED",
]);
const classifications = new Set(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]);
const events = new Set([
  "redacted.event",
  "operation.completed",
  "worker.contribution.deferred",
  "api.operation.failed",
  "runtime.startup.failed",
  "runtime.started",
  "framework.error",
  "framework.warn",
  "framework.log",
  "framework.debug",
]);
const closed = (value: unknown, values: ReadonlySet<string>): string =>
  typeof value === "string" && values.has(value) ? value : "other";

export function redactTelemetryAttributes(
  attributes: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string | number | boolean>> {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (secretPattern.test(key) || (typeof value === "string" && secretValuePattern.test(value)))
      continue;
    if (
      identifiers.has(key) &&
      typeof value === "string" &&
      /^[a-z0-9][a-z0-9:_-]{0,127}$/iu.test(value)
    )
      safe[key] = value;
    else if (key === "operation") safe[key] = closed(value, operations);
    else if (key === "component") safe[key] = closed(value, components);
    else if (key === "outcome" && typeof value === "string" && outcomes.has(value))
      safe[key] = value;
    else if (key === "reasonCode" && typeof value === "string" && reasons.has(value))
      safe[key] = value;
    else if (key === "classificationKey" && typeof value === "string" && classifications.has(value))
      safe[key] = value;
    else if (
      (key === "latencyMs" || key === "version") &&
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= Number.MAX_SAFE_INTEGER
    )
      safe[key] = value;
  }
  return Object.freeze(safe);
}

export class StructuredLogger {
  write(
    level: "info" | "warn" | "error",
    message: string,
    attributes: Readonly<Record<string, unknown>> = {},
  ): void {
    const safeMessage = events.has(message) ? message : "redacted.event";
    process.stdout.write(
      `${JSON.stringify({ timestamp: new Date().toISOString(), level, message: safeMessage, ...redactTelemetryAttributes(attributes) })}\n`,
    );
  }
}

/** Framework messages/optional stack arguments are untrusted and never serialized. */
export class SafeNestLogger implements LoggerService {
  constructor(private readonly component: "api" | "worker") {}
  log(...values: unknown[]): void {
    void values;
    this.emit("info", "framework.log");
  }
  error(...values: unknown[]): void {
    void values;
    this.emit("error", "framework.error");
  }
  warn(...values: unknown[]): void {
    void values;
    this.emit("warn", "framework.warn");
  }
  debug(...values: unknown[]): void {
    void values;
    this.emit("info", "framework.debug");
  }
  verbose(...values: unknown[]): void {
    void values;
    this.emit("info", "framework.debug");
  }
  fatal(...values: unknown[]): void {
    void values;
    this.emit("error", "framework.error");
  }
  private emit(level: "info" | "warn" | "error", message: string): void {
    new StructuredLogger().write(level, message, {
      component: this.component,
      ...(level === "error" ? { outcome: "FAILED", reasonCode: "UNEXPECTED_FAILURE" } : {}),
    });
  }
}

export async function runSafeRuntimeEntrypoint(
  component: "api" | "worker",
  bootstrap: () => Promise<void>,
): Promise<boolean> {
  try {
    await bootstrap();
    return true;
  } catch {
    new StructuredLogger().write("error", "runtime.startup.failed", {
      component,
      outcome: "FAILED",
      reasonCode: "STARTUP_FAILED",
    });
    return false;
  }
}

export async function measured<T>(
  operation: string,
  attributes: Readonly<Record<string, unknown>>,
  work: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  const name = closed(operation, operations);
  const safe = redactTelemetryAttributes({ ...attributes, operation: name });
  // Resolve instruments at execution time, after the host has installed its SDK.
  const tracer = trace.getTracer("awp.platform", "1.0.0");
  const meter = metrics.getMeter("awp.platform", "1.0.0");
  const operationLatency = meter.createHistogram("awp.operation.latency", { unit: "ms" });
  const operationOutcomes = meter.createCounter("awp.operation.outcomes");
  return await tracer.startActiveSpan(name, { attributes: safe }, async (span) => {
    let outcome = "SUCCEEDED";
    try {
      const result = await work();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      outcome = "FAILED";
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      const latencyMs = Math.max(0, Math.round(performance.now() - started));
      // Project, request, version and free-text reasons must never be metric labels.
      const dimensions = {
        operation: name,
        component: closed(safe.component, components),
        outcome,
      };
      operationLatency.record(latencyMs, dimensions);
      operationOutcomes.add(1, dimensions);
      span.end();
      new StructuredLogger().write("info", "operation.completed", { ...safe, outcome, latencyMs });
    }
  });
}
