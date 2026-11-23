import { describe, expect, it, vi } from "vitest";

import {
  assertQueueActionConsumedResult,
  type QueueActionPair,
} from "../../../packages/platform-core/src/index.ts";
import { QueueActionCandidateRepository } from "../../../packages/platform-persistence-typeorm/src/queue-action-candidate.repository.ts";
import { QueueOrderService } from "../../../packages/runtime-composition/src/queue/order-service.ts";

const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const view = {
  entries: [
    {
      projectId: "p1",
      workItemId: "wi1",
      expectedQueueEntry: {
        queueEntryId: "qe1",
        revision: 2,
        semanticHash: hash("1"),
        inputFingerprint: hash("2"),
      },
      workItemRef: {
        sourceType: "WORK_ITEM_REVISION" as const,
        sourceId: "wi1",
        sourceVersion: 3,
        semanticHash: hash("3"),
      },
    },
  ],
  orderState: { resourceVersion: 0, queueEpoch: 1, baseVisibleSetHash: hash("4") },
  authorizedProjectSetHash: hash("5"),
  projectionGeneration: hash("6"),
};
const base = {
  requestKey: "order-no-op",
  workspaceId: "w1",
  principalId: "lead",
  scopeKind: "PROJECT" as const,
  subject: {
    projectId: "p1",
    workItemId: "wi1",
    expectedQueueEntry: view.entries[0]!.expectedQueueEntry,
  },
  placement: "BEFORE" as const,
  anchor: { projectId: "p1", workItemId: "wi1" },
  expectedOrderResourceVersion: 0,
  expectedQueueEpoch: 1,
  expectedBaseVisibleSetHash: hash("4"),
  expectedAuthorizedProjectSetHash: hash("5"),
  expectedProjectionGeneration: hash("6"),
  expectedComparatorRef: "queue-order@1.0.0" as const,
  reason: "No visible anchor",
  expiresAt: "2026-09-04T08:00:00.000Z",
};

describe("US2 order candidate pair and consumed result mapping", () => {
  it("keeps the raw unavailable anchor private and requires the public self result ref", async () => {
    let pair: QueueActionPair | undefined;
    const service = new QueueOrderService({
      authorizeTarget: vi.fn().mockResolvedValue(true),
      readAuthorizedView: vi.fn().mockResolvedValue(view),
      commit: vi.fn(async (value) => {
        pair = value;
      }),
      now: () => "2026-09-03T08:00:00.000Z",
    });
    const receipt = await service.request(base);
    expect(pair).toBeDefined();
    expect(JSON.stringify(pair!.candidate)).not.toContain('"anchor"');
    expect(pair!.candidate.requestedEffect).toEqual({ kind: "ANCHOR_UNAVAILABLE_NO_OP" });
    expect(pair!.witness.requestedEffect).toMatchObject({ requestedAnchor: base.anchor });
    expect(() => assertQueueActionConsumedResult(pair!, receipt)).not.toThrow();
    expect(() =>
      assertQueueActionConsumedResult(pair!, {
        resultRef: {
          sourceType: "QUEUE_ORDER_OVERRIDE_REVISION",
          sourceId: pair!.actionId,
          sourceVersion: 1,
          semanticHash: pair!.publicIntentHash,
        },
      }),
    ).toThrow("QUEUE_ORDER_NO_OP_RESULT_REF_MISMATCH");
  });

  it("persists the public/private same-ID pair atomically and completes a terminal no-op", async () => {
    let pair: QueueActionPair | undefined;
    const service = new QueueOrderService({
      authorizeTarget: vi.fn().mockResolvedValue(true),
      readAuthorizedView: vi.fn().mockResolvedValue(view),
      commit: vi.fn(async (value) => {
        pair = value;
      }),
      now: () => "2026-09-03T08:00:00.000Z",
    });
    await service.request(base);
    const queries: unknown[][] = [];
    const manager = {
      query: vi.fn(async (...args: [sql: string, parameters?: readonly unknown[]]) => {
        queries.push(args);
        return [];
      }),
    };
    const source = {
      transaction: vi.fn(
        async (_level: string, run: (value: typeof manager) => Promise<unknown>) =>
          await run(manager),
      ),
    };
    const basis = { permission: "queue.order.move", decision: "ALLOW" };
    const repository = new QueueActionCandidateRepository(source as never);
    await expect(
      repository.saveQueueActionPair({
        scope: { kind: "PROJECT", workspaceId: "w1", projectId: "p1" },
        pair: pair!,
        initiatorId: "lead",
        initiatorAuthorizationBasis: basis,
        initiatorAuthorizationBasisHash: hash("0"),
        createdAt: "2026-09-03T08:00:00.000Z",
      }),
    ).rejects.toThrow("QUEUE_ACTION_PERSISTENCE_SCOPE_OR_BASIS_MISMATCH");
    const { sha256 } = await import("../../../packages/platform-contracts/src/index.ts");
    await expect(
      repository.saveQueueActionPair({
        scope: { kind: "PROJECT", workspaceId: "w1", projectId: "p1" },
        pair: pair!,
        initiatorId: "lead",
        initiatorAuthorizationBasis: basis,
        initiatorAuthorizationBasisHash: sha256(basis),
        createdAt: "2026-09-03T08:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      state: "COMPLETED",
      resultRef: { sourceType: "QUEUE_ACTION_CANDIDATE", sourceId: pair!.actionId },
    });
    expect(manager.query).toHaveBeenCalledTimes(3);
    expect(String(manager.query.mock.calls[1]?.[0])).toContain("platform_actions");
    expect(String(manager.query.mock.calls[2]?.[0])).toContain("queue_action_candidates");
    expect(manager.query.mock.calls[1]?.[1]?.[0]).toBe(pair!.actionId);
    expect(manager.query.mock.calls[2]?.[1]?.[0]).toBe(pair!.actionId);
  });
});
