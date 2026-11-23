import { describe, expect, it } from "vitest";

import {
  MockOperationalService,
  type OperationalRequestCreateEnvelope,
  type OperationalRequestTransitionEnvelope,
} from "../../../apps/mock-hub/src/operational/operational.controller.ts";
import { InMemoryMockOperationalRepository } from "../../../apps/mock-hub/src/operational/operational.repository.ts";
import {
  InMemoryMockStateRepository,
  type MockScenario,
} from "../../../apps/mock-hub/src/persistence/mock-state.repository.ts";

const scope = Object.freeze({ workspaceId: "workspace-alpha", projectId: "project-alpha" });
const createdAt = "2026-08-31T10:00:00.000Z";
const createEnvelope = (
  effectIdempotencyKey = "effect:create:alpha",
  summary = "QA request",
): OperationalRequestCreateEnvelope => ({
  effectIdempotencyKey,
  correlationId: "correlation-alpha",
  scope,
  profileRef: { id: "profile-alpha", version: 4 },
  target: {
    ...scope,
    entityKind: "REQUEST",
    authorityScopeKey: "qa.alpha",
    naturalKey: "request-alpha",
  },
  payload: {
    sourceDraftId: "draft-alpha",
    workTypeKey: "qa.validation",
    workTypeVersion: "1.0.0",
    requestKind: "smoke",
    summary,
    requestedNormalizedStatus: "NEW",
    dataClassificationKey: "INTERNAL",
  },
});

function harness(repository = new InMemoryMockOperationalRepository()) {
  const scenarios = new InMemoryMockStateRepository();
  return {
    repository,
    scenarios,
    service: new MockOperationalService(repository, scenarios, () => createdAt),
  };
}

describe("AT-015 external-effect resilience", () => {
  it.each([
    ["TIMEOUT", true],
    ["RATE_LIMITED", true],
    ["SERVER_ERROR", true],
    ["AUTHENTICATION_FAILED", false],
    ["AUTHORIZATION_DENIED", false],
    ["SCHEMA_DRIFT", false],
  ] as const)("classifies %s without inventing an external effect", async (scenario, retryable) => {
    const { repository, scenarios, service } = harness();
    await scenarios.setScenario({ scenario: scenario as MockScenario, appliesToNext: 1 });
    await expect(service.createRequest(createEnvelope())).rejects.toMatchObject({ retryable });
    expect(await repository.effectCount()).toBe(0);
  });

  it("survives process loss by reconciling the same request effect key exactly once", async () => {
    const first = harness();
    const receipt = await first.service.createRequest(createEnvelope());
    const restarted = harness(first.repository);
    const replay = await restarted.service.createRequest(createEnvelope());
    expect(replay).toEqual(receipt);
    expect(await restarted.repository.effectCount()).toBe(1);
    await expect(
      restarted.service.createRequest(createEnvelope("effect:create:alpha", "mutated payload")),
    ).rejects.toThrow("EFFECT_IDEMPOTENCY_CONFLICT");
  });

  it.each(["DUPLICATE_EVENT", "OUT_OF_ORDER_EVENT"] as const)(
    "keeps one business effect under %s delivery",
    async (scenario) => {
      const { repository, scenarios, service } = harness();
      await scenarios.setScenario({ scenario, appliesToNext: 1 });
      await service.createRequest(createEnvelope(`effect:${scenario.toLowerCase()}`));
      expect(await repository.effectCount()).toBe(1);
      expect(await scenarios.events()).toHaveLength(2);
    },
  );

  it("reconciles a partial completion comment+DONE effect with the original effect key", async () => {
    const { repository, scenarios, service } = harness();
    const created = await service.createRequest(createEnvelope());
    const ready: OperationalRequestTransitionEnvelope = {
      effectIdempotencyKey: "effect:ready:alpha",
      correlationId: "correlation-alpha",
      scope,
      profileRef: { id: "profile-alpha", version: 4 },
      target: {
        ...scope,
        entityKind: "REQUEST",
        authorityScopeKey: "qa.alpha",
        externalEntityId: created.externalEntityId,
      },
      payload: {
        requestedNormalizedStatus: "READY",
        expectedExternalVersion: created.externalVersion,
      },
    };
    const readyResult = await service.transitionRequest(created.externalEntityId, ready);
    const contentHash = `sha256:${"f".repeat(64)}` as const;
    const done: OperationalRequestTransitionEnvelope = {
      ...ready,
      effectIdempotencyKey: "effect:done:alpha",
      payload: {
        requestedNormalizedStatus: "DONE",
        expectedExternalVersion: readyResult.externalVersion,
        completionSummary: {
          schemaVersion: 1,
          verdict: "FAIL",
          summary: "QA complete with linked defect",
          contentHash,
        },
      },
    };
    await scenarios.setScenario({ scenario: "PARTIAL_EFFECT", appliesToNext: 1 });
    await expect(service.transitionRequest(created.externalEntityId, done)).rejects.toMatchObject({
      code: "TIMEOUT",
      retryable: true,
    });
    const recovered = await repository.effectByKey(scope, done.effectIdempotencyKey);
    expect(recovered?.result).toMatchObject({
      normalizedStatus: "DONE",
      completionSummaryReceipt: { contentHash },
    });
    await expect(service.transitionRequest(created.externalEntityId, done)).resolves.toEqual(
      recovered?.result,
    );
    expect((await repository.requestById(scope, created.externalEntityId))?.normalizedStatus).toBe(
      "DONE",
    );
  });
});
