import { describe, expect, it, vi } from "vitest";
import { createCorporateGitLabRetryQuarantine } from "../../../packages/runtime-composition/src/gitlab/corporate-retry-quarantine.ts";

describe("corporate GitLab retry quarantine", () => {
  const environment = {
    profile: "non-local",
    environmentScope: "NON_PROD",
    deployment: { workspaceId: "w", projectIds: ["p"] },
  };
  const attempt = {
    workspaceId: "w",
    projectId: "p",
    suiteBindingRef: { id: "suite", version: 2 },
    suiteBindingHash: "hash",
  };
  it("checks the scoped suite and infrastructure code", async () => {
    const query = vi.fn(async () => [{ active: 1 }]);
    const authority = createCorporateGitLabRetryQuarantine(
      { isInitialized: true, query } as never,
      environment as never,
    );
    await expect(
      authority.active(attempt as never, "RUNNER_UNAVAILABLE", new AbortController().signal),
    ).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("q.workspace_id=$1 AND q.project_id=$2"),
      ["w", "p", "suite", 2, "hash", "RUNNER_UNAVAILABLE"],
    );
  });
  it("rejects a foreign project without querying", async () => {
    const query = vi.fn();
    const authority = createCorporateGitLabRetryQuarantine(
      { isInitialized: true, query } as never,
      environment as never,
    );
    await expect(
      authority.active(
        { ...attempt, projectId: "other" } as never,
        undefined,
        new AbortController().signal,
      ),
    ).rejects.toThrow("CORPORATE_GITLAB_RETRY_SCOPE_DENIED");
    expect(query).not.toHaveBeenCalled();
  });
});
