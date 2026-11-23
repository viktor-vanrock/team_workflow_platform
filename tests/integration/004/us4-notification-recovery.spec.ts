import { describe, expect, it } from "vitest";

import { NotificationIntentAggregate } from "../../../packages/platform-core/src/index.ts";
import {
  MattermostLookupOnlyReconciliation,
  MattermostNotificationWorker,
} from "../../../packages/runtime-composition/src/index.ts";

const snapshot = () =>
  NotificationIntentAggregate.create({
    id: "n",
    workspaceId: "w",
    projectId: "p",
    dedupeKey: "effect",
    sourceEventRef: "event",
    target: { kind: "PROJECT_CHANNEL", purpose: "QA_COORDINATION" },
    payload: {},
    render: "render",
    commandId: "command",
    expiresAt: new Date("2026-09-03"),
  }).snapshot();
describe("US4 notification recovery", () => {
  it("rebuilds before the marker but moves all post-marker uncertainty to lookup", async () => {
    let materializations = 0,
      purges = 0,
      posts = 0;
    const worker = new MattermostNotificationWorker(
      {
        send: async () => {
          posts += 1;
          throw new Error("TIMEOUT_AFTER_EFFECT");
        },
      },
      {
        materialize: () => {
          materializations += 1;
          return {
            bytes: new Uint8Array([1]),
            purge: () => {
              purges += 1;
            },
          };
        },
      },
    );
    const result = await worker.deliver(snapshot(), new Date("2026-09-01"));
    expect(result.state).toBe("LOOKUP_REQUIRED");
    expect({ materializations, purges, posts }).toEqual({
      materializations: 1,
      purges: 1,
      posts: 1,
    });
  });
  it.each([
    [true, 0, "AMBIGUOUS"],
    [true, 1, "DELIVERED"],
    [true, 2, "AMBIGUOUS"],
    [false, 0, "AMBIGUOUS"],
  ] as const)("classifies supported=%s matches=%s as %s", async (supported, count, state) => {
    const reconciliation = new MattermostLookupOnlyReconciliation({
      lookupPendingId: async () => [],
      lookupEffectMarker: async () =>
        Array.from({ length: count }, (_, i) => ({
          kind: "MESSAGE" as const,
          opaqueId: `post-${i}`,
        })),
    });
    expect(
      (
        await reconciliation.reconcile(
          { commandId: "c", attemptCount: 1, kind: "EFFECT_MARKER", opaqueId: "marker" },
          { commandId: "c", attemptCount: 1 },
          supported,
        )
      ).outcome,
    ).toBe(state);
  });
});
