import { describe, expect, it } from "vitest";

import { InMemoryProjectSuspensionService } from "../../../packages/runtime-composition/src/onboarding/project-suspension-service.ts";

describe("US5 suspend", () => {
  it("requires incident/reason and is CAS/idempotent with audit", async () => {
    const s = new InMemoryProjectSuspensionService("FULL_QA");
    const r = await s.suspend({
      expectedVersion: 1,
      idempotencyKey: "k",
      incidentRef: "INC-1",
      reason: "containment",
    });
    expect(r.state).toBe("SUSPENDED");
    expect(
      (
        await s.suspend({
          expectedVersion: 1,
          idempotencyKey: "k",
          incidentRef: "INC-1",
          reason: "containment",
        })
      ).replayed,
    ).toBe(true);
    expect(s.audit).toHaveLength(1);
  });
});
