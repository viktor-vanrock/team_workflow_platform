import { describe, expect, it } from "vitest";

import {
  DeterministicFakeProposalModel,
  modelWithDeterministicFallback,
} from "../../../packages/runtime-composition/src/index.ts";

describe("deterministic model fallback selection", () => {
  it.each([
    "INVALID_JSON",
    "PROMPT_INJECTION",
    "TIMEOUT",
    "RATE_LIMIT",
    "UNAVAILABLE",
    "CONTRADICTORY",
  ] as const)("falls back for %s", async (outcome) => {
    const model = new DeterministicFakeProposalModel(outcome, { valid: true });
    const result = await modelWithDeterministicFallback({
      model: async () => await model.propose({}),
      validate: (value): value is { valid: true } =>
        Boolean(value && typeof value === "object" && "valid" in value),
      fallback: () => ({ valid: true as const }),
      fallbackAllowed: true,
    });
    expect(result).toMatchObject({ value: { valid: true }, fallback: true });
  });

  it("denies invalid output when the skill has no fallback", async () => {
    await expect(
      modelWithDeterministicFallback({
        model: async () => "invalid",
        validate: (value): value is never => {
          void value;
          return false;
        },
        fallback: () => {
          throw new Error("must-not-run");
        },
        fallbackAllowed: false,
      }),
    ).rejects.toThrow("MODEL_OUTPUT_INVALID_DENIED");
  });
});
