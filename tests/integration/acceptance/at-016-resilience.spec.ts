import { describe, expect, it } from "vitest";

import { InMemoryDurableCommandStore } from "../../../packages/platform-core/src/commanding/connector-command.ts";
import {
  DeterministicClock,
  InMemoryRecoverableQueue,
  OutboxDispatcher,
  RecoverySweeper,
} from "../../../packages/platform-testkit/src/index.ts";

describe("AT-016 PostgreSQL-authoritative delivery recovery", () => {
  it("reconstructs an ENQUEUED job after total process-memory loss", async () => {
    const store = InMemoryDurableCommandStore.readyFixture();
    const queue = new InMemoryRecoverableQueue();
    const clock = new DeterministicClock();
    await new OutboxDispatcher(store, queue, clock).dispatch();
    queue.clear();
    expect(queue.size).toBe(0);
    await new RecoverySweeper(store, queue, clock).sweep();
    expect(queue.size).toBe(1);
    expect(store.command().outboxStatus).toBe("ENQUEUED");
  });
});
