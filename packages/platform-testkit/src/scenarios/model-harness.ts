export type FakeModelScenario = "VALID" | "INVALID_OUTPUT" | "TIMEOUT";
export class FakeModelHarness {
  constructor(private scenario: FakeModelScenario = "VALID") {}
  setScenario(scenario: FakeModelScenario): void {
    this.scenario = scenario;
  }
  async complete(): Promise<unknown> {
    if (this.scenario === "TIMEOUT") throw new Error("MODEL_TIMEOUT");
    if (this.scenario === "INVALID_OUTPUT") return Object.freeze({ malformed: true });
    return Object.freeze({ title: "Deterministic fallback", confidence: 1 });
  }
}
