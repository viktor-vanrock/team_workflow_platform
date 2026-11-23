import { describe, expect, it } from "vitest";

import { MockOperationalService } from "../../apps/mock-hub/src/operational/operational.controller.ts";
import { InMemoryMockOperationalRepository } from "../../apps/mock-hub/src/operational/operational.repository.ts";
import {
  InMemoryMockStateRepository,
  type MockScenario,
} from "../../apps/mock-hub/src/persistence/mock-state.repository.ts";
import { createOperationalWorkItemMockConnector } from "../../packages/connector-mock/src/index.ts";
import type {
  ConnectorRuntimeContext,
  OperationalRequestCreateInput,
  OperationalWorkItemTarget,
} from "../../packages/connector-sdk/src/index.ts";
import { classifyConnectorFailure } from "../../packages/platform-core/src/index.ts";

const scope = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
};
const target: OperationalWorkItemTarget = {
  ...scope,
  entityKind: "REQUEST",
  authorityScopeKey: "qa.alpha",
  naturalKey: "failure-draft-1",
};
const payload: OperationalRequestCreateInput = {
  sourceDraftId: "44444444-4444-4444-8444-444444444444",
  workTypeKey: "qa.validation",
  workTypeVersion: "1.0.0",
  requestKind: "investigation",
  summary: "Failure classification",
  requestedNormalizedStatus: "NEW",
  dataClassificationKey: "INTERNAL",
};
const context: ConnectorRuntimeContext = {
  scope: { kind: "PROJECT", ...scope },
  actor: {
    kind: "SERVICE",
    principalId: "55555555-5555-4555-8555-555555555555",
    serviceKey: "worker.local",
  },
  correlationId: "66666666-6666-4666-8666-666666666666",
  causationId: "77777777-7777-4777-8777-777777777777",
  effectIdempotencyKey: "effect:failure:1",
  profileRef: { id: "33333333-3333-4333-8333-333333333333", version: 1 },
  classification: { key: "INTERNAL", rank: 2 },
  signal: new AbortController().signal,
};

describe.each([
  ["AUTHENTICATION_FAILED", "CONNECTOR_UNAUTHORIZED", "FAILED"],
  ["AUTHORIZATION_DENIED", "CONNECTOR_FORBIDDEN", "FAILED"],
  ["RATE_LIMITED", "RATE_LIMITED", "RETRY_SCHEDULED"],
  ["SERVER_ERROR", "SERVER_ERROR", "RETRY_SCHEDULED"],
  ["SCHEMA_DRIFT", "SCHEMA_DRIFT", "FAILED"],
] as const)("Connector scenario %s", (scenario, code, terminalStatus) => {
  it("keeps canonical state external and projects correct retry/terminal semantics", async () => {
    const operational = new InMemoryMockOperationalRepository();
    const scenarios = new InMemoryMockStateRepository();
    await scenarios.setScenario({ scenario: scenario as MockScenario, appliesToNext: 1 });
    const service = new MockOperationalService(operational, scenarios);
    const connector = createOperationalWorkItemMockConnector({
      createRequest: async (request) => await service.createRequest(request),
      readRequestEffect: async (request) => {
        const result = (await operational.effectByKey(request.scope, request.effectIdempotencyKey))
          ?.result;
        if (result && result.operation !== "request.create")
          throw new Error("Unexpected transition receipt");
        return result;
      },
      transitionRequest: async () => {
        throw new Error("request.transition is outside this fixture");
      },
      readRequestTransitionEffect: async () => undefined,
    });
    await expect(
      connector.operations.requestCreate.handler.invoke(context, target, payload),
    ).rejects.toMatchObject({ code });
    expect(classifyConnectorFailure(code, 1).terminalStatus).toBe(terminalStatus);
    expect(await operational.effectCount()).toBe(0);
    expect(
      await connector.readRequestCreateByEffect(context, target, context.effectIdempotencyKey),
    ).toBeUndefined();
  });
});
