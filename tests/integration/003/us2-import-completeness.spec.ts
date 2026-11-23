import { describe, expect, it } from "vitest";

import { onOperationalImport } from "../../../packages/competency-qa/src/application/on-operational-import.ts";

describe("US2 imported QA completeness", () => {
  it("returns NEEDS_INFO without inventing provider status", () => {
    const result = onOperationalImport({
      workItemId: "w1",
      normalizedOperationalStatus: "NEW",
      requiredFields: ["goal", "acceptanceOutcome"],
      fields: { goal: "Verify" },
    });
    expect(result).toEqual({
      workItemId: "w1",
      completeness: "NEEDS_INFO",
      missingFields: ["acceptanceOutcome"],
      normalizedOperationalStatus: "NEW",
    });
  });
});
