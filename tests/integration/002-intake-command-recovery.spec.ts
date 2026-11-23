import { describe, expect, it } from "vitest";

import { MockOperationalService } from "../../apps/mock-hub/src/operational/operational.controller.ts";
import { InMemoryMockOperationalRepository } from "../../apps/mock-hub/src/operational/operational.repository.ts";
import { InMemoryMockStateRepository } from "../../apps/mock-hub/src/persistence/mock-state.repository.ts";
import { createOperationalWorkItemMockConnector } from "../../packages/connector-mock/src/index.ts";
import type {
  ConnectorRuntimeContext,
  OperationalRequestCreateInput,
  OperationalWorkItemTarget,
} from "../../packages/connector-sdk/src/index.ts";

const scope = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
};
const profileRef = { id: "33333333-3333-4333-8333-333333333333", version: 1 };
const target: OperationalWorkItemTarget = {
  ...scope,
  entityKind: "REQUEST",
  authorityScopeKey: "qa.alpha",
  naturalKey: "recovery-draft-1",
};
const payload: OperationalRequestCreateInput = {
  sourceDraftId: "44444444-4444-4444-8444-444444444444",
  workTypeKey: "qa.validation",
  workTypeVersion: "1.0.0",
  requestKind: "smoke",
  summary: "Recover one create",
  requestedNormalizedStatus: "NEW",
  dataClassificationKey: "INTERNAL",
};
const runtime = (effectIdempotencyKey: string): ConnectorRuntimeContext => ({
  scope: { kind: "PROJECT", ...scope },
  actor: {
    kind: "SERVICE",
    principalId: "55555555-5555-4555-8555-555555555555",
    serviceKey: "worker.local",
  },
  correlationId: "66666666-6666-4666-8666-666666666666",
  causationId: "77777777-7777-4777-8777-777777777777",
  effectIdempotencyKey,
  profileRef,
  classification: { key: "INTERNAL", rank: 2 },
  signal: new AbortController().signal,
});

function harness() {
  const repository = new InMemoryMockOperationalRepository();
  const scenarios = new InMemoryMockStateRepository();
  const service = new MockOperationalService(
    repository,
    scenarios,
    () => "2026-08-30T10:00:00.000Z",
  );
  const transport = {
    createRequest: async (request: Parameters<typeof service.createRequest>[0]) =>
      await service.createRequest(request),
    readRequestEffect: async (
      request: Readonly<{ effectIdempotencyKey: string; scope: typeof scope }>,
    ) => {
      const result = (await repository.effectByKey(request.scope, request.effectIdempotencyKey))
        ?.result;
      if (result && result.operation !== "request.create")
        throw new Error("Unexpected transition receipt");
      return result;
    },
    transitionRequest: async () => {
      throw new Error("request.transition is outside this fixture");
    },
    readRequestTransitionEffect: async () => undefined,
  };
  return { repository, scenarios, service, transport };
}

describe("US1 request.create crash windows", () => {
  it("retries timeout before effect with the same stable key and creates one effect", async () => {
    const { repository, scenarios, transport } = harness();
    await scenarios.setScenario({ scenario: "TIMEOUT", appliesToNext: 1 });
    const connector = createOperationalWorkItemMockConnector(transport);
    await expect(
      connector.operations.requestCreate.handler.invoke(
        runtime("effect:stable:1"),
        target,
        payload,
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(await repository.effectCount()).toBe(0);
    await connector.operations.requestCreate.handler.invoke(
      runtime("effect:stable:1"),
      target,
      payload,
    );
    expect(await repository.effectCount()).toBe(1);
  });

  it("recovers after effect before local confirmation across worker restart and process-memory loss", async () => {
    const { repository, transport } = harness();
    const firstWorker = createOperationalWorkItemMockConnector(transport);
    const receipt = await firstWorker.operations.requestCreate.handler.invoke(
      runtime("effect:stable:2"),
      target,
      payload,
    );
    expect(receipt.effectId).toBe("effect:stable:2");

    // A new connector instance has no process-local memory; provider ledger remains authoritative.
    const restartedWorker = createOperationalWorkItemMockConnector(transport);
    const reconciled = await restartedWorker.readRequestCreateByEffect(
      runtime("effect:stable:2"),
      target,
      "effect:stable:2",
    );
    expect(reconciled).toEqual(receipt);
    expect(await repository.effectCount()).toBe(1);
  });
});
