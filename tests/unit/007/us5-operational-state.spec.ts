import { describe, expect, it } from "vitest";

import { recalculateResumeMode } from "../../../packages/runtime-composition/src/onboarding/project-suspension-service.ts";

describe("US5 state", () => {
  it("preserves intended mode and safely recalculates", () => {
    expect(recalculateResumeMode("FULL_QA", true)).toBe("FULL_QA");
    expect(recalculateResumeMode("FULL_QA", false)).toBe("MANUAL_ONLY");
  });
});
