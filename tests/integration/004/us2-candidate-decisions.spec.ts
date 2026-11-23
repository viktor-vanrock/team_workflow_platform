import { describe, expect, it } from "vitest";

import { IntakeCandidateAggregate } from "../../../packages/platform-core/src/index.ts";

const candidate = () =>
  IntakeCandidateAggregate.discover({
    id: "c",
    workspaceId: "w",
    projectId: "p",
    deduplicationKey: "key",
    currentSourceFingerprint: "v1",
    expiresAt: new Date("2026-09-03"),
  });
describe("US2 candidate decisions", () => {
  for (const decision of ["CREATE", "SNOOZE", "IGNORE"] as const)
    it(`records ${decision} without operational work`, () => {
      const value = candidate();
      const result = value.decide("HUMAN", decision, new Date("2026-09-01"), 1, {
        expectedSourceObservationVersion: 1,
        ...(decision === "CREATE" ? { convertedDraftId: "draft" } : {}),
        ...(decision === "SNOOZE" ? { snoozedUntil: new Date("2026-09-02") } : {}),
      });
      expect(result.state).toBe(
        decision === "CREATE" ? "CONVERTED" : decision === "SNOOZE" ? "SNOOZED" : "IGNORED",
      );
      expect(result).not.toHaveProperty("workItemId");
    });
  it("lets expiry win and wakes only after snooze", () => {
    const value = candidate();
    value.decide("HUMAN", "SNOOZE", new Date("2026-09-01"), 1, {
      expectedSourceObservationVersion: 1,
      snoozedUntil: new Date("2026-09-02"),
    });
    expect(value.effectiveState(new Date("2026-09-02T01:00:00Z"))).toBe("PENDING_CONFIRMATION");
    expect(value.effectiveState(new Date("2026-09-04"))).toBe("EXPIRED");
  });
});
