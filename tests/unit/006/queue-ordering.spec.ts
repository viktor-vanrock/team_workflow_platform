import { describe, expect, it } from "vitest";

import {
  compareQueueOrderEntries,
  createCandidateInboxOrdering,
  createWorkItemOrdering,
  queueStagePartition,
  selectUrgencyTiming,
  sortQueueOrderEntries,
  type WorkItemOrderComponents,
} from "../../../packages/platform-core/src/work-management/queue-ordering.ts";

const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const ref = (sourceId: string) => ({
  sourceType: "SLA_CLOCK_REVISION" as const,
  sourceId,
  sourceVersion: 1,
  semanticHash: hash("a"),
});

const components = (overrides: Partial<WorkItemOrderComponents> = {}): WorkItemOrderComponents => ({
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
  workItemId: "w1",
  ...overrides,
});

const item = (
  id: string,
  stage: keyof typeof queueStagePartition,
  value: WorkItemOrderComponents,
) => ({
  queueEntryId: id,
  stage,
  subject: { kind: "WORK_ITEM" as const, id: value.workItemId },
  ordering: createWorkItemOrdering(value),
});

describe("queue-order@1.0.0", () => {
  it("uses the closed stage display partition before all within-stage components", () => {
    expect(Object.keys(queueStagePartition)).toEqual([
      "CANDIDATE",
      "BACKLOG",
      "READY",
      "ACTIVE",
      "COMPLETED",
    ]);
    const values = ["COMPLETED", "ACTIVE", "READY", "BACKLOG"] as const;
    expect(
      sortQueueOrderEntries(
        values.map((stage, index) =>
          item(`q${index}`, stage, components({ workItemId: `w${index}` })),
        ),
      ).map(({ stage }) => stage),
    ).toEqual(["BACKLOG", "READY", "ACTIVE", "COMPLETED"]);
  });

  it("orders Candidate Inbox only by enteredAt, subject kind and subject id", () => {
    const candidate = (id: string, enteredInboxAt: string, kind: "CANDIDATE" | "DRAFT") => ({
      queueEntryId: `q-${id}`,
      stage: "CANDIDATE" as const,
      subject: { kind, id },
      ordering: createCandidateInboxOrdering({ enteredInboxAt, subjectKind: kind, subjectId: id }),
    });
    const sorted = sortQueueOrderEntries([
      candidate("z", "2026-09-03T09:00:00.000Z", "CANDIDATE"),
      candidate("b", "2026-09-03T08:00:00.000Z", "DRAFT"),
      candidate("a", "2026-09-03T08:00:00.000Z", "CANDIDATE"),
    ]);
    expect(sorted.map(({ subject }) => subject.id)).toEqual(["a", "b", "z"]);
  });

  it.each([
    ["service class", { serviceClassBand: "EXPEDITE" }, { serviceClassBand: "STANDARD" }],
    ["SLA state", { slaState: "BREACHED" }, { slaState: "NOT_CONFIGURED" }],
    [
      "urgency instant",
      {
        urgencyTiming: {
          state: "KNOWN",
          basis: "SLA_TARGET_AT",
          instant: "2026-09-03T08:00:00.000Z",
          sourceRef: ref("early"),
        },
      },
      {
        urgencyTiming: {
          state: "KNOWN",
          basis: "SLA_TARGET_AT",
          instant: "2026-09-03T09:00:00.000Z",
          sourceRef: ref("late"),
        },
      },
    ],
    [
      "Jira priority",
      { jiraPriority: { state: "KNOWN", normalizedKey: "P0", mappingRef: ref("priority") } },
      { jiraPriority: { state: "UNKNOWN" } },
    ],
    ["risk", { acceptedRisk: "VERY_HIGH" }, { acceptedRisk: "UNKNOWN" }],
    ["business impact", { acceptedBusinessImpact: "HIGH" }, { acceptedBusinessImpact: "LOW" }],
    ["dependency", { dependencyReadiness: "READY" }, { dependencyReadiness: "UNKNOWN" }],
    [
      "aging band",
      { readyAge: { state: "KNOWN", businessSeconds: 99, agingBandKey: "00-OLD" } },
      { readyAge: { state: "UNKNOWN" } },
    ],
    [
      "readyAt",
      { readyAt: { state: "KNOWN", value: "2026-09-03T08:00:00.000Z" } },
      { readyAt: { state: "UNKNOWN" } },
    ],
    [
      "Jira key",
      { jiraDisplayKey: { state: "KNOWN", value: "A-2" } },
      { jiraDisplayKey: { state: "KNOWN", value: "a-1" } },
    ],
    ["Work Item id", { workItemId: "A" }, { workItemId: "a" }],
  ] as const)(
    "compares the %s component before later unknown/tie buckets",
    (_name, earlier, later) => {
      expect(
        compareQueueOrderEntries(
          item("left", "READY", components(earlier as Partial<WorkItemOrderComponents>)),
          item("right", "READY", components(later as Partial<WorkItemOrderComponents>)),
        ),
      ).toBeLessThan(0);
    },
  );

  it("chooses earliest urgency and the documented basis on equal instants", () => {
    const instant = "2026-09-03T08:00:00.000Z";
    expect(
      selectUrgencyTiming({
        latestSafeStart: { instant, sourceRef: ref("safe") },
        activeSlaTarget: { instant, sourceRef: ref("target") },
        confirmedJiraDueEnd: { instant: "2026-09-03T07:00:00.000Z", sourceRef: ref("due") },
      }),
    ).toMatchObject({ state: "KNOWN", basis: "CONFIRMED_JIRA_DUE_END" });
    expect(
      selectUrgencyTiming({
        latestSafeStart: { instant, sourceRef: ref("safe") },
        activeSlaTarget: { instant, sourceRef: ref("target") },
      }),
    ).toMatchObject({ state: "KNOWN", basis: "SLA_LATEST_SAFE_START" });
  });

  it("uses C collation and ignores explanatory seconds inside one aging band", () => {
    const left = item(
      "left",
      "READY",
      components({
        workItemId: "w2",
        jiraDisplayKey: { state: "KNOWN", value: "A-10" },
        readyAge: { state: "KNOWN", businessSeconds: 999, agingBandKey: "01" },
      }),
    );
    const right = item(
      "right",
      "READY",
      components({
        workItemId: "w1",
        jiraDisplayKey: { state: "KNOWN", value: "a-2" },
        readyAge: { state: "KNOWN", businessSeconds: 1, agingBandKey: "01" },
      }),
    );
    expect(compareQueueOrderEntries(left, right)).toBeLessThan(0);
  });
});
