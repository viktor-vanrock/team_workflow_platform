import { vi } from "vitest";

import { BoundedQueueTelemetry } from "../../packages/runtime-composition/src/queue/observability.ts";
import { ProjectQueueQueryService } from "../../packages/runtime-composition/src/queue/portfolio-query.ts";

const hash = (digit: string): `sha256:${string}` => `sha256:${digit.repeat(64)}`;

function entry(projectId: string, ordinal: number) {
  const workItemId = `${projectId}-${String(ordinal).padStart(6, "0")}`;
  return Object.freeze({
    queueEntryId: `queue-${workItemId}`,
    revision: 1,
    workspaceId: "workspace-observability",
    projectId,
    stage: "READY",
    semanticHash: hash("3"),
    inputFingerprint: hash("4"),
    control: Object.freeze({ state: "DEFAULT", resourceVersion: 0, serviceClass: "STANDARD" }),
    freshness: Object.freeze({
      state: "CURRENT",
      sourceStates: [],
      evaluatedAt: "2026-09-03T08:00:00.000Z",
    }),
    subject: Object.freeze({ kind: "WORK_ITEM", id: workItemId }),
    ordering: Object.freeze({
      state: "COMPUTED",
      comparatorRef: Object.freeze({
        key: "queue-order",
        version: "1.0.0",
        semanticHash: hash("1"),
      }),
      components: Object.freeze({
        serviceClassBand: "STANDARD",
        slaState: "NOT_STARTED",
        urgencyTiming: Object.freeze({ state: "NOT_STARTED" }),
        jiraPriority: Object.freeze({ state: "UNKNOWN" }),
        acceptedRisk: "UNKNOWN",
        acceptedBusinessImpact: "UNKNOWN",
        dependencyReadiness: "UNKNOWN",
        readyAge: Object.freeze({ state: "UNKNOWN" }),
        readyAt: Object.freeze({ state: "UNKNOWN" }),
        jiraDisplayKey: Object.freeze({ state: "UNKNOWN" }),
        workItemId,
      }),
      baseRankKey: hash("2"),
    }),
  });
}

export function createQueueObservabilityLoadFixture(itemCount: number) {
  if (!Number.isSafeInteger(itemCount) || itemCount < 0)
    throw new Error("OBSERVABILITY_FIXTURE_ITEM_COUNT_INVALID");
  const projects = ["A", "B"] as const;
  const entries = Array.from({ length: itemCount }, (_, index) =>
    entry(projects[index % projects.length]!, index),
  );
  let queryCount = 0;
  const provider = { read: vi.fn() };
  const telemetry = new BoundedQueueTelemetry();
  const service = new ProjectQueueQueryService({
    authorize: vi.fn().mockResolvedValue(true),
    authorizedProjects: vi.fn(async () => {
      queryCount += 1;
      return projects;
    }),
    projection: {
      read: vi.fn(),
      list: vi.fn(async ({ projectId }: { projectId: string }) => {
        queryCount += 1;
        return entries.filter((candidate) => candidate.projectId === projectId);
      }),
    },
    provider,
    now: () => "2026-09-03T08:00:00.000Z",
    metrics: {
      observe: ({ visibleEntryCount }) =>
        telemetry.record({
          name: "queue_operation_total",
          labels: { subsystem: "QUEUE", operation: "READ", outcome: "SUCCESS" },
          value: visibleEntryCount,
          correlationRef: `queue-read-${itemCount}`,
          auditRef: `audit-read-${itemCount}`,
        }),
    },
  });
  return Object.freeze({
    telemetry,
    provider,
    async run() {
      const started = performance.now();
      const page = await service.portfolio({
        workspaceId: "workspace-observability",
        principalId: "lead",
        pageSize: 100,
      });
      return Object.freeze({
        page,
        itemCount,
        queryCount,
        providerReadCount: provider.read.mock.calls.length,
        durationMs: performance.now() - started,
        telemetry: telemetry.snapshot(),
      });
    },
  });
}
