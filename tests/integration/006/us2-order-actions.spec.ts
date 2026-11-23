import assert from "node:assert/strict";

import { describe, expect, it, vi } from "vitest";

import {
  applyQueueOrderMove,
  QueueOrderService,
} from "../../../packages/runtime-composition/src/queue/order-service.ts";

const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const exact = (id: string) => ({
  expectedQueueEntry: {
    queueEntryId: id === "two" ? "q2" : `q-${id}`,
    revision: 1,
    semanticHash: hash("4"),
    inputFingerprint: hash("5"),
  },
  workItemRef: {
    sourceType: "WORK_ITEM_REVISION" as const,
    sourceId: id,
    sourceVersion: 1,
    semanticHash: hash("6"),
  },
});
const rows = [
  { projectId: "A", workItemId: "one", ...exact("one") },
  { projectId: "A", workItemId: "two", ...exact("two") },
  { projectId: "B", workItemId: "three", ...exact("three") },
];

describe("US2 exact order actions", () => {
  it.each([
    ["FIRST", undefined, ["three", "one", "two"]],
    ["LAST", undefined, ["one", "two", "three"]],
    ["BEFORE", { projectId: "A", workItemId: "one" }, ["three", "one", "two"]],
    ["AFTER", { projectId: "A", workItemId: "one" }, ["one", "three", "two"]],
  ] as const)("applies %s after authorization filtering", (placement, anchor, expected) => {
    const result = applyQueueOrderMove(rows, {
      subject: { projectId: "B", workItemId: "three" },
      placement,
      ...(anchor ? { anchor } : {}),
    });
    expect(result).toMatchObject({ applicationState: "APPLIED" });
    expect(result.entries.map(({ workItemId }) => workItemId)).toEqual(expected);
  });

  it("makes hidden and missing anchors the same terminal no-op candidate with a public self result ref", async () => {
    const commit = vi.fn(async (candidate) => candidate);
    const service = new QueueOrderService({
      authorizeTarget: vi.fn().mockResolvedValue(true),
      readAuthorizedView: vi.fn().mockResolvedValue({
        entries: rows,
        orderState: { resourceVersion: 2, queueEpoch: 3, baseVisibleSetHash: hash("1") },
        authorizedProjectSetHash: hash("2"),
        projectionGeneration: hash("3"),
      }),
      commit,
      now: () => "2026-09-03T08:00:00.000Z",
    });
    const command = {
      requestKey: "move-1",
      workspaceId: "w1",
      principalId: "lead",
      scopeKind: "AUTHORIZED_PORTFOLIO" as const,
      subject: {
        projectId: "A",
        workItemId: "two",
        expectedQueueEntry: {
          queueEntryId: "q2",
          revision: 1,
          semanticHash: hash("4"),
          inputFingerprint: hash("5"),
        },
      },
      placement: "BEFORE" as const,
      expectedOrderResourceVersion: 2,
      expectedQueueEpoch: 3,
      expectedBaseVisibleSetHash: hash("1"),
      expectedAuthorizedProjectSetHash: hash("2"),
      expectedProjectionGeneration: hash("3"),
      expectedComparatorRef: "queue-order@1.0.0" as const,
      reason: "Move for review",
      expiresAt: "2026-09-04T08:00:00.000Z",
    };
    const hidden = await service.request({
      ...command,
      anchor: { projectId: "C", workItemId: "secret" },
    });
    const missing = await service.request({
      ...command,
      requestKey: "move-2",
      anchor: { projectId: "A", workItemId: "absent" },
    });
    expect(hidden).toMatchObject({
      state: "CONSUMED",
      approvalRequired: false,
      effect: { kind: "ANCHOR_UNAVAILABLE_NO_OP" },
      resultRef: { sourceType: "QUEUE_ACTION_CANDIDATE", sourceVersion: 1 },
    });
    expect(missing).toMatchObject({
      state: "CONSUMED",
      approvalRequired: false,
      effect: { kind: "ANCHOR_UNAVAILABLE_NO_OP" },
    });
    expect(JSON.stringify(hidden)).not.toContain("secret");
    expect(JSON.stringify(missing)).not.toContain("absent");
    assert(
      hidden.resultRef && typeof hidden.resultRef === "object" && "sourceId" in hidden.resultRef,
    );
    expect(commit.mock.calls[0]?.[0]).toMatchObject({
      actionId: hidden.resultRef.sourceId,
      candidate: { actionKind: "QUEUE_ORDER_OVERRIDE", approvalPolicy: "NO_SECOND_APPROVAL" },
      witness: { requestedEffect: { requestedAnchor: { projectId: "C", workItemId: "secret" } } },
    });
  });

  it("rejects stale version/epoch/base/generation and expired requests before persistence", async () => {
    const commit = vi.fn();
    const service = new QueueOrderService({
      authorizeTarget: vi.fn().mockResolvedValue(true),
      readAuthorizedView: vi.fn().mockResolvedValue({
        entries: rows,
        orderState: { resourceVersion: 2, queueEpoch: 3, baseVisibleSetHash: hash("1") },
        authorizedProjectSetHash: hash("2"),
        projectionGeneration: hash("3"),
      }),
      commit,
      now: () => "2026-09-03T08:00:00.000Z",
    });
    const base = {
      requestKey: "move",
      workspaceId: "w1",
      principalId: "lead",
      scopeKind: "PROJECT" as const,
      subject: {
        projectId: "A",
        workItemId: "two",
        expectedQueueEntry: {
          queueEntryId: "q2",
          revision: 1,
          semanticHash: hash("4"),
          inputFingerprint: hash("5"),
        },
      },
      placement: "FIRST" as const,
      expectedOrderResourceVersion: 2,
      expectedQueueEpoch: 3,
      expectedBaseVisibleSetHash: hash("1"),
      expectedAuthorizedProjectSetHash: hash("2"),
      expectedProjectionGeneration: hash("3"),
      expectedComparatorRef: "queue-order@1.0.0" as const,
      reason: "Move",
      expiresAt: "2026-09-04T08:00:00.000Z",
    };
    await expect(service.request({ ...base, expectedQueueEpoch: 2 })).rejects.toThrow(
      "QUEUE_ORDER_CAS_CONFLICT",
    );
    await expect(
      service.request({ ...base, expectedProjectionGeneration: hash("9") }),
    ).rejects.toThrow("QUEUE_ORDER_PROJECTION_CONFLICT");
    await expect(
      service.request({ ...base, expiresAt: "2026-09-03T07:00:00.000Z" }),
    ).rejects.toThrow("QUEUE_ORDER_EXPIRY_INVALID");
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects a stale exact QueueEntry tuple before candidate persistence", async () => {
    const commit = vi.fn();
    const service = new QueueOrderService({
      authorizeTarget: vi.fn().mockResolvedValue(true),
      readAuthorizedView: vi.fn().mockResolvedValue({
        entries: rows,
        orderState: { resourceVersion: 2, queueEpoch: 3, baseVisibleSetHash: hash("1") },
        authorizedProjectSetHash: hash("2"),
        projectionGeneration: hash("3"),
      }),
      commit,
      now: () => "2026-09-03T08:00:00.000Z",
    });
    await expect(
      service.request({
        requestKey: "stale",
        workspaceId: "w1",
        principalId: "lead",
        scopeKind: "PROJECT",
        subject: {
          projectId: "A",
          workItemId: "two",
          expectedQueueEntry: { ...rows[1]!.expectedQueueEntry, revision: 2 },
        },
        placement: "FIRST",
        expectedOrderResourceVersion: 2,
        expectedQueueEpoch: 3,
        expectedBaseVisibleSetHash: hash("1"),
        expectedAuthorizedProjectSetHash: hash("2"),
        expectedProjectionGeneration: hash("3"),
        expectedComparatorRef: "queue-order@1.0.0",
        reason: "Move",
        expiresAt: "2026-09-04T08:00:00.000Z",
      }),
    ).rejects.toThrow("QUEUE_ORDER_ENTRY_TUPLE_CONFLICT");
    expect(commit).not.toHaveBeenCalled();
  });
});
