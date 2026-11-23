import { describe, expect, it } from "vitest";

import {
  MockHubService,
  MockScenarioError,
} from "../../../apps/mock-hub/src/mock-hub.controller.ts";
import { InMemoryMockStateRepository } from "../../../apps/mock-hub/src/persistence/mock-state.repository.ts";

const request = {
  effectIdempotencyKey: "effect-key-0001",
  correlationId: "00000000-0000-4000-8000-000000000001",
  target: { id: "record-1" },
  payload: { message: "hello" },
  expectedExternalState: { mode: "MUST_NOT_EXIST" as const },
};

describe("AT-012 stateful Mock Hub", () => {
  it("resets, seeds and keeps one effect for idempotent replays", async () => {
    const repository = new InMemoryMockStateRepository();
    const hub = new MockHubService(repository);
    await hub.seed(42);
    const first = await hub.publish(request);
    const replay = await hub.publish(request);
    expect(replay).toEqual(first);
    expect((await repository.effects())[0]).toMatchObject({
      effectIdempotencyKey: request.effectIdempotencyKey,
      effectCount: 1,
    });
    expect((await repository.calls()).length).toBe(2);
    await hub.reset();
    expect(await repository.effects()).toEqual([]);
  });

  it.each([
    ["TIMEOUT", "TIMEOUT"],
    ["AUTHENTICATION_FAILED", "CONNECTOR_UNAUTHORIZED"],
    ["AUTHORIZATION_DENIED", "CONNECTOR_FORBIDDEN"],
    ["RATE_LIMITED", "RATE_LIMITED"],
    ["SERVER_ERROR", "SERVER_ERROR"],
    ["SCHEMA_DRIFT", "SCHEMA_DRIFT"],
  ] as const)("injects %s", async (scenario, code) => {
    const hub = new MockHubService(new InMemoryMockStateRepository());
    await hub.setScenario({ scenario, appliesToNext: 1 });
    await expect(hub.publish(request)).rejects.toEqual(
      expect.objectContaining<Partial<MockScenarioError>>({ code }),
    );
  });

  it.each(["DUPLICATE_EVENT", "OUT_OF_ORDER_EVENT"] as const)(
    "records the %s event scenario",
    async (scenario) => {
      const repository = new InMemoryMockStateRepository();
      const hub = new MockHubService(repository);
      await hub.setScenario({ scenario, appliesToNext: 1 });
      await hub.publish(request);
      expect((await repository.events()).length).toBeGreaterThan(0);
    },
  );
});
