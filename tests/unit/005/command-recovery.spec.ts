import { describe, expect, it, vi } from "vitest";

import { InMemoryDurableCommandStore } from "../../../packages/platform-core/src/index.ts";
import {
  CapabilityCommandRouter,
  createCommandSchedulingHint,
  defineWorkerContribution,
  reconstructCommandFromHint,
} from "../../../packages/runtime-composition/src/worker/contributions.ts";

describe("Feature 005 command ownership and recovery foundation", () => {
  it("reconstructs delivery scheduling from PostgreSQL authority", async () => {
    const command = {
      ...InMemoryDurableCommandStore.readyFixture().command(),
      capability: {
        key: "test-executor.trigger-status",
        exactContractVersion: "1.0.0",
        operation: "pipeline.trigger",
        logicalRole: "AUTOMATED_TEST_EXECUTOR",
      },
    };
    const hint = createCommandSchedulingHint(command);

    expect(hint).toEqual({
      workspaceId: command.workspaceId,
      projectId: command.projectId,
      commandId: command.id,
      capabilityKey: "test-executor.trigger-status",
    });
    expect(JSON.stringify(hint)).not.toMatch(/payload|target|profile|secret|token|effect/iu);

    const loader = vi.fn(async () => command);
    await expect(reconstructCommandFromHint(hint, loader)).resolves.toEqual(command);
    expect(loader).toHaveBeenCalledWith({
      workspaceId: command.workspaceId,
      projectId: command.projectId,
      commandId: command.id,
    });
  });

  it("rejects stale or capability-conflicting hints before dispatch", async () => {
    const command = InMemoryDurableCommandStore.readyFixture().command();
    const hint = createCommandSchedulingHint(command);

    await expect(reconstructCommandFromHint(hint, async () => undefined)).rejects.toThrow(
      "WORKER_COMMAND_NOT_FOUND",
    );
    await expect(
      reconstructCommandFromHint(hint, async () => ({
        ...command,
        capability: { ...command.capability, key: "different.capability" },
      })),
    ).rejects.toThrow("WORKER_COMMAND_HINT_MISMATCH");
  });

  it("assigns one owner per capability and fails closed for unknown commands", async () => {
    const handle = vi.fn(async () => "handled");
    const router = new CapabilityCommandRouter([
      defineWorkerContribution({
        key: "gitlab-foundation",
        capabilityKeys: ["source-context.read", "test-executor.trigger-status", "artifact.ci-read"],
        recovery: { markedEffectPolicy: "LOOKUP_ONLY" },
        handle,
      }),
    ]);

    expect(router.capabilities()).toEqual([
      "artifact.ci-read",
      "source-context.read",
      "test-executor.trigger-status",
    ]);
    expect(() => router.ownerFor("unknown.capability")).toThrow(
      "WORKER_CAPABILITY_OWNER_NOT_FOUND:unknown.capability",
    );
    await expect(
      router.route(InMemoryDurableCommandStore.readyFixture().command()),
    ).rejects.toThrow("WORKER_CAPABILITY_OWNER_NOT_FOUND:sample.record");
    expect(handle).not.toHaveBeenCalled();
  });
});
