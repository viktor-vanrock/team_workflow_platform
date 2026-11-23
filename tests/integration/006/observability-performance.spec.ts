import { describe, expect, it } from "vitest";

import { BoundedQueueTelemetry } from "../../../packages/runtime-composition/src/queue/observability.ts";
import { createQueueObservabilityLoadFixture } from "../../support/006-observability-fixture.ts";

describe("Feature 006 observability and read performance", () => {
  it("keeps query count constant as the visible item set grows and performs zero provider reads", async () => {
    const small = await createQueueObservabilityLoadFixture(10).run();
    const large = await createQueueObservabilityLoadFixture(1_000).run();
    expect(small.queryCount).toBe(3);
    expect(large.queryCount).toBe(small.queryCount);
    expect({ small: small.providerReadCount, large: large.providerReadCount }).toEqual({
      small: 0,
      large: 0,
    });
    expect((small.page.visibleCounts as { total: number }).total).toBe(10);
    expect((large.page.visibleCounts as { total: number }).total).toBe(1_000);
  });

  it("uses only bounded queue/capacity/SLA/rebuild labels and keeps correlation/audit refs out of labels", () => {
    const telemetry = new BoundedQueueTelemetry();
    const subsystems = ["QUEUE", "CAPACITY", "SLA", "REBUILD"] as const;
    for (let index = 0; index < 2_000; index += 1) {
      telemetry.record({
        name: "queue_operation_total",
        labels: {
          subsystem: subsystems[index % subsystems.length]!,
          operation: index % 2 === 0 ? "READ" : "TRANSITION",
          outcome: index % 3 === 0 ? "NO_CHANGE" : "SUCCESS",
        },
        correlationRef: `correlation-${index}`,
        auditRef: `audit-${index}`,
      });
    }
    const snapshot = telemetry.snapshot();
    expect(Object.keys(snapshot.series).length).toBeLessThanOrEqual(16);
    expect(Object.keys(snapshot.series).length).toBeLessThanOrEqual(snapshot.maximumSeries);
    expect(snapshot.exemplars).toHaveLength(64);
    expect(Object.keys(snapshot.series).join("|")).not.toMatch(
      /correlation-|audit-|workspace|project|work-item/u,
    );
    expect(snapshot.exemplars[0]).toEqual({ correlationRef: "correlation-0", auditRef: "audit-0" });
  });

  it("rejects unknown/high-cardinality labels and negative measurements", () => {
    const telemetry = new BoundedQueueTelemetry();
    expect(() =>
      telemetry.record({
        name: "queue_operation_total",
        labels: { subsystem: "workspace-123", operation: "READ", outcome: "SUCCESS" },
        correlationRef: "c",
      } as never),
    ).toThrow("QUEUE_TELEMETRY_OBSERVATION_INVALID");
    expect(() =>
      telemetry.record({
        name: "queue_operation_duration_ms",
        labels: { subsystem: "QUEUE", operation: "READ", outcome: "SUCCESS" },
        value: -1,
        correlationRef: "c",
      }),
    ).toThrow("QUEUE_TELEMETRY_OBSERVATION_INVALID");
  });
});
