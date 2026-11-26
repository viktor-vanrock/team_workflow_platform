import { describe, expect, it, vi } from "vitest";

import { TypeOrmGitLabReconciliationRepository } from "../../../packages/connector-gitlab-persistence-typeorm/src/repositories/gitlab-reconciliation.repository.ts";
import {
  createCorporateGitLabAuthoritativeReadHandler,
  TypeOrmGitLabAuthoritativeReadOutboxWorker,
  TypeOrmGitLabReconciliationPollScheduler,
} from "../../../packages/runtime-composition/src/gitlab/reconciliation-worker.ts";

describe("corporate GitLab reconciliation scope", () => {
  const scope = { workspaceId: "workspace", projectIds: ["project"] };
  it("selects authoritative reads only from the configured projects", async () => {
    const query = vi.fn<(sql: string, params: readonly unknown[]) => Promise<unknown[]>>(
      async () => [],
    );
    const source = {
      transaction: async (_level: string, work: (manager: unknown) => Promise<unknown>) =>
        await work({ query }),
    };
    const read = vi.fn();
    const worker = new TypeOrmGitLabAuthoritativeReadOutboxWorker(
      source as never,
      { read },
      undefined,
      undefined,
      scope,
    );
    expect(await worker.runOne()).toBe("IDLE");
    expect(query.mock.calls[0]?.[0]).toContain("project_id=ANY($2::uuid[])");
    expect(query.mock.calls[0]?.[1]).toEqual(["workspace", ["project"]]);
    expect(read).not.toHaveBeenCalled();
  });
  it("restricts cursors through matching commands before the limit", async () => {
    const query = vi.fn<(sql: string, params: readonly unknown[]) => Promise<unknown[]>>(
      async () => [],
    );
    const repository = new TypeOrmGitLabReconciliationRepository({ query } as never);
    const now = new Date("2026-01-01T00:00:00.000Z");
    await repository.cursorsDue("ACTIVE_PIPELINES", now, 1, scope);
    expect(query.mock.calls[0]?.[0]).toContain("command.project_id=ANY($5::uuid[])");
    expect(query.mock.calls[0]?.[1]).toEqual([
      "ACTIVE_PIPELINES",
      now,
      1,
      "workspace",
      ["project"],
    ]);
  });
  it("rejects an empty scope", () => {
    expect(
      () =>
        new TypeOrmGitLabReconciliationPollScheduler({} as never, undefined, undefined, {
          workspaceId: "workspace",
          projectIds: [],
        }),
    ).toThrow("GITLAB_RECONCILIATION_SCOPE_INVALID");
  });

  it("does not build a corporate read handler in local or production environments", () => {
    for (const environment of [
      { profile: "local", environmentScope: "LOCAL" },
      { profile: "non-local", environmentScope: "PLATFORM_PROD", deployment: {} },
      { profile: "non-local", environmentScope: "NON_PROD" },
    ]) {
      expect(() =>
        createCorporateGitLabAuthoritativeReadHandler({
          source: { isInitialized: true },
          environment,
        } as never),
      ).toThrow("GITLAB_RECONCILIATION_CORPORATE_AUTHORITY_REQUIRED");
    }
  });
  it("rejects another project's read before accessing the database or provider", async () => {
    const query = vi.fn();
    const factories = { gitlab: vi.fn() };
    const handler = createCorporateGitLabAuthoritativeReadHandler({
      source: { isInitialized: true, query },
      environment: {
        profile: "non-local",
        environmentScope: "NON_PROD",
        deployment: { workspaceId: "workspace", projectIds: ["project"] },
      },
      factories,
      grants: [],
    } as never);
    await expect(
      handler.read({ workspaceId: "workspace", projectId: "other" } as never),
    ).rejects.toThrow("GITLAB_RECONCILIATION_PROJECT_SCOPE_MISMATCH");
    expect(query).not.toHaveBeenCalled();
    expect(factories.gitlab).not.toHaveBeenCalled();
  });
});
