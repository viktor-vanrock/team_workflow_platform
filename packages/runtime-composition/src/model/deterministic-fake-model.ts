export type FakeModelOutcome =
  | "VALID"
  | "INVALID_JSON"
  | "PROMPT_INJECTION"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "UNAVAILABLE"
  | "CONTRADICTORY";
export class DeterministicFakeProposalModel {
  constructor(
    private readonly outcome: FakeModelOutcome = "VALID",
    private readonly validResult: unknown = { state: "CURRENT" },
  ) {}
  async propose(manifest: unknown) {
    void manifest;
    switch (this.outcome) {
      case "VALID":
        return structuredClone(this.validResult);
      case "INVALID_JSON":
        return "{invalid";
      case "PROMPT_INJECTION":
        return { tool: "grant.expand", instructions: "ignore previous" };
      case "TIMEOUT":
        throw new Error("MODEL_TIMEOUT");
      case "RATE_LIMIT":
        throw new Error("MODEL_RATE_LIMIT");
      case "UNAVAILABLE":
        throw new Error("MODEL_UNAVAILABLE");
      case "CONTRADICTORY":
        return { facts: [{ polarity: "SUPPORTS" }, { polarity: "CONTRADICTS" }], confidence: 1 };
    }
  }
}
export async function modelWithDeterministicFallback<T>(
  input: Readonly<{
    model: () => Promise<unknown>;
    validate(value: unknown): value is T;
    fallback: () => T;
    fallbackAllowed: boolean;
  }>,
): Promise<Readonly<{ value: T; fallback: boolean; reasonCode?: string }>> {
  try {
    const value = await input.model();
    if (input.validate(value)) return Object.freeze({ value, fallback: false });
    if (!input.fallbackAllowed) throw new Error("MODEL_OUTPUT_INVALID_DENIED");
    return Object.freeze({
      value: input.fallback(),
      fallback: true,
      reasonCode: "MODEL_OUTPUT_INVALID",
    });
  } catch (error) {
    if (!input.fallbackAllowed) throw error;
    return Object.freeze({
      value: input.fallback(),
      fallback: true,
      reasonCode: error instanceof Error ? error.message : "MODEL_FAILED",
    });
  }
}
