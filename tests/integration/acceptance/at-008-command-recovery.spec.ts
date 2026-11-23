import { describe, expect, it } from "vitest";

import { InMemoryDurableCommandStore } from "../../../packages/platform-core/src/commanding/connector-command.ts";
import {
  CommandWorker,
  DeterministicClock,
  InMemoryRecoverableQueue,
  OutboxDispatcher,
  RecoverySweeper,
} from "../../../packages/platform-testkit/src/index.ts";

describe("AT-008 durable command recovery", () => {
  it("recovers lost process delivery and crash-after-effect with one stable effect", async () => {
    const clock = new DeterministicClock();
    const store = InMemoryDurableCommandStore.readyFixture();
    const queue = new InMemoryRecoverableQueue();
    const dispatcher = new OutboxDispatcher(store, queue, clock);
    const effects = new Map<string, unknown>();
    await dispatcher.dispatch();
    expect(store.command().outboxStatus).toBe("ENQUEUED");
    queue.clear();
    await new RecoverySweeper(store, queue, clock).sweep();
    expect(queue.size).toBe(1);
    const worker = new CommandWorker(
      store,
      queue,
      {
        invoke: async (key) => {
          const result = effects.get(key) ?? { receipt: "ok" };
          effects.set(key, result);
          return result;
        },
      },
      clock,
    );
    await expect(worker.work({ crashAfterEffect: true })).rejects.toThrow("CRASH_AFTER_EFFECT");
    clock.advance(120_000);
    await new RecoverySweeper(store, queue, clock).sweep();
    await worker.work();
    expect(store.command()).toMatchObject({
      status: "CONFIRMED",
      outboxStatus: "ACKNOWLEDGED",
      bindingRef: { version: 1 },
      profileRef: { version: 1 },
    });
    expect(effects.size).toBe(1);
  });
});
