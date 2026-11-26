import { afterEach, describe, expect, it, vi } from "vitest";
import { TypeOrmCommandDeliveryStore } from "../../../packages/platform-persistence-typeorm/src/command-delivery.store.ts";
import { GitLabSuiteValidationWorker } from "../../../packages/runtime-composition/src/gitlab/suite-validation-worker.ts";

afterEach(() => vi.restoreAllMocks());

describe("corporate suite validation scope", () => {
  it("rejects an empty deployment scope", () => {
    expect(
      () =>
        new GitLabSuiteValidationWorker({} as never, {} as never, {
          workspaceId: "w",
          projectIds: [],
        }),
    ).toThrow("GITLAB_SUITE_VALIDATION_SCOPE_INVALID");
  });
  it("claims only the configured projects and suite validation operation", async () => {
    const claim = vi.spyOn(TypeOrmCommandDeliveryStore.prototype, "claim").mockResolvedValue([]);
    const worker = new GitLabSuiteValidationWorker({} as never, {} as never, {
      workspaceId: "w",
      projectIds: ["p"],
    });
    await expect(worker.runOne(new Date("2026-01-01T00:00:00Z"))).resolves.toBe("IDLE");
    expect(claim).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
      1,
      ["qa.automation-suite-validation"],
      { workspaceId: "w", projectIds: ["p"], operations: ["suite.validate"] },
    );
  });
});
