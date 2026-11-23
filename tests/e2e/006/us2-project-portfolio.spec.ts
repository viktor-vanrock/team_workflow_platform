import { describe, expect, it, vi } from "vitest";

import { ProjectQueueQueryService } from "../../../packages/runtime-composition/src/queue/portfolio-query.ts";

const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const entry = (projectId: string, id: string, stage: "BACKLOG" | "READY" | "ACTIVE") => ({
  queueEntryId: `qe-${id}`,
  revision: 1,
  workspaceId: "w1",
  projectId,
  stage,
  semanticHash: hash("3"),
  inputFingerprint: hash("4"),
  control: { resourceVersion: 0, serviceClass: "STANDARD" },
  freshness: { state: "CURRENT", evaluatedAt: "2026-09-03T08:00:00.000Z" },
  subject: { kind: "WORK_ITEM" as const, id },
  ordering: {
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
      jiraDisplayKey: { state: "KNOWN", value: `${projectId}-${id}` },
      workItemId: id,
    },
    baseRankKey: hash("2"),
  },
});

describe("US2 Project and authorized-portfolio API journey", () => {
  it("interleaves A+B by the shared comparator while forbidden C and providers remain unread", async () => {
    const local = new Map([
      ["A", [entry("A", "a-ready", "READY"), entry("A", "a-backlog", "BACKLOG")]],
      ["B", [entry("B", "b-active", "ACTIVE"), entry("B", "b-ready", "READY")]],
      ["C", [entry("C", "c-secret", "BACKLOG")]],
    ]);
    const list = vi.fn(async ({ projectId }: { projectId: string }) => local.get(projectId) ?? []);
    const provider = { read: vi.fn() };
    const model = vi.fn();
    const service = new ProjectQueueQueryService({
      authorize: vi.fn(async ({ projectId }) => projectId !== "C"),
      authorizedProjects: vi.fn().mockResolvedValue(["B", "A"]),
      projection: { read: vi.fn(), list },
      provider,
      now: () => "2026-09-03T08:00:00.000Z",
    });

    const project = await service.lane({
      workspaceId: "w1",
      projectId: "A",
      principalId: "lead",
      pageSize: 10,
    });
    const first = await service.portfolio({ workspaceId: "w1", principalId: "lead", pageSize: 2 });
    const second = await service.portfolio({
      workspaceId: "w1",
      principalId: "lead",
      pageSize: 2,
      cursor: String(first.nextCursor),
    });
    const firstItems = first.items as unknown as readonly Readonly<{
      ordinal: number;
      entry: Readonly<{ subject: Readonly<{ id: string }> }>;
    }>[];
    const secondItems = second.items as unknown as readonly Readonly<{
      ordinal: number;
      entry: Readonly<{ subject: Readonly<{ id: string }> }>;
    }>[];

    expect(project).toMatchObject({
      scope: { kind: "PROJECT", projectId: "A" },
      visibleCounts: { total: 2 },
    });
    expect(firstItems.map(({ entry: value }) => value.subject.id)).toEqual([
      "a-backlog",
      "a-ready",
    ]);
    expect(secondItems.map(({ entry: value }) => value.subject.id)).toEqual([
      "b-ready",
      "b-active",
    ]);
    expect(secondItems.map(({ ordinal }) => ordinal)).toEqual([3, 4]);
    expect(list.mock.calls.flatMap(([value]) => [value.projectId])).not.toContain("C");
    expect(JSON.stringify([first, second])).not.toContain("c-secret");
    expect(provider.read).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
  });
});
