import { afterEach, describe, expect, it, vi } from "vitest";
import { TypeOrmJiraAuthoritativeReadOutboxRepository } from "../../../packages/connector-jira-persistence-typeorm/src/jira-authoritative-read-outbox.repository.ts";
import { createCorporateJiraAuthoritativeReadWorker } from "../../../packages/runtime-composition/src/jira/corporate-authoritative-read-worker.ts";
import { createCorporateJiraBoundRefreshScheduler } from "../../../packages/runtime-composition/src/jira/corporate-bound-refresh-scheduler.ts";

afterEach(() => vi.restoreAllMocks());
describe("corporate Jira authoritative reads", () => {
  const environment = {
    profile: "non-local",
    environmentScope: "NON_PROD",
    deployment: { workspaceId: "workspace", projectIds: ["project"] },
  };
  it("requires a real handler and fails closed outside non-production", () => {
    expect(() =>
      createCorporateJiraAuthoritativeReadWorker({
        source: { isInitialized: true },
        environment,
      } as never),
    ).toThrow("CORPORATE_JIRA_READ_AUTHORITY_REQUIRED");
    expect(() =>
      createCorporateJiraAuthoritativeReadWorker({
        source: { isInitialized: true },
        environment: { ...environment, environmentScope: "PLATFORM_PROD" },
        handler: { read: vi.fn() },
      } as never),
    ).toThrow("CORPORATE_JIRA_READ_AUTHORITY_REQUIRED");
  });
  it("claims only the deployment projects and releases failed reads", async () => {
    const claim = { id: "claim", workspaceId: "workspace", projectId: "project", attemptCount: 1 };
    const claimSpy = vi
      .spyOn(TypeOrmJiraAuthoritativeReadOutboxRepository.prototype, "claim")
      .mockResolvedValue(claim as never);
    const release = vi
      .spyOn(TypeOrmJiraAuthoritativeReadOutboxRepository.prototype, "release")
      .mockResolvedValue(true);
    const complete = vi.spyOn(TypeOrmJiraAuthoritativeReadOutboxRepository.prototype, "complete");
    const worker = createCorporateJiraAuthoritativeReadWorker({
      source: { isInitialized: true },
      environment,
      handler: {
        read: async () => {
          throw new Error("read failed");
        },
      },
    } as never);
    expect(await worker.run()).toBe(0);
    expect(claimSpy.mock.calls[0]?.[3]).toEqual({
      workspaceId: "workspace",
      projectIds: ["project"],
    });
    expect(release).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
  });
  it("does not schedule when project Jira pins are missing", () => {
    expect(() =>
      createCorporateJiraBoundRefreshScheduler({
        source: { isInitialized: true },
        environment,
        grants: [],
      } as never),
    ).toThrow("CORPORATE_JIRA_REFRESH_PINS_REQUIRED");
  });
  it("selects refreshes only for the deployed project and its published Jira connection", async () => {
    const query = vi.fn(async (_sql: string, _parameters: readonly unknown[]) => []);
    const scheduler = createCorporateJiraBoundRefreshScheduler({
      source: {
        isInitialized: true,
        transaction: async (_isolation: string, work: (manager: unknown) => Promise<unknown>) =>
          await work({ query }),
      },
      environment,
      grants: [
        {
          binding: {
            provider: "JIRA",
            workspaceId: "workspace",
            projectId: "project",
            connectionRef: { id: "connection", version: 2, contentHash: "hash" },
          },
        },
        {
          binding: {
            provider: "JIRA",
            workspaceId: "workspace",
            projectId: "other-project",
            connectionRef: { id: "other-connection", version: 1, contentHash: "other-hash" },
          },
        },
      ],
    } as never);
    expect(await scheduler.run(new Date("2026-01-01T00:00:00.000Z"))).toBe(0);
    expect(query.mock.calls[0]?.[0]).toContain('c.content_hash=allowed."connectionHash"');
    expect(query.mock.calls[0]?.[0]).toContain("NOT (b.connection_ref ? 'contentHash')");
    expect(query.mock.calls[0]?.[0]).toContain(
      "allowed.\"connectionHash\"=b.connection_ref->>'contentHash'",
    );
    expect(JSON.parse(String(query.mock.calls[0]?.[1][1]))).toEqual([
      {
        workspaceId: "workspace",
        projectId: "project",
        connectionId: "connection",
        connectionVersion: 2,
        connectionHash: "hash",
      },
    ]);
  });
});
