import { describe, expect, it } from "vitest";

import { MockHubService, MockScenarioError } from "../../apps/mock-hub/src/mock-hub.controller.ts";
import {
  InMemoryMockStateRepository,
  type MockScenario,
} from "../../apps/mock-hub/src/persistence/mock-state.repository.ts";
import { designContractRegistry } from "../../packages/platform-contracts/src/index.ts";
import {
  evaluateEffectGate,
  ExtensionRegistry,
  InMemoryDurableCommandStore,
  InMemoryEventInbox,
  InMemoryRegistrationRepository,
  processEvent,
  reconcileExtensions,
} from "../../packages/platform-core/src/index.ts";
import {
  CommandWorker,
  DeterministicClock,
  DeterministicIdGenerator,
  InMemoryRecoverableQueue,
  OutboxDispatcher,
  RecoverySweeper,
} from "../../packages/platform-testkit/src/index.ts";

const scenarioCodes = [
  ["AUTHENTICATION_FAILED", "CONNECTOR_UNAUTHORIZED"],
  ["AUTHORIZATION_DENIED", "CONNECTOR_FORBIDDEN"],
  ["RATE_LIMITED", "RATE_LIMITED"],
  ["SERVER_ERROR", "SERVER_ERROR"],
  ["TIMEOUT", "TIMEOUT"],
  ["SCHEMA_DRIFT", "SCHEMA_DRIFT"],
] as const satisfies readonly (readonly [MockScenario, string])[];

describe("Feature 001 resilience matrix", () => {
  it("isolates an invalid manifest and preserves independent Core readiness", async () => {
    const repository = new InMemoryRegistrationRepository();
    const readiness = await reconcileExtensions({
      candidates: [
        {
          sourceComponentRef: "invalid.optional",
          manifestSchemaId: "urn:awp:contracts:extensions:competency-pack-manifest:v1",
          manifest: { kind: "CompetencyPack", metadata: { key: "broken", version: "not-semver" } },
          required: false,
        },
      ],
      schemas: designContractRegistry,
      registry: new ExtensionRegistry(
        repository,
        new DeterministicClock(),
        new DeterministicIdGenerator(),
      ),
      bootInstanceId: "boot-resilience",
    });
    expect(readiness.status).toBe("DEGRADED");
    expect(await repository.list()).toEqual([]);
    expect(await repository.attempts()).toEqual([expect.objectContaining({ outcome: "REJECTED" })]);
  });

  it.each(scenarioCodes)(
    "classifies %s as %s without creating an effect",
    async (scenario, code) => {
      const repository = new InMemoryMockStateRepository();
      const service = new MockHubService(repository);
      await service.setScenario({ scenario, appliesToNext: 1 });
      await expect(
        service.publish({
          effectIdempotencyKey: `effect-${scenario}`,
          correlationId: "correlation",
          target: { id: "record" },
          payload: { message: "hello" },
          expectedExternalState: { mode: "MUST_NOT_EXIST" },
        }),
      ).rejects.toMatchObject({ code } satisfies Partial<MockScenarioError>);
      expect(await repository.effects()).toEqual([]);
      expect(await repository.calls()).toHaveLength(1);
    },
  );

  it("deduplicates duplicate/out-of-order events and sends gaps to reconciliation", async () => {
    const inbox = new InMemoryEventInbox();
    expect(
      (
        await processEvent(inbox, "projection", {
          eventId: "event-1",
          entityId: "record",
          entityVersion: 1,
        })
      ).status,
    ).toBe("PROCESSED");
    expect(
      (
        await processEvent(inbox, "projection", {
          eventId: "event-1",
          entityId: "record",
          entityVersion: 1,
        })
      ).status,
    ).toBe("DUPLICATE");
    expect(
      (
        await processEvent(inbox, "projection", {
          eventId: "event-0",
          entityId: "record",
          entityVersion: 1,
        })
      ).status,
    ).toBe("STALE");
    expect(
      (
        await processEvent(inbox, "projection", {
          eventId: "event-3",
          entityId: "record",
          entityVersion: 3,
        })
      ).status,
    ).toBe("GAP_REQUIRES_RECONCILIATION");
    expect(inbox.reconciliation).toHaveLength(1);
  });

  it("recovers delivery-memory loss, worker restart, stale lease and crash window with one effect", async () => {
    const clock = new DeterministicClock();
    const store = InMemoryDurableCommandStore.readyFixture();
    const queue = new InMemoryRecoverableQueue();
    const effects = new Map<string, unknown>();
    await new OutboxDispatcher(store, queue, clock).dispatch();
    queue.clear();
    expect(await new RecoverySweeper(store, queue, clock).sweep()).toBe(true);
    const firstWorker = new CommandWorker(
      store,
      queue,
      {
        invoke: async (key) => {
          const result = effects.get(key) ?? { receipt: "stable" };
          effects.set(key, result);
          return result;
        },
      },
      clock,
    );
    await expect(firstWorker.work({ crashAfterEffect: true })).rejects.toThrow(
      "CRASH_AFTER_EFFECT",
    );
    clock.advance(120_000);
    expect(await new RecoverySweeper(store, queue, clock).sweep()).toBe(true);
    const restartedWorker = new CommandWorker(
      store,
      queue,
      { invoke: async (key) => effects.get(key) },
      clock,
    );
    await restartedWorker.work();
    expect(store.command()).toMatchObject({
      status: "CONFIRMED",
      attemptCount: 2,
      outboxStatus: "ACKNOWLEDGED",
    });
    expect(effects).toHaveProperty("size", 1);
  });

  it("blocks revoked authorization before Connector invocation", async () => {
    let calls = 0;
    const result = await evaluateEffectGate({
      approvalMode: "REQUIRED",
      pinnedConfigurationHash: "sha256:same",
      liveConfigurationHash: "sha256:same",
      policyAllowed: false,
      authorizationBasis: { policyVersion: 2, entitlement: "REVOKED" },
      invoke: async () => {
        calls += 1;
      },
    });
    expect(result).toEqual({
      status: "FAILED",
      reasonCode: "POLICY_DENIED",
      authorizationBasis: { policyVersion: 2, entitlement: "REVOKED" },
    });
    expect(calls).toBe(0);
  });
});
