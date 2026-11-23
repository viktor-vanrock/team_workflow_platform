import { describe, expect, it } from "vitest";

import { evaluateQaReadiness } from "../../../packages/competency-qa/src/application/readiness-evaluator.ts";
import { makeCompleteReadinessInput } from "../../support/002-readiness-fixture.ts";

describe("008 readiness classification boundary", () => {
  it.each([
    ["CONFIDENTIAL", "RESTRICTED", false],
    ["RESTRICTED", "CONFIDENTIAL", true],
    ["UNKNOWN", "CONFIDENTIAL", false],
    ["PUBLIC", "UNKNOWN", false],
  ])("evaluates %s against current %s ceiling", async (classification, ceiling, allowed) => {
    const input = makeCompleteReadinessInput();
    const assessment = await evaluateQaReadiness({
      ...input,
      currentInput: { ...input.currentInput, dataClassificationKey: classification as string },
      maximumClassificationKey: ceiling as string,
    });
    expect(assessment.blockers.some(({ code }) => code === "CLASSIFICATION_NOT_ALLOWED")).toBe(
      !allowed,
    );
  });
});
