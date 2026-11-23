import { describe, expect, it, vi } from "vitest";

import {
  ProjectQueueQueryService,
  queuePageEtag,
} from "../../../packages/runtime-composition/src/queue/portfolio-query.ts";

const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const entry = (projectId: string) => ({
  queueEntryId: `q-${projectId}`,
  revision: 1,
  workspaceId: "w1",
  projectId,
  stage: "READY" as const,
  semanticHash: hash("3"),
  inputFingerprint: hash("4"),
  control: { resourceVersion: 0, serviceClass: "STANDARD" },
  freshness: { state: "CURRENT", evaluatedAt: "2026-09-03T08:00:00.000Z" },
  subject: { kind: "WORK_ITEM" as const, id: `wi-${projectId}` },
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
      jiraDisplayKey: { state: "UNKNOWN" },
      workItemId: `wi-${projectId}`,
    },
    baseRankKey: hash("2"),
  },
});

describe("US2 hidden-only public token stability", () => {
  it("keeps A+B generation, ETag, freshness, cursor and order CAS stable while C changes", async () => {
    let hiddenRevision = 1;
    const now = vi.fn(() => "2026-09-03T08:00:00.000Z");
    const list = vi.fn(async ({ projectId }: { projectId: string }) => {
      if (projectId === "C") throw new Error(`HIDDEN_PROJECT_READ:${hiddenRevision}`);
      return [entry(projectId)];
    });
    const service = new ProjectQueueQueryService({
      authorize: vi.fn().mockResolvedValue(true),
      authorizedProjects: vi.fn().mockResolvedValue(["A", "B"]),
      projection: {
        read: vi.fn(),
        list,
        portfolioOrderState: vi
          .fn()
          .mockResolvedValue({ resourceVersion: 4, queueEpoch: 2, baseVisibleSetHash: hash("5") }),
      },
      now,
    });
    const first = await service.portfolio({ workspaceId: "w1", principalId: "lead", pageSize: 1 });
    hiddenRevision += 1;
    const repeated = await service.portfolio({
      workspaceId: "w1",
      principalId: "lead",
      pageSize: 1,
    });
    const second = await service.portfolio({
      workspaceId: "w1",
      principalId: "lead",
      pageSize: 1,
      cursor: String(first.nextCursor),
    });
    expect(now).toHaveBeenCalledTimes(2);
    expect(repeated).toEqual(first);
    expect(queuePageEtag(repeated)).toBe(queuePageEtag(first));
    expect(second).toMatchObject({
      projectionGeneration: first.projectionGeneration,
      freshness: first.freshness,
      orderState: first.orderState,
      items: [{ ordinal: 2 }],
    });
    expect(list).not.toHaveBeenCalledWith(expect.objectContaining({ projectId: "C" }));
  });
});
