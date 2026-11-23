import { describe, expect, it } from "vitest";

import { MockOperationalService } from "../../apps/mock-hub/src/operational/operational.controller.ts";
import {
  InMemoryMockOperationalRepository,
  type MockOperationalRequestResult,
} from "../../apps/mock-hub/src/operational/operational.repository.ts";
import { InMemoryMockStateRepository } from "../../apps/mock-hub/src/persistence/mock-state.repository.ts";
import { createOperationalWorkItemMockConnector } from "../../packages/connector-mock/src/index.ts";
import type {
  ConnectorRuntimeContext,
  OperationalRequestCreateInput,
  OperationalRequestCreateResult,
  OperationalWorkItemTarget,
} from "../../packages/connector-sdk/src/index.ts";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const profileRef = Object.freeze({ id: "33333333-3333-4333-8333-333333333333", version: 1 });
const target: OperationalWorkItemTarget = Object.freeze({
  workspaceId,
  projectId,
  entityKind: "REQUEST",
  authorityScopeKey: "qa.alpha",
  naturalKey: "draft-00000001",
});
const sparse: OperationalRequestCreateInput = Object.freeze({
  sourceDraftId: "44444444-4444-4444-8444-444444444444",
  workTypeKey: "qa.validation",
  workTypeVersion: "1.0.0",
  requestKind: "feature-validation",
  summary: "Validate sparse confirmed intake",
  requestedNormalizedStatus: "NEW",
  dataClassificationKey: "INTERNAL",
});
const context = (effectIdempotencyKey: string): ConnectorRuntimeContext => ({
  scope: { kind: "PROJECT", workspaceId, projectId },
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

interface ConformanceAdapter {
  create(effectKey: string): Promise<OperationalRequestCreateResult>;
  read(effectKey: string): Promise<OperationalRequestCreateResult | undefined>;
  calls(): number;
  capturedInput(): OperationalRequestCreateInput | undefined;
}

function mockAdapter(): ConformanceAdapter {
  const operational = new InMemoryMockOperationalRepository();
  const service = new MockOperationalService(
    operational,
    new InMemoryMockStateRepository(),
    () => "2026-08-30T10:00:00.000Z",
  );
  let captured: OperationalRequestCreateInput | undefined;
  let callCount = 0;
  const connector = createOperationalWorkItemMockConnector({
    createRequest: async (request) => {
      callCount += 1;
      captured = structuredClone(request.payload);
      return (await service.createRequest(request)) as MockOperationalRequestResult;
    },
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
  return {
    create: async (key) =>
      await connector.operations.requestCreate.handler.invoke(context(key), target, sparse),
    read: async (key) => await connector.readRequestCreateByEffect(context(key), target, key),
    calls: () => callCount,
    capturedInput: () => captured,
  };
}

function secondInMemoryAdapter(): ConformanceAdapter {
  const effects = new Map<string, OperationalRequestCreateResult>();
  let captured: OperationalRequestCreateInput | undefined;
  let callCount = 0;
  return {
    create: async (key) => {
      callCount += 1;
      captured = structuredClone(sparse);
      const current = effects.get(key);
      if (current) return current;
      const value: OperationalRequestCreateResult = Object.freeze({
        operation: "request.create",
        entityKind: "REQUEST",
        externalEntityId: `ALT-${target.naturalKey}`,
        externalDisplayKey: `ALT-${target.naturalKey}`,
        externalVersion: "1",
        rawExternalState: "OPEN",
        normalizedStatus: "NEW",
        naturalKey: target.naturalKey!,
        effectId: key,
        observedAt: "2026-08-30T10:00:00.000Z",
      });
      effects.set(key, value);
      return value;
    },
    read: async (key) => effects.get(key),
    calls: () => callCount,
    capturedInput: () => captured,
  };
}

describe.each([
  ["Mock Connector", mockAdapter],
  ["second in-memory implementation", secondInMemoryAdapter],
] as const)("operational-work-item request.create conformance: %s", (_name, factory) => {
  it("preserves sparse human facts and confirms one create effect", async () => {
    const adapter = factory();
    const first = await adapter.create("effect:create:1");
    const repeated = await adapter.create("effect:create:1");
    const readBack = await adapter.read("effect:create:1");

    expect(first).toEqual(repeated);
    expect(readBack).toEqual(first);
    expect(first).toMatchObject({
      operation: "request.create",
      entityKind: "REQUEST",
      normalizedStatus: "NEW",
      effectId: "effect:create:1",
    });
    expect(adapter.capturedInput()).toEqual(sparse);
    expect(adapter.capturedInput()).not.toHaveProperty("description");
    expect(adapter.capturedInput()).not.toHaveProperty("acceptanceOutcome");
    expect(adapter.calls()).toBe(2);
  });

  it("keeps future transition and defect operations outside the US1 runtime surface", () => {
    const adapter = factory() as ConformanceAdapter & Record<string, unknown>;
    expect(adapter.transition).toBeUndefined();
    expect(adapter.createDefect).toBeUndefined();
  });
});
