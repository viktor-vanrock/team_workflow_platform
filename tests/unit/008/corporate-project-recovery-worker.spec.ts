import { describe, expect, it, vi } from "vitest";
import { createCorporateProjectRecoveryWorker } from "../../../packages/runtime-composition/src/onboarding/corporate-recovery-worker.ts";

describe("corporate project recovery", () => {
  it("limits all reads and updates to the deployment scope", async () => {
    const query = vi.fn(async (sql: string, _params: readonly unknown[]) => {
      if (sql.includes("count(*)")) return [{ count: 0 }];
      return [];
    });
    const source = { isInitialized: true, query };
    const worker = createCorporateProjectRecoveryWorker(source as never, {
      workspaceId: "workspace",
      projectIds: ["project"],
    });
    expect(await worker.run()).toEqual({
      recoveredActions: 0,
      expiredProbes: 0,
      repaired: 0,
      reauthorizedWork: 0,
    });
    expect(query).toHaveBeenCalledTimes(4);
    for (const [sql, params] of query.mock.calls) {
      expect(sql).toContain("workspace_id=$1");
      expect(sql).toContain("project_id=ANY($2::uuid[])");
      expect(params).toEqual(["workspace", ["project"]]);
    }
  });
  it("rejects incomplete scope before touching the database", () => {
    expect(() =>
      createCorporateProjectRecoveryWorker({ isInitialized: true } as never, {
        workspaceId: "workspace",
        projectIds: [],
      }),
    ).toThrow("CORPORATE_PROJECT_RECOVERY_SCOPE_REQUIRED");
  });
});
