import { describe, expect, it } from "vitest";

import { createProjectEventEnvelope } from "../../../packages/platform-core/src/index.ts";
import { ProjectOnboardingEventWorker } from "../../../packages/runtime-composition/src/onboarding/worker.ts";

describe("onboarding event delivery", () => {
  it("retries a failed sink before acknowledgment and deduplicates only applied events", async () => {
    const event = createProjectEventEnvelope({
      eventId: "retry-event",
      eventType: "PROJECT_OPERATIONAL_STATE_CHANGED",
      scope: { workspaceId: "workspace", projectId: "project" },
      subjectRef: { id: "revision", version: 1, contentHash: `sha256:${"a".repeat(64)}` },
      relatedRefs: [],
      reasonCode: "PROJECT_SUSPENDED",
      actor: { kind: "SERVICE", principalId: "service", serviceKey: "test" },
      occurredAt: new Date().toISOString(),
      correlationId: "correlation",
      causationId: "causation",
    });
    let attempts = 0,
      receipts = 0,
      acknowledged = 0,
      quarantined = 0;
    const worker = new ProjectOnboardingEventWorker(
      {
        ready: async () => [event],
        acknowledge: async () => {
          acknowledged++;
        },
        quarantine: async () => {
          quarantined++;
        },
      },
      {
        apply: async () => {
          attempts++;
          if (attempts === 1) throw new Error("DATABASE_UNAVAILABLE");
          receipts++;
        },
      },
    );
    await expect(worker.run()).rejects.toThrow("DATABASE_UNAVAILABLE");
    expect({ receipts, acknowledged }).toEqual({ receipts: 0, acknowledged: 0 });
    await expect(worker.run()).resolves.toEqual({ applied: 1, duplicates: 0, quarantined: 0 });
    await expect(worker.run()).resolves.toEqual({ applied: 0, duplicates: 1, quarantined: 0 });
    expect({ attempts, receipts, acknowledged, quarantined }).toEqual({
      attempts: 2,
      receipts: 1,
      acknowledged: 2,
      quarantined: 0,
    });
  });
});
