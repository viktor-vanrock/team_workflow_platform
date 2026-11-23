import type { MockScenario, MockStateRepository } from "../persistence/mock-state.repository.ts";
import { MockScenarioError } from "../scenario-error.ts";

const failures = Object.freeze({
  TIMEOUT: Object.freeze({ code: "TIMEOUT", retryable: true }),
  AUTHENTICATION_FAILED: Object.freeze({ code: "CONNECTOR_UNAUTHORIZED", retryable: false }),
  AUTHORIZATION_DENIED: Object.freeze({ code: "CONNECTOR_FORBIDDEN", retryable: false }),
  RATE_LIMITED: Object.freeze({ code: "RATE_LIMITED", retryable: true }),
  SERVER_ERROR: Object.freeze({ code: "SERVER_ERROR", retryable: true }),
  SCHEMA_DRIFT: Object.freeze({ code: "SCHEMA_DRIFT", retryable: false }),
});

export async function consumeOperationalCreateScenario(
  repository: MockStateRepository,
): Promise<MockScenario> {
  const scenario = await repository.consumeScenario();
  const failure = failures[scenario as keyof typeof failures];
  if (failure) {
    throw new MockScenarioError(
      failure.code,
      `Injected Mock Hub operational scenario: ${scenario}`,
      failure.retryable,
    );
  }
  return scenario;
}
