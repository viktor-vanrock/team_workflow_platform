import { describe, expect, it } from "vitest";

import { IntakeCandidateAggregate } from "../../../packages/platform-core/src/index.ts";

describe("IntakeCandidate", () => {
  it("deduplicates identical observations, appends changes and applies expiry before snooze wake", () => {
    const candidate = IntakeCandidateAggregate.discover({
      id: "c",
      workspaceId: "w",
      projectId: "p",
      deduplicationKey: "k",
      currentSourceFingerprint: "f1",
      expiresAt: new Date("2026-09-03"),
    });
    expect(candidate.observe("f1", 1).appended).toBe(false);
    expect(candidate.observe("f2", 1)).toMatchObject({ appended: true, version: 2 });
    candidate.decide("HUMAN", "SNOOZE", new Date("2026-09-01"), 2, {
      snoozedUntil: new Date("2026-09-02"),
    });
    expect(candidate.effectiveState(new Date("2026-09-02T01:00:00Z"))).toBe("PENDING_CONFIRMATION");
    expect(candidate.effectiveState(new Date("2026-09-03"))).toBe("EXPIRED");
  });
});
