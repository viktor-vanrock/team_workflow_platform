import { describe, expect, it, vi } from "vitest";

import { QueueProjectionRebuildCoordinator } from "../../../packages/runtime-composition/src/queue/projection-rebuild.ts";
import {
  QueueProjectionCoordinator,
  queueProjectionInputFingerprint,
} from "../../../packages/runtime-composition/src/queue/projection-worker.ts";

const scope = Object.freeze({ workspaceId: "workspace", projectId: "project" });
const fact = Object.freeze({
  subjectId: "work-item",
  sourceRefs: Object.freeze([
    {
      sourceType: "WORK_ITEM_REVISION",
      sourceId: "work-item",
      sourceVersion: 4,
      semanticHash: `sha256:${"a".repeat(64)}` as const,
    },
  ]),
});

describe("Feature 006 rebuild and restart recovery", () => {
  it("dedupes duplicate/out-of-order invalidations and repairs a missed gap before atomic shadow cutover", async () => {
    const readCurrent = vi.fn().mockResolvedValue(fact);
    const appendIfChanged = vi.fn().mockResolvedValue({ changed: true, revisionNumber: 1 });
    const incremental = new QueueProjectionCoordinator({
      readCurrent,
      appendIfChanged,
      suppressPrecursor: vi.fn(),
    });
    const event = { eventId: "event-4", entityId: "work-item", entityVersion: 4, scope };
    await expect(incremental.consume(event)).resolves.toMatchObject({ status: "PROCESSED" });
    await expect(incremental.consume(event)).resolves.toMatchObject({ status: "DUPLICATE" });
    await expect(
      incremental.consume({ ...event, eventId: "event-3", entityVersion: 3 }),
    ).resolves.toMatchObject({ status: "STALE" });

    const operations: string[] = [];
    const store = {
      begin: vi.fn(async () => ({
        generationId: "shadow",
        highWatermarks: { eventOutboxAt: "2026-09-03T08:00:00.000Z", eventOutboxId: "event-2" },
        cursor: "checkpoint",
        projectedCount: 1,
      })),
      page: vi.fn(async () => ({ subjects: [] })),
      checkpoint: vi.fn(),
      catchUp: vi.fn(async () => {
        operations.push("catch-up-gap");
        return [{ ...scope, subjectId: "work-item" }];
      }),
      validate: vi.fn(async () => {
        operations.push("validate");
        return {
          valid: true,
          subjectCount: 1,
          stageCounts: { READY: 1 },
          outputSetHash: queueProjectionInputFingerprint(fact),
        };
      }),
      activate: vi.fn(async () => {
        operations.push("activate");
        return { corrections: 0 };
      }),
      fail: vi.fn(),
    };
    const shadowAppend = vi.fn().mockImplementation(async (input) => {
      expect(input.inputFingerprint).toBe(queueProjectionInputFingerprint(fact));
      return { changed: false, revisionNumber: 1 };
    });
    const shadow = new QueueProjectionCoordinator({
      readCurrent,
      appendIfChanged: shadowAppend,
      suppressPrecursor: vi.fn(),
    });
    const rebuild = new QueueProjectionRebuildCoordinator(store, shadow);
    await expect(rebuild.run(scope.workspaceId, 50)).resolves.toEqual({
      generationId: "shadow",
      subjectCount: 1,
      corrections: 0,
    });
    expect(operations).toEqual(["catch-up-gap", "validate", "activate"]);
    expect(store.begin).toHaveBeenCalledWith(scope.workspaceId);
    expect(store.activate).toHaveBeenCalledAfter(store.validate);
  });

  it("survives worker restart without duplicating a semantic effect or notification", async () => {
    let currentFingerprint: string | undefined;
    let effects = 0;
    let notifications = 0;
    const appendIfChanged = vi.fn(async (input: Readonly<{ inputFingerprint: string }>) => {
      if (currentFingerprint === input.inputFingerprint)
        return { changed: false, revisionNumber: 1 };
      currentFingerprint = input.inputFingerprint;
      effects += 1;
      notifications += 1;
      return { changed: true, revisionNumber: 1 };
    });
    const ports = {
      readCurrent: vi.fn().mockResolvedValue(fact),
      appendIfChanged,
      suppressPrecursor: vi.fn(),
    };
    const beforeRestart = new QueueProjectionCoordinator(ports);
    await expect(
      beforeRestart.consume({ eventId: "event-4", entityId: "work-item", entityVersion: 4, scope }),
    ).resolves.toMatchObject({ status: "PROCESSED", changed: true });
    const afterWorkerRestart = new QueueProjectionCoordinator(ports);
    await expect(
      afterWorkerRestart.consume({
        eventId: "event-4-redelivered",
        entityId: "work-item",
        entityVersion: 4,
        scope,
      }),
    ).resolves.toMatchObject({ status: "PROCESSED", changed: false });
    expect({ effects, notifications }).toEqual({ effects: 1, notifications: 1 });
  });
});
