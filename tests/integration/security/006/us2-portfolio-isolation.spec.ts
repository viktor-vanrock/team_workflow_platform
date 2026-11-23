import { describe, expect, it, vi } from "vitest";

import { ProjectQueueQueryService } from "../../../../packages/runtime-composition/src/queue/portfolio-query.ts";

const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const ordering = (id: string) => ({
  state: "COMPUTED" as const,
  comparatorRef: { key: "queue-order", version: "1.0.0", semanticHash: hash("1") },
  components: {
    serviceClassBand: "STANDARD",
    slaState: "NOT_STARTED",
    urgencyTiming: { state: "NOT_STARTED" },
    jiraPriority: { state: "UNKNOWN" },
    acceptedRisk: "UNKNOWN",
    acceptedBusinessImpact: "UNKNOWN",
    dependencyReadiness: "UNKNOWN",
    readyAge: { state: "UNKNOWN" },
    readyAt: { state: "UNKNOWN" },
    jiraDisplayKey: { state: "UNKNOWN" },
    workItemId: id,
  },
  baseRankKey: hash("2"),
});
const entry = (projectId: string, id: string) => ({
  queueEntryId: `q-${id}`,
  revision: 1,
  workspaceId: "w1",
  projectId,
  stage: "READY" as const,
  semanticHash: hash("3"),
  inputFingerprint: hash("4"),
  control: { state: "DEFAULT", resourceVersion: 0, serviceClass: "STANDARD" },
  freshness: { state: "CURRENT", sourceStates: [], evaluatedAt: "2026-09-03T08:00:00.000Z" },
  subject: { kind: "WORK_ITEM" as const, id },
  ordering: ordering(id),
});

describe("US2 authorization-before-portfolio aggregation", () => {
  it("joins, counts, sorts, cursors, export batches and metrics only after exact HUMAN Project resolution", async () => {
    const calls: string[] = [];
    const list = vi.fn(async ({ projectId }: { projectId: string }) => {
      calls.push(`projection:${projectId}`);
      return [entry(projectId, `${projectId}-1`)];
    });
    const metrics = vi.fn((value: Readonly<Record<string, unknown>>) => {
      calls.push("metrics");
      expect(value).toMatchObject({
        visibleProjectCount: 2,
        visibleEntryCount: 2,
        exportBatchSize: 2,
      });
    });
    const provider = { read: vi.fn() };
    const service = new ProjectQueueQueryService({
      authorize: vi.fn().mockResolvedValue(true),
      authorizedProjects: async () => {
        calls.push("authorize");
        return ["A", "B"];
      },
      projection: { read: vi.fn(), list },
      provider,
      metrics: { observe: metrics },
    });
    const page = await service.portfolio({ workspaceId: "w1", principalId: "lead", pageSize: 50 });
    expect(calls).toEqual(["authorize", "projection:A", "projection:B", "metrics"]);
    expect(list).not.toHaveBeenCalledWith(expect.objectContaining({ projectId: "C" }));
    expect(page).toMatchObject({
      scope: { kind: "AUTHORIZED_PORTFOLIO" },
      visibleCounts: { total: 2 },
    });
    expect(provider.read).not.toHaveBeenCalled();
  });

  it("does not grant Workspace Owner implicit Project content access", async () => {
    const list = vi.fn();
    const service = new ProjectQueueQueryService({
      authorize: vi.fn().mockResolvedValue(true),
      authorizedProjects: vi.fn().mockResolvedValue([]),
      projection: { read: vi.fn(), list },
    });
    const page = await service.portfolio({
      workspaceId: "w1",
      principalId: "workspace-owner",
      pageSize: 50,
    });
    expect(page).toMatchObject({ visibleCounts: { total: 0 }, items: [] });
    expect(list).not.toHaveBeenCalled();
  });
});
