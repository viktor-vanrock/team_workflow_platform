import { describe, expect, it, vi } from "vitest";
import * as runtime from "../../../packages/runtime-composition/src/index.ts";
import { startCorporateWorkerHost } from "../../../apps/worker/src/corporate-host.ts";

describe("corporate worker host", () => {
  it("rejects local, production or incomplete configuration before opening the database", async () => {
    const load = vi.spyOn(runtime, "loadEnvironment");
    const source = vi.spyOn(runtime, "createWorkspaceInstallationDataSource");
    for (const environment of [
      { profile: "local", environmentScope: "LOCAL" },
      { profile: "non-local", environmentScope: "PLATFORM_PROD", deployment: {} },
      { profile: "non-local", environmentScope: "NON_PROD" },
      { profile: "non-local", environmentScope: "NON_PROD", deployment: {} },
    ]) {
      load.mockReturnValue(environment as never);
      await expect(startCorporateWorkerHost({} as never)).rejects.toThrow(
        "CORPORATE_WORKER_HOST_CONFIGURATION_REQUIRED",
      );
    }
    expect(source).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it("retains the startup error even when database cleanup also fails", async () => {
    vi.spyOn(runtime, "loadEnvironment").mockReturnValue({
      profile: "non-local",
      environmentScope: "NON_PROD",
      deployment: { workspaceId: "workspace", projectIds: ["project"] },
    } as never);
    const destroy = vi.fn(async () => {
      throw new Error("cleanup failed");
    });
    vi.spyOn(runtime, "createWorkspaceInstallationDataSource").mockReturnValue({
      isInitialized: true,
      initialize: async () => {
        throw new Error("startup failed");
      },
      destroy,
    } as never);
    await expect(startCorporateWorkerHost()).rejects.toThrow("startup failed");
    expect(destroy).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});
