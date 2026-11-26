import { describe, expect, it, vi } from "vitest";

import { ArtifactRetentionRepository } from "../../../packages/platform-persistence-typeorm/src/artifact-retention.repository.ts";
import { createArtifactRetentionMaintenanceWorker } from "../../../packages/runtime-composition/src/pilot/maintenance-workers.ts";

describe("corporate artifact retention scope", () => {
  it("filters the deployment projects in SQL before limiting candidates", async () => {
    const query = vi.fn<(sql: string, params: readonly unknown[]) => Promise<unknown[]>>(
      async () => [],
    );
    const source = { query };
    const worker = createArtifactRetentionMaintenanceWorker(
      source as never,
      () => "2026-01-01T00:00:00.000Z",
      { workspaceId: "workspace", projectIds: ["project"] },
    );
    expect(await worker.run()).toEqual({ inspected: 0, expired: 0 });
    expect(query.mock.calls[0]?.[0]).toContain("a.project_id=ANY($4::uuid[])");
    expect(query.mock.calls[0]?.[1]).toEqual([
      "2026-01-01T00:00:00.000Z",
      100,
      "workspace",
      ["project"],
    ]);
  });
  it("fails closed on an empty project scope", async () => {
    const query = vi.fn();
    const repository = new ArtifactRetentionRepository({ query } as never);
    await expect(
      repository.dueExpirations("2026-01-01T00:00:00.000Z", 100, {
        workspaceId: "workspace",
        projectIds: [],
      }),
    ).rejects.toThrow("RETENTION_SCOPE_INVALID");
    expect(query).not.toHaveBeenCalled();
  });
});
