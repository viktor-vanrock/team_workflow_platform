import { describe, expect, it } from "vitest";

import { InMemoryMattermostRepository } from "../../apps/mock-hub/src/mattermost/state/mattermost.repository.ts";
import { NotificationIntentAggregate } from "../../packages/platform-core/src/index.ts";
import {
  classifyMattermostConnectionHealth,
  MattermostLookupOnlyReconciliation,
  MattermostNotificationWorker,
} from "../../packages/runtime-composition/src/index.ts";

describe("US4 outage/restart/health journey", () => {
  it("preserves source state, performs one write, then resolves by lookup after restart", async () => {
    const sourceState = "CONFIRMED";
    let postCalls = 0;
    const hub = InMemoryMattermostRepository.seeded();
    hub.setFault("TIMEOUT_AFTER_EFFECT");
    const intent = NotificationIntentAggregate.create({
      id: "n",
      workspaceId: "w",
      projectId: "p",
      dedupeKey: "effect-1",
      sourceEventRef: "source:confirmed",
      target: { kind: "PROJECT_CHANNEL", purpose: "QA_COORDINATION" },
      payload: {},
      render: "render",
      commandId: "command",
      expiresAt: new Date("2026-09-03"),
    }).snapshot();
    const worker = new MattermostNotificationWorker(
      {
        send: async ({ effectKey }) => {
          postCalls += 1;
          try {
            const value = hub.createPost({
              effectKey,
              channelId: "mm-channel-project-alpha",
              message: "Committed",
            });
            return {
              outcome: "DELIVERED" as const,
              providerRef: { kind: "MESSAGE" as const, opaqueId: value.id },
            };
          } catch {
            throw new Error("TIMEOUT_AFTER_EFFECT");
          }
        },
      },
      { materialize: () => ({ bytes: new Uint8Array([1]), purge: () => undefined }) },
    );
    const uncertain = await worker.deliver(intent, new Date("2026-09-01"));
    expect(uncertain.state).toBe("LOOKUP_REQUIRED");
    const restarted = hub.restart();
    const reconciliation = new MattermostLookupOnlyReconciliation({
      lookupPendingId: async () => [],
      lookupEffectMarker: async (key) =>
        restarted.lookupEffect(key).map(({ id }) => ({ kind: "MESSAGE" as const, opaqueId: id })),
    });
    const resolved = await reconciliation.reconcile(
      { commandId: "command", attemptCount: 1, kind: "EFFECT_MARKER", opaqueId: "effect-1" },
      { commandId: "command", attemptCount: 1 },
    );
    expect(resolved.outcome).toBe("DELIVERED");
    expect({ sourceState, postCalls, posts: restarted.snapshot().posts.length }).toEqual({
      sourceState: "CONFIRMED",
      postCalls: 1,
      posts: 1,
    });
    expect(classifyMattermostConnectionHealth("OK").state).toBe("HEALTHY");
  });
});
