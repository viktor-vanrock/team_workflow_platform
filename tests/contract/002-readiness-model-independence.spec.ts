import { describe, expect, it, vi } from "vitest";

import { evaluateQaReadiness } from "../../packages/competency-qa/src/application/readiness-evaluator.ts";
import { makeCompleteReadinessInput } from "../support/002-readiness-fixture.ts";

describe("readiness model independence", () => {
  it.each(["unset", "invalid", "timeout"])("is byte-identical when a model is %s", async () => {
    const provider = vi.fn(async () => {
      throw new Error("must not be called");
    });
    const input = makeCompleteReadinessInput();
    const first = await evaluateQaReadiness(input);
    const second = await evaluateQaReadiness(structuredClone(input));
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.blockers).toEqual(first.blockers);
    expect(provider).not.toHaveBeenCalled();
  });
});
