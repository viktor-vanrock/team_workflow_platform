import { describe, expect, it } from "vitest";

import {
  canonicalOrderScopeMembership,
  selectAffectedOrderScopes,
} from "../../../packages/platform-persistence-typeorm/src/queue-control.repository.ts";
import { createQueueOrderInvalidation } from "../../../packages/platform-persistence-typeorm/src/queue-order-invalidation.repository.ts";
import { createViewLocalAppliedOrderOverride } from "../../../packages/runtime-composition/src/queue/portfolio-query.ts";

describe("US2 order persistence and view-local effects", () => {
  it("canonicalizes exact portfolio membership and uses reverse Project membership only", () => {
    expect(canonicalOrderScopeMembership(["B", "A", "A"])).toEqual({
      projectIds: ["A", "B"],
      authorizedProjectSetHash: expect.stringMatching(/^sha256:/u),
    });
    expect(
      selectAffectedOrderScopes("A", [
        { orderScopeId: "a-only", projectIds: ["A"] },
        { orderScopeId: "a-b", projectIds: ["A", "B"] },
        { orderScopeId: "b-only", projectIds: ["B"] },
      ]),
    ).toEqual(["a-b", "a-only"]);
  });

  it("derives reproducible, redacted, overlapping view-local outcomes without mutating QueueEntry", () => {
    const retained = {
      orderScopeId: "scope-ab",
      subjectWorkItemId: "w1",
      overrideId: "override-1",
      orderScopeResourceVersion: 4,
      scopeKind: "AUTHORIZED_PORTFOLIO" as const,
      placement: "BEFORE" as const,
      reason: "Lead ordering",
      acceptedAt: "2026-09-03T08:00:00.000Z",
      expiresAt: "2026-09-04T08:00:00.000Z",
    };
    const applied = createViewLocalAppliedOrderOverride({ ...retained, anchorVisible: true });
    const repeated = createViewLocalAppliedOrderOverride({ ...retained, anchorVisible: true });
    const hidden = createViewLocalAppliedOrderOverride({ ...retained, anchorVisible: false });
    expect(repeated).toEqual(applied);
    expect(applied).toMatchObject({
      applicationState: "APPLIED",
      expiresAt: retained.expiresAt,
      appliedOverrideRef: { version: 4 },
    });
    expect(hidden).toMatchObject({ applicationState: "ANCHOR_UNAVAILABLE_NO_OP" });
    expect(hidden).not.toHaveProperty("expiresAt");
    expect(JSON.stringify([applied, hidden])).not.toMatch(/anchorVisible|anchorId|actionHash/u);
  });

  it("creates a Project-only invalidation and suppresses portfolio event fan-out", () => {
    expect(
      createQueueOrderInvalidation({
        scopeKind: "AUTHORIZED_PORTFOLIO",
        workspaceId: "w1",
        projectId: "A",
        workItemId: "wi1",
        invalidationId: "i1",
        version: 1,
        reasonCode: "ORDER_OVERRIDE_ACCEPTED",
        occurredAt: "2026-09-03T08:00:00.000Z",
      }),
    ).toBeUndefined();
    expect(
      createQueueOrderInvalidation({
        scopeKind: "PROJECT",
        workspaceId: "w1",
        projectId: "A",
        workItemId: "wi1",
        invalidationId: "i1",
        version: 1,
        reasonCode: "ORDER_OVERRIDE_ACCEPTED",
        occurredAt: "2026-09-03T08:00:00.000Z",
      }),
    ).toMatchObject({
      eventType: "queue.order.changed",
      payload: {
        workItemId: "wi1",
        invalidationRef: { version: 1, semanticHash: expect.stringMatching(/^sha256:/u) },
      },
    });
  });
});
