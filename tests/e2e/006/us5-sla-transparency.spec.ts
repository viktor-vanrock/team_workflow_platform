import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  type QaQueueEntryView,
  QaQueueItem,
  type QaSlaView,
} from "../../../packages/competency-qa/src/ui/queue-item.tsx";
import {
  advanceSlaClock,
  applySlaClockTransitionToSegments,
  createInitialSlaClock,
  projectQueuePolicyFacet,
} from "../../../packages/platform-core/src/index.ts";
import {
  PostgresQueueTemporalTransitionWorker,
  ProjectSlaQueryService,
} from "../../../packages/runtime-composition/src/index.ts";
import { runQueueScenario } from "../../../tools/local/queue-scenario.mts";
import {
  businessCalendarFixture,
  policyIds,
  queuePolicyFixture,
} from "../../helpers/006/policy-fixture.ts";
import { digest } from "../../helpers/006/triage-fixture.ts";

const render = renderToStaticMarkup as (node: ReturnType<typeof QaQueueItem>) => string;

const id = (suffix: string): string => `71000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

const entry: QaQueueEntryView = Object.freeze({
  queueEntryId: "entry-us5",
  revision: 7,
  semanticHash: digest("entry-us5"),
  inputFingerprint: digest("entry-us5-input"),
  stage: "READY",
  stageDetails: Object.freeze(["confirmed Jira ready"]),
  stageReasonCodes: Object.freeze(["CONFIRMED_READY"]),
  subject: Object.freeze({ kind: "WORK_ITEM", id: id("1") }),
  operational: Object.freeze({
    state: "CONFIRMED",
    rawStatus: Object.freeze({ name: "Ready for QA" }),
    normalizedStatus: "READY",
    externalDisplayKey: "QA-501",
  }),
  control: Object.freeze({ state: "ACCEPTED", resourceVersion: 4, serviceClass: "STANDARD" }),
  freshness: Object.freeze({ state: "CURRENT", evaluatedAt: "2026-09-07T12:00:00.000Z" }),
  consistencyWarnings: Object.freeze([]),
});

function clockFixture() {
  const calendar = businessCalendarFixture();
  const policy = projectQueuePolicyFacet(
    queuePolicyFixture("ENFORCED", calendar),
    policyIds.projectA,
    { id: id("2"), version: 1 },
  );
  const transition = createInitialSlaClock({
    workspaceId: policyIds.workspace,
    projectId: policyIds.projectA,
    workItemId: entry.subject.id,
    slaClockId: id("3"),
    goal: "READY_TO_FIRST_QA_START",
    policyFacetRef: policy.policyFacetRef,
    calendarRef: policy.calendarRef,
    mappingRef: {
      ...policy.statusMappingRef,
      sourceVersion: Number(policy.statusMappingRef.sourceVersion),
    },
    algorithmRef: Object.freeze({
      key: "sla-business-time",
      version: "1.0.0",
      semanticHash: digest("sla-business-time@1"),
    }),
    startSourceRef: Object.freeze({
      sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
      sourceId: id("4"),
      sourceVersion: 5,
      semanticHash: digest("jira-ready:5"),
      observedAt: "2026-09-07T04:58:00.000Z",
      confirmedAt: "2026-09-07T05:00:00.000Z",
    }),
  });
  const openSegment = applySlaClockTransitionToSegments({
    transition,
    calendar,
    nextSegmentId: id("5"),
  }).opened!;
  return { calendar, policy, transition, openSegment };
}

describe("US5 SLA API and browser transparency", () => {
  it("shows start authority, mapped pause, risk, policy mode and immutable provenance", () => {
    const sla: QaSlaView = Object.freeze({
      policyMode: "ENFORCED",
      goals: Object.freeze([
        Object.freeze({
          goal: "READY_TO_FIRST_QA_START",
          clockState: "PAUSED",
          targetState: "AT_RISK",
          targetConfiguration: Object.freeze({
            state: "CONFIGURED",
            targetBusinessSeconds: 28_800,
            remainingBusinessSeconds: 10_800,
            computedTargetAt: "2026-09-08T10:00:00.000Z",
          }),
          elapsedBusinessSeconds: 18_000,
          startedAt: "2026-09-07T05:00:00.000Z",
          pause: Object.freeze({
            state: "PAUSED",
            mappedReasonCode: "WAITING_EXTERNAL",
            pausedAt: "2026-09-07T10:00:00.000Z",
            sourceRef: Object.freeze({
              sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
              sourceId: id("6"),
              sourceVersion: 6,
              semanticHash: digest("jira-pause:6"),
            }),
          }),
          clockCycle: 1,
          clockRevisionRef: Object.freeze({
            id: id("3"),
            version: 2,
            semanticHash: digest("clock:2"),
          }),
          policyFacetRef: Object.freeze({
            id: id("2"),
            version: 1,
            semanticHash: digest("policy:1"),
          }),
          calendarRef: Object.freeze({
            id: policyIds.calendar,
            version: 1,
            semanticHash: digest("calendar:1"),
          }),
          startSourceRef: Object.freeze({
            sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
            sourceId: id("4"),
            sourceVersion: 5,
            semanticHash: digest("jira-ready:5"),
            confirmedAt: "2026-09-07T05:00:00.000Z",
          }),
          freshness: "CURRENT",
          asOf: "2026-09-07T12:00:00.000Z",
          evaluationHash: digest("evaluation:paused"),
        }),
        Object.freeze({
          goal: "READY_TO_SIGNED_VERDICT",
          clockState: "RUNNING",
          targetState: "ON_TRACK",
          targetConfiguration: Object.freeze({
            state: "CONFIGURED",
            targetBusinessSeconds: 57_600,
            remainingBusinessSeconds: 39_600,
          }),
          elapsedBusinessSeconds: 18_000,
          startedAt: "2026-09-07T05:00:00.000Z",
          pause: Object.freeze({ state: "NOT_PAUSED" }),
          clockCycle: 1,
          clockRevisionRef: Object.freeze({
            id: id("7"),
            version: 1,
            semanticHash: digest("verdict-clock:1"),
          }),
          policyFacetRef: Object.freeze({
            id: id("2"),
            version: 1,
            semanticHash: digest("policy:1"),
          }),
          calendarRef: Object.freeze({
            id: policyIds.calendar,
            version: 1,
            semanticHash: digest("calendar:1"),
          }),
          startSourceRef: Object.freeze({
            sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
            sourceId: id("4"),
            sourceVersion: 5,
            semanticHash: digest("jira-ready:5"),
            confirmedAt: "2026-09-07T05:00:00.000Z",
          }),
          freshness: "CURRENT",
          asOf: "2026-09-07T12:00:00.000Z",
          evaluationHash: digest("evaluation:running"),
        }),
      ]),
    });
    const markup = render(QaQueueItem({ entry, sla }));
    expect(markup).toContain("Прозрачность SLA");
    expect(markup).toContain("Политика · Применяется");
    expect(markup).toContain("Риск · Под угрозой");
    expect(markup).toContain("Приостановлено:");
    expect(markup).toContain("причина: Ожидание внешней системы");
    expect(markup).toContain("Источник начала Редакция рабочей проекции Jira");
    expect(markup).toContain("Аспект политики");
    expect(markup).toContain("Календарь");
    expect(markup).toContain(digest("evaluation:paused"));
  });

  it("returns a closed two-goal API projection with one server asOf and no provider reads", async () => {
    const fixture = clockFixture();
    const provider = vi.fn();
    const model = vi.fn();
    const service = new ProjectSlaQueryService({
      authorize: async () => true,
      workItemExists: async () => true,
      currentPolicyFacet: async () => fixture.policy,
      policyFacetByRef: async () => fixture.policy,
      calendarByRef: async () => fixture.calendar,
      currentClock: async (_input, goal) =>
        goal === fixture.transition.goal ? fixture.transition : undefined,
      openSegment: async () => fixture.openSegment,
      now: () => "2026-09-07T10:00:00.000Z",
      provider: { read: provider },
      model: { invoke: model },
    });
    const result = await service.read({
      principalId: policyIds.principal,
      workspaceId: policyIds.workspace,
      projectId: policyIds.projectA,
      workItemId: entry.subject.id,
    });
    expect(result.snapshots.map(({ goal }) => goal)).toEqual([
      "READY_TO_FIRST_QA_START",
      "READY_TO_SIGNED_VERDICT",
    ]);
    expect(new Set(result.snapshots.map(({ asOf }) => asOf))).toEqual(
      new Set(["2026-09-07T10:00:00.000Z"]),
    );
    expect(result.etag).toMatch(/^"sha256:[a-f0-9]{64}"$/u);
    expect(provider).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
  });

  it("drives all documented US5 start, calendar, pause, policy, notification and read-hash scenarios", async () => {
    const ids = [
      "us5-local-dor-does-not-start-sla",
      "us5-confirmed-ready-starts-at-confirmed-at",
      "us5-no-rollout-backdating",
      "us5-rollout-duplicate-read-receipt",
      "us5-business-calendar-golden-vectors",
      "us5-finite-calendar-policy-rejected",
      "us5-confirmed-pause-resume",
      "us5-unknown-pause-reason-keeps-running",
      "us5-policy-calendar-revision-pinning",
      "us5-measure-only-versus-enforced",
      "us5-notification-dedupe-and-outage",
      "us5-clock-revision-versus-evaluation-hash",
    ] as const;
    const results = await Promise.all(
      ids.map(async (scenarioId) => await runQueueScenario(scenarioId, { mode: "TEST" })),
    );
    expect(results.map(({ id: scenarioId, status }) => [scenarioId, status])).toEqual(
      ids.map((scenarioId) => [scenarioId, "PASS"]),
    );
  });

  it("recovers an overdue durable deadline after restart and reopens a stopped clock as a pinned new cycle", async () => {
    const fixture = clockFixture();
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          workspace_id: policyIds.workspace,
          project_id: policyIds.projectA,
          sla_clock_id: fixture.transition.slaClockId,
          due_at: "2026-09-07T09:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([]);
    const evaluateSlaClock = vi
      .fn()
      .mockResolvedValue({ changed: true, nextEvaluationAt: "2026-09-07T13:00:00.000Z" });
    const worker = new PostgresQueueTemporalTransitionWorker(
      { query } as never,
      {
        evaluateQueueEntry: vi.fn(),
        evaluateSlaClock,
        expireOrderOverride: vi.fn(),
        expireExpedite: vi.fn(),
      },
      () => "2026-09-07T10:00:00.000Z",
    );
    await expect(worker.run(1, "STARTUP")).resolves.toMatchObject({
      claimed: 1,
      semanticChanges: 1,
      rescheduled: 1,
    });
    expect(evaluateSlaClock).toHaveBeenCalledOnce();

    const stopped = advanceSlaClock({
      current: fixture.transition,
      calendar: fixture.calendar,
      command: {
        kind: "STOP",
        sourceRef: Object.freeze({
          sourceType: "QA_TEST_SESSION_REVISION",
          sourceId: id("8"),
          sourceVersion: 1,
          semanticHash: digest("session-start"),
        }),
        effectiveAt: "2026-09-07T07:00:00.000Z",
      },
    });
    if (stopped.outcome !== "APPENDED") throw new Error("expected stop");
    const reopened = advanceSlaClock({
      current: stopped.transition,
      calendar: fixture.calendar,
      command: {
        kind: "REOPEN",
        sourceRef: Object.freeze({
          sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
          sourceId: id("9"),
          sourceVersion: 6,
          semanticHash: digest("jira-reopen:6"),
          observedAt: "2026-09-08T04:59:00.000Z",
          confirmedAt: "2026-09-08T05:00:00.000Z",
        }),
      },
    });
    expect(reopened).toMatchObject({
      outcome: "APPENDED",
      transition: {
        transition: "START",
        clockCycle: 2,
        currentClockState: "RUNNING",
        elapsedBusinessSecondsAtTransition: 0,
      },
    });
    if (reopened.outcome !== "APPENDED") throw new Error("expected reopen");
    expect(reopened.transition.policyFacetRef).toEqual(fixture.transition.policyFacetRef);
    expect(reopened.transition.calendarRef).toEqual(fixture.transition.calendarRef);
  });
});
