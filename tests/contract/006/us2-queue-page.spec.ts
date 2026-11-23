import { describe, expect, it } from "vitest";

import {
  decodeQueueCursor,
  encodeQueueCursor,
  queuePageEtag,
  validateQueuePageRepresentation,
} from "../../../packages/runtime-composition/src/queue/portfolio-query.ts";

const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const entry = (id: string, projectId = "p1", stage = "READY") => ({
  queueEntryId: id,
  revision: 1,
  workspaceId: "w1",
  projectId,
  stage,
  semanticHash: hash("a"),
  inputFingerprint: hash("b"),
  control: { state: "DEFAULT", resourceVersion: 0, serviceClass: "STANDARD" },
});
const page = () => ({
  schemaVersion: "queue-page@1.0.0",
  workspaceId: "w1",
  scope: { kind: "PROJECT", projectId: "p1", authorizedProjectSetHash: hash("1") },
  asOf: "2026-09-03T08:00:00.000Z",
  projectionGeneration: hash("2"),
  comparatorRef: "queue-order@1.0.0",
  orderState: { resourceVersion: 0, queueEpoch: 1, baseVisibleSetHash: hash("3") },
  freshness: "CURRENT",
  visibleCounts: {
    total: 2,
    byStage: { CANDIDATE: 0, BACKLOG: 0, READY: 2, ACTIVE: 0, COMPLETED: 0 },
  },
  items: [
    { ordinal: 3, entry: entry("q1") },
    { ordinal: 4, entry: entry("q2") },
  ],
  nextCursor: null,
});

describe("US2 QueuePage composed contract", () => {
  it("binds path/scope to every entry and validates enabled counts over the full filtered set", () => {
    expect(() =>
      validateQueuePageRepresentation(page(), {
        workspaceId: "w1",
        projectIds: ["p1"],
        fullFilteredCount: 2,
        expectedOrdinals: [3, 4],
      }),
    ).not.toThrow();
    expect(() =>
      validateQueuePageRepresentation(
        { ...page(), items: [{ ordinal: 3, entry: entry("q1", "hidden") }] },
        { workspaceId: "w1", projectIds: ["p1"], fullFilteredCount: 1, expectedOrdinals: [3] },
      ),
    ).toThrow("QUEUE_PAGE_ENTRY_SCOPE_MISMATCH");
    expect(() =>
      validateQueuePageRepresentation(
        { ...page(), visibleCounts: { ...page().visibleCounts, total: 3 } },
        { workspaceId: "w1", projectIds: ["p1"], fullFilteredCount: 2, expectedOrdinals: [3, 4] },
      ),
    ).toThrow("QUEUE_PAGE_COUNT_MISMATCH");
  });

  it("requires absolute increasing ordinals and exact order-state CAS tokens", () => {
    expect(() =>
      validateQueuePageRepresentation(
        {
          ...page(),
          items: [
            { ordinal: 1, entry: entry("q1") },
            { ordinal: 1, entry: entry("q2") },
          ],
        },
        { workspaceId: "w1", projectIds: ["p1"], fullFilteredCount: 2, expectedOrdinals: [1, 2] },
      ),
    ).toThrow("QUEUE_PAGE_ORDINAL_MISMATCH");
    expect(() =>
      validateQueuePageRepresentation(
        {
          ...page(),
          orderState: { resourceVersion: -1, queueEpoch: 0, baseVisibleSetHash: "bad" },
        },
        { workspaceId: "w1", projectIds: ["p1"], fullFilteredCount: 2, expectedOrdinals: [3, 4] },
      ),
    ).toThrow("QUEUE_PAGE_ORDER_TOKEN_INVALID");
  });

  it("closes applied overrides and never returns requested anchor identity", () => {
    const safe = {
      ...page(),
      visibleCounts: {
        total: 1,
        byStage: { CANDIDATE: 0, BACKLOG: 0, READY: 1, ACTIVE: 0, COMPLETED: 0 },
      },
      items: [
        {
          ordinal: 3,
          entry: entry("q1"),
          appliedOrderOverride: {
            applicationState: "APPLIED",
            scopeKind: "PROJECT",
            placement: "FIRST",
            reason: "Lead decision",
            acceptedAt: "2026-09-03T08:00:00.000Z",
            expiresAt: "2026-09-04T08:00:00.000Z",
            appliedOverrideRef: { id: "o1", version: 2, semanticHash: hash("4") },
          },
        },
      ],
    };
    expect(() =>
      validateQueuePageRepresentation(safe, {
        workspaceId: "w1",
        projectIds: ["p1"],
        fullFilteredCount: 1,
        expectedOrdinals: [3],
      }),
    ).not.toThrow();
    expect(() =>
      validateQueuePageRepresentation(
        {
          ...safe,
          items: [
            {
              ...safe.items[0],
              appliedOrderOverride: {
                ...safe.items[0]!.appliedOrderOverride,
                anchorWorkItemId: "hidden",
              },
            },
          ],
        },
        { workspaceId: "w1", projectIds: ["p1"], fullFilteredCount: 1, expectedOrdinals: [3] },
      ),
    ).toThrow("QUEUE_PAGE_OVERRIDE_DISCLOSURE_FORBIDDEN");
  });

  it("round-trips bounded cursors and uses a strong representation ETag", () => {
    const cursor = {
      schemaVersion: "queue-cursor@1.0.0" as const,
      principalId: "u1",
      workspaceId: "w1",
      authorizedProjectSetHash: hash("1"),
      normalizedQueryHash: hash("5"),
      comparatorRef: "queue-order@1.0.0" as const,
      projectionGeneration: hash("2"),
      asOf: "2026-09-03T08:00:00.000Z",
      boundaryOrdinal: 4,
    };
    expect(decodeQueueCursor(encodeQueueCursor(cursor))).toEqual(cursor);
    const first = queuePageEtag(page());
    const second = queuePageEtag({ ...page(), asOf: "2026-09-03T08:00:01.000Z" });
    expect(first).toMatch(/^"sha256:[a-f0-9]{64}"$/u);
    expect(second).not.toBe(first);
  });
});
