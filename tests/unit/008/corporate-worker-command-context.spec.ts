import { afterEach, describe, expect, it, vi } from "vitest";

import { InMemoryDurableCommandStore } from "../../../packages/platform-core/src/commanding/connector-command.ts";
import { TypeOrmCommandRepository } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { CorporateWorkerCommandContext } from "../../../packages/runtime-composition/src/pilot/worker-command-context.ts";

afterEach(() => vi.restoreAllMocks());

describe("corporate worker command context", () => {
  it("reloads the command and isolates concurrent provider operations", async () => {
    const first = InMemoryDurableCommandStore.readyFixture().command();
    const second = { ...first, id: "other", projectId: "other-project" };
    vi.spyOn(TypeOrmCommandRepository.prototype, "get").mockImplementation(
      async (_workspace, project, id) =>
        id === first.id && project === first.projectId
          ? first
          : id === second.id && project === second.projectId
            ? second
            : undefined,
    );
    const guard = { assertCommandAllowed: vi.fn(async () => undefined) };
    const context = new CorporateWorkerCommandContext(
      { isInitialized: true } as never,
      guard as never,
    );
    const firstBinding = { workspaceId: first.workspaceId, projectId: first.projectId };
    const secondBinding = { workspaceId: second.workspaceId, projectId: second.projectId };
    expect(await context.load(firstBinding as never)).toBeUndefined();
    await Promise.all([
      context.run(first, async () => {
        expect((await context.load(firstBinding as never))?.id).toBe(first.id);
        expect(await context.load(secondBinding as never)).toBeUndefined();
      }),
      context.run(second, async () => {
        expect((await context.load(secondBinding as never))?.id).toBe(second.id);
        expect(await context.load(firstBinding as never)).toBeUndefined();
      }),
    ]);
    expect(guard.assertCommandAllowed).toHaveBeenCalledTimes(2);
    expect(await context.load(firstBinding as never)).toBeUndefined();
  });

  it("rejects missing, changed or unauthorized commands before provider work", async () => {
    const command = InMemoryDurableCommandStore.readyFixture().command();
    const get = vi.spyOn(TypeOrmCommandRepository.prototype, "get").mockResolvedValue(undefined);
    const guard = {
      assertCommandAllowed: vi.fn(async () => {
        throw new Error("PILOT_ACCESS_REVOKED");
      }),
    };
    const context = new CorporateWorkerCommandContext(
      { isInitialized: true } as never,
      guard as never,
    );
    const work = vi.fn(async () => undefined);
    await expect(context.run(command, work)).rejects.toThrow(
      "CORPORATE_WORKER_COMMAND_CONTEXT_INVALID",
    );
    get.mockResolvedValue({ ...command, payloadHash: "changed" });
    await expect(context.run(command, work)).rejects.toThrow(
      "CORPORATE_WORKER_COMMAND_CONTEXT_INVALID",
    );
    get.mockResolvedValue(command);
    await expect(context.run(command, work)).rejects.toThrow("PILOT_ACCESS_REVOKED");
    expect(work).not.toHaveBeenCalled();
  });
});
