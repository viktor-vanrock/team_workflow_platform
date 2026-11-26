import { describe, expect, it, vi } from "vitest";

import { createCorporateGitLabTerminalCandidateScanner } from "../../../packages/runtime-composition/src/gitlab/corporate-terminal-candidates.ts";

describe("corporate GitLab terminal candidates", () => {
  const environment = {
    profile: "non-local",
    environmentScope: "NON_PROD",
    deployment: { workspaceId: "workspace", projectIds: ["project"] },
  };
  it("rejects local or production configuration", () => {
    for (const scope of ["LOCAL", "PROD"])
      expect(() =>
        createCorporateGitLabTerminalCandidateScanner(
          { isInitialized: true } as never,
          { ...environment, environmentScope: scope } as never,
        ),
      ).toThrow("CORPORATE_GITLAB_RESULT_SCOPE_REQUIRED");
  });
  it("selects current matching terminal observations within the deployment", async () => {
    const query = vi.fn<(sql: string, params: readonly unknown[]) => Promise<unknown[]>>(
      async () => [
        {
          workspace_id: "workspace",
          project_id: "project",
          attempt_id: "attempt",
          connector_command_id: "command",
          pipeline_observation_id: "observation",
          observation_hash: "hash",
        },
      ],
    );
    const scanner = createCorporateGitLabTerminalCandidateScanner(
      { isInitialized: true, query } as never,
      environment as never,
    );
    expect(await scanner.scan()).toEqual([
      {
        workspaceId: "workspace",
        projectId: "project",
        attemptId: "attempt",
        commandId: "command",
        observationId: "observation",
        observationHash: "hash",
      },
    ]);
    expect(query.mock.calls[0]?.[1]).toEqual(["workspace", ["project"], 50, null]);
    expect(query.mock.calls[0]?.[0]).toContain("o.marker_hash=e.marker_hash");
    await expect(scanner.scan(0)).rejects.toThrow("CORPORATE_GITLAB_RESULT_LIMIT_INVALID");
  });
  it("finds committed results without retry decisions only within the deployment", async () => {
    const query = vi.fn<(sql: string, params: readonly unknown[]) => Promise<unknown[]>>(
      async () => [
        {
          workspace_id: "workspace",
          project_id: "project",
          attempt_id: "attempt",
          terminal_result_id: "result",
        },
      ],
    );
    const scanner = createCorporateGitLabTerminalCandidateScanner(
      { isInitialized: true, query } as never,
      environment as never,
    );
    expect(await scanner.scanRetryRecovery()).toEqual([
      { workspaceId: "workspace", projectId: "project", attemptId: "attempt", resultId: "result" },
    ]);
    expect(query.mock.calls[0]?.[0]).toContain("NOT EXISTS");
    expect(query.mock.calls[0]?.[1]).toEqual(["workspace", ["project"], 50, null]);
  });
  it("moves past deferred attempts and wraps to retry them", async () => {
    const row = (id: string) => ({
      workspace_id: "workspace",
      project_id: "project",
      attempt_id: id,
      connector_command_id: "command",
      pipeline_observation_id: "observation",
      observation_hash: "hash",
    });
    const query = vi
      .fn<(sql: string, params: readonly unknown[]) => Promise<unknown[]>>(async () => [
        row("unused"),
      ])
      .mockResolvedValueOnce([row("a")])
      .mockResolvedValueOnce([row("b")])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row("a")]);
    const scanner = createCorporateGitLabTerminalCandidateScanner(
      { isInitialized: true, query } as never,
      environment as never,
    );
    expect((await scanner.scan(1))[0]?.attemptId).toBe("a");
    expect((await scanner.scan(1))[0]?.attemptId).toBe("b");
    expect((await scanner.scan(1))[0]?.attemptId).toBe("a");
    expect(query.mock.calls.map((call) => call[1][3])).toEqual([null, "a", "b", null]);
  });
});
