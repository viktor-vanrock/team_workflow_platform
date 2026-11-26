import { describe, expect, it, vi } from "vitest";

import { TypeOrmFeature005AutomationEventOutboxWorker } from "../../../packages/runtime-composition/src/gitlab/result-sync.ts";

describe("corporate GitLab event worker scope", () => {
  it("filters by workspace and projects before claiming an event", async () => {
    const query = vi.fn<(sql: string, params: readonly unknown[]) => Promise<unknown[]>>(
      async () => [],
    );
    const source = {
      transaction: async (_isolation: string, work: (manager: unknown) => Promise<unknown>) =>
        await work({ query }),
    };
    const publish = vi.fn();
    const worker = new TypeOrmFeature005AutomationEventOutboxWorker(
      source as never,
      { publish },
      { workspaceId: "workspace", projectIds: ["project"] },
    );
    expect(await worker.runOne()).toBe("IDLE");
    expect(query.mock.calls[0]?.[0]).toContain("project_id=ANY($3::uuid[])");
    expect(query.mock.calls[0]?.[1].slice(1)).toEqual(["workspace", ["project"]]);
    expect(publish).not.toHaveBeenCalled();
  });
  it("rejects missing publishers and empty scopes", () => {
    expect(
      () => new TypeOrmFeature005AutomationEventOutboxWorker({} as never, undefined as never),
    ).toThrow("FEATURE_005_EVENT_PUBLISHER_REQUIRED");
    expect(
      () =>
        new TypeOrmFeature005AutomationEventOutboxWorker(
          {} as never,
          { publish: vi.fn() },
          { workspaceId: "workspace", projectIds: [] },
        ),
    ).toThrow("FEATURE_005_EVENT_SCOPE_INVALID");
  });
});
