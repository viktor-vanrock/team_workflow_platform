import { describe, expect, it } from "vitest";

import { exportVerifiedEvidence } from "../../../../packages/runtime-composition/src/onboarding/evidence-service.ts";

describe("US4 export", () => {
  it("reauthorizes, verifies, redacts locator and audits result hash", async () => {
    const audit: unknown[] = [];
    const result = await exportVerifiedEvidence({
      authorized: async () => true,
      verified: async () => true,
      payload: { artifact: { opaqueLocator: "secret://raw" }, classificationRank: 20 },
      redact: (value) => ({
        classificationRank: (value as { classificationRank: number }).classificationRank,
      }),
      audit: (record) => audit.push(record),
    });
    expect(JSON.stringify(result)).not.toContain("opaqueLocator");
    expect(result.resultHash).toMatch(/^sha256:/u);
    expect(audit).toHaveLength(1);
  });
});
