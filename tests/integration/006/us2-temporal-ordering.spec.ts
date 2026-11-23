import { describe, expect, it, vi } from "vitest";

import { queueProjectionEventTypes } from "../../../packages/runtime-composition/src/queue/projection-worker.ts";
import {
  type QueueTemporalDue,
  QueueTemporalTransitionSweep,
  readyAgingBandAt,
} from "../../../packages/runtime-composition/src/queue/temporal-transition-worker.ts";

const dueEntry = (id: string, dueAt: string): QueueTemporalDue =>
  Object.freeze({
    kind: "QUEUE_ENTRY",
    workspaceId: "w1",
    projectId: "p1",
    subjectId: id,
    dueAt,
  });

describe("US2 durable temporal ordering", () => {
  it("selects READY aging bands and the next exact business-time boundary", () => {
    const addBusinessSeconds = vi.fn((instant: string, seconds: number) =>
      new Date(Date.parse(instant) + seconds * 1_000).toISOString(),
    );
    const bands = [
      { key: "00-FRESH", upperBoundBusinessSeconds: 3_600 },
      { key: "01-AGING", upperBoundBusinessSeconds: 7_200 },
    ] as const;

    expect(
      readyAgingBandAt({
        readyAt: "2026-09-03T08:00:00.000Z",
        asOf: "2026-09-03T08:30:00.000Z",
        elapsedBusinessSeconds: 1_800,
        bands,
        addBusinessSeconds,
      }),
    ).toEqual({
      agingBandKey: "00-FRESH",
      businessSeconds: 1_800,
      nextEvaluationAt: "2026-09-03T09:00:00.000Z",
    });
    expect(
      readyAgingBandAt({
        readyAt: "2026-09-03T08:00:00.000Z",
        asOf: "2026-09-03T09:00:00.000Z",
        elapsedBusinessSeconds: 3_600,
        bands,
        addBusinessSeconds,
      }),
    ).toEqual({
      agingBandKey: "01-AGING",
      businessSeconds: 3_600,
      nextEvaluationAt: "2026-09-03T10:00:00.000Z",
    });
    expect(
      readyAgingBandAt({
        readyAt: "2026-09-03T08:00:00.000Z",
        asOf: "2026-09-03T11:00:00.000Z",
        elapsedBusinessSeconds: 10_800,
        bands,
        addBusinessSeconds,
      }),
    ).toEqual({ agingBandKey: "02-OLDEST", businessSeconds: 10_800 });
    expect(addBusinessSeconds).toHaveBeenCalledTimes(2);
  });

  it("recovers overdue rows on startup in bounded batches and writes only semantic transitions", async () => {
    const claimed = [
      dueEntry("q1", "2026-09-03T07:00:00.000Z"),
      dueEntry("q2", "2026-09-03T07:30:00.000Z"),
    ];
    const claimDue = vi.fn().mockResolvedValue(claimed);
    const evaluateQueueEntry = vi
      .fn()
      .mockResolvedValueOnce({ changed: true, nextEvaluationAt: "2026-09-03T10:00:00.000Z" })
      .mockResolvedValueOnce({ changed: false });
    const complete = vi.fn().mockResolvedValue(undefined);
    const sweep = new QueueTemporalTransitionSweep(
      {
        claimDue,
        evaluateQueueEntry,
        expireOrderOverride: vi.fn(),
        expireExpedite: vi.fn(),
        complete,
      },
      () => "2026-09-03T08:00:00.000Z",
    );

    await expect(sweep.run({ trigger: "STARTUP", batchSize: 2 })).resolves.toEqual({
      claimed: 2,
      semanticChanges: 1,
      rescheduled: 1,
      completed: 1,
    });
    expect(claimDue).toHaveBeenCalledWith({ dueBefore: "2026-09-03T08:00:00.000Z", batchSize: 2 });
    expect(complete).toHaveBeenNthCalledWith(1, claimed[0], "2026-09-03T10:00:00.000Z");
    expect(complete).toHaveBeenNthCalledWith(2, claimed[1], undefined);
  });

  it("does not create read-triggered or per-second writes before a durable row is due", async () => {
    const ports = {
      claimDue: vi.fn().mockResolvedValue([]),
      evaluateQueueEntry: vi.fn(),
      expireOrderOverride: vi.fn(),
      expireExpedite: vi.fn(),
      complete: vi.fn(),
    };
    const sweep = new QueueTemporalTransitionSweep(ports, () => "2026-09-03T08:00:00.000Z");

    // Reads never receive the sweep. Periodic wake-ups with no due row are write-free.
    await sweep.run({ trigger: "PERIODIC", batchSize: 100 });
    await sweep.run({ trigger: "PERIODIC", batchSize: 100 });
    expect(ports.evaluateQueueEntry).not.toHaveBeenCalled();
    expect(ports.expireOrderOverride).not.toHaveBeenCalled();
    expect(ports.complete).not.toHaveBeenCalled();
  });

  it("emits exactly the QueueEntry update plus optional stage-transition pair", () => {
    expect(queueProjectionEventTypes({ controlTransition: false, stageChanged: false })).toEqual([
      "queue.projection.updated",
    ]);
    expect(queueProjectionEventTypes({ controlTransition: false, stageChanged: true })).toEqual([
      "queue.projection.updated",
      "queue.stage.changed",
    ]);
    expect(queueProjectionEventTypes({ controlTransition: true, stageChanged: true })).toEqual([
      "queue.control.changed",
      "queue.stage.changed",
    ]);
  });
});
