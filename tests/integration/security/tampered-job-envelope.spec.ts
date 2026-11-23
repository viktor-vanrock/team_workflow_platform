import { describe, expect, it, vi } from "vitest";

import { InMemoryDurableCommandStore } from "../../../packages/platform-core/src/commanding/connector-command.ts";
import {
  CommandWorker,
  DeterministicClock,
  envelopeFromStore,
  InMemoryRecoverableQueue,
} from "../../../packages/platform-testkit/src/index.ts";

describe("adversarial durable job envelope validation", () => {
  it.each(["workspaceId", "projectId", "actor", "correlationId", "causationId"] as const)(
    "rejects tampered %s before claim, Broker or Connector invocation",
    async (field) => {
      const store = InMemoryDurableCommandStore.readyFixture();
      const queue = new InMemoryRecoverableQueue();
      const canonical = envelopeFromStore(store);
      queue.add(
        field === "actor"
          ? { ...canonical, actor: { principalId: "forged-principal" } }
          : { ...canonical, [field]: "forged-value" },
      );
      const broker = { invoke: vi.fn(async () => ({ receipt: "must-not-happen" })) };
      const worker = new CommandWorker(store, queue, broker, new DeterministicClock());

      await expect(worker.work()).rejects.toThrow("JOB_ENVELOPE_MISMATCH");
      expect(broker.invoke).not.toHaveBeenCalled();
      expect(store.command()).toMatchObject({
        status: "QUEUED",
        outboxStatus: "READY",
        attemptCount: 0,
      });
    },
  );

  it("rejects a job version newer than the authoritative PostgreSQL-style snapshot", async () => {
    const store = InMemoryDurableCommandStore.readyFixture();
    const queue = new InMemoryRecoverableQueue();
    const envelope = envelopeFromStore(store);
    queue.add({ ...envelope, rowVersion: envelope.rowVersion + 1 });
    const broker = { invoke: vi.fn(async () => undefined) };

    await expect(
      new CommandWorker(store, queue, broker, new DeterministicClock()).work(),
    ).rejects.toThrow("JOB_ENVELOPE_FUTURE_VERSION");
    expect(broker.invoke).not.toHaveBeenCalled();
  });
});
