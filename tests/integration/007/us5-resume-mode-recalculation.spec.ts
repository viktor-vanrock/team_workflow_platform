import { describe, expect, it } from "vitest";

import { InMemoryProjectSuspensionService } from "../../../packages/runtime-composition/src/onboarding/project-suspension-service.ts";

describe("US5 resume mode", () => {
  it("restores or safely downgrades intended mode", async () => {
    const s = new InMemoryProjectSuspensionService("FULL_QA");
    await s.suspend({
      expectedVersion: 1,
      idempotencyKey: "s",
      incidentRef: "INC",
      reason: "risk",
    });
    expect(
      (
        await s.resume({
          expectedVersion: 2,
          idempotencyKey: "r",
          probesFresh: true,
          incidentAccepted: true,
          stepUp: true,
          distinctOwnerApproval: true,
          requirementsPass: false,
        })
      ).mode,
    ).toBe("MANUAL_ONLY");
  });
});
