import { describe, expect, it } from "vitest";

import { runFullQaPromotionScenario } from "../../../packages/runtime-composition/src/onboarding/full-qa-promotion-scenario.ts";

describe("Feature 007 US2 full-QA promotion journey", () => {
  it("conforms GitLab, promotes, completes automation and preserves historical pins", async () => {
    const result = await runFullQaPromotionScenario();
    expect(result).toMatchObject({
      status: "PASS",
      stage: "SHADOW",
      capabilityMode: "FULL_QA",
      operationalState: "ACTIVE",
      gitLabProbeCount: 3,
      acceptance: "ACCEPTED",
      ownerApprovalConsumed: true,
      automatedSession: { state: "COMPLETED", providerEffects: 1 },
      mattermostFallback: "WEB_AND_OUTBOX",
      rolloutLease: { overlapDenial: "ROLLOUT_LEASE_HELD", recoveredStage: "PILOT_ACTIVE" },
    });
    expect(result.previousSessionBindingRef).not.toEqual(result.currentSessionBindingRef);
    expect(result.previousSessionBindingRef.version).toBeLessThan(
      result.currentSessionBindingRef.version,
    );
  });
});
