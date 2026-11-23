import { describe, expect, it } from "vitest";

import {
  advanceSlaClock,
  applySlaClockTransitionToSegments,
  type BusinessCalendarRevision,
  createInitialSlaClock,
  publishBusinessCalendar,
} from "../../../packages/platform-core/src/index.ts";
import { digest } from "../../helpers/006/triage-fixture.ts";

const id = (suffix: string): string => `61000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ref = (suffix: string) => ({
  id: id(suffix),
  version: 1,
  semanticHash: digest(`ref:${suffix}`),
});
const jira = (version: number, confirmedAt: string) => ({
  sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION" as const,
  sourceId: id(`2${version}`),
  sourceVersion: version,
  semanticHash: digest(`jira:${version}`),
  confirmedAt,
});

function calendar(): BusinessCalendarRevision {
  return publishBusinessCalendar({
    schemaVersion: "business-calendar@1.0.0",
    calendarId: id("1"),
    calendarKey: "sla-hours",
    workspaceId: id("2"),
    revision: 1,
    timeZone: "UTC",
    validFrom: "2026-01-01",
    validThrough: null,
    weeklyIntervals: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"].map((dayOfWeek) => ({
      dayOfWeek: dayOfWeek as "MONDAY",
      startLocalTime: "09:00:00",
      endLocalTime: "17:00:00",
    })),
    dateOverrides: [],
    dstAlgorithmRef: {
      key: "business-calendar-dst",
      version: "1.0.0",
      semanticHash: digest("dst"),
    },
    dstRules: {
      nonexistentBoundary: "SHIFT_TO_FIRST_VALID_INSTANT_AFTER_GAP",
      ambiguousStart: "EARLIEST_MATCHING_INSTANT",
      ambiguousEnd: "LATEST_MATCHING_INSTANT",
    },
    sourceKind: "MANUAL",
    sourceRef: "calendar:1",
    sourceHash: digest("source"),
    ownerPrincipalId: id("3"),
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    publishedAt: "2026-01-01T00:00:00.000Z",
    publishedByPrincipalId: id("3"),
  });
}

function initial(
  goal: "READY_TO_FIRST_QA_START" | "READY_TO_SIGNED_VERDICT" = "READY_TO_FIRST_QA_START",
) {
  const value = calendar();
  return {
    value,
    clock: createInitialSlaClock({
      workspaceId: id("2"),
      projectId: id("4"),
      workItemId: id("5"),
      slaClockId: id(goal === "READY_TO_FIRST_QA_START" ? "6" : "7"),
      goal,
      policyFacetRef: ref("8"),
      calendarRef: {
        id: value.calendarId,
        version: value.revision,
        semanticHash: value.semanticHash,
      },
      mappingRef: {
        sourceType: "JIRA_STATUS_MAPPING_REVISION",
        sourceId: id("9"),
        sourceVersion: 1,
        semanticHash: digest("mapping"),
      },
      algorithmRef: { key: "sla-clock", version: "1.0.0", semanticHash: digest("algorithm") },
      startSourceRef: jira(1, "2026-09-07T09:00:00.000Z"),
    }),
  };
}

describe("immutable SLA clock transitions", () => {
  it("keeps unknown pause reasons RUNNING and accumulates only RUNNING business time", () => {
    const { value, clock } = initial();
    expect(
      advanceSlaClock({
        current: clock,
        calendar: value,
        command: { kind: "PAUSE", sourceRef: jira(2, "2026-09-07T11:00:00.000Z") },
      }),
    ).toEqual({ outcome: "NO_CHANGE", reason: "UNKNOWN_PAUSE_REASON" });
    const paused = advanceSlaClock({
      current: clock,
      calendar: value,
      command: {
        kind: "PAUSE",
        sourceRef: jira(2, "2026-09-07T12:00:00.000Z"),
        mappedPauseReasonCode: "WAITING_EXTERNAL",
      },
    });
    expect(paused).toMatchObject({
      outcome: "APPENDED",
      transition: {
        previousClockState: "RUNNING",
        currentClockState: "PAUSED",
        elapsedBusinessSecondsAtTransition: 10_800,
      },
    });
    if (paused.outcome !== "APPENDED") throw new Error("expected pause");
    const resumed = advanceSlaClock({
      current: paused.transition,
      calendar: value,
      command: { kind: "RESUME", sourceRef: jira(3, "2026-09-08T09:00:00.000Z") },
    });
    expect(resumed).toMatchObject({
      outcome: "APPENDED",
      transition: {
        previousClockState: "PAUSED",
        currentClockState: "RUNNING",
        elapsedBusinessSecondsAtTransition: 10_800,
      },
    });
    if (resumed.outcome !== "APPENDED") throw new Error("expected resume");
    const stopped = advanceSlaClock({
      current: resumed.transition,
      calendar: value,
      command: {
        kind: "STOP",
        sourceRef: {
          sourceType: "QA_TEST_SESSION_REVISION",
          sourceId: id("10"),
          sourceVersion: 2,
          semanticHash: digest("session"),
        },
        effectiveAt: "2026-09-08T11:00:00.000Z",
      },
    });
    expect(stopped).toMatchObject({
      outcome: "APPENDED",
      transition: {
        currentClockState: "STOPPED",
        elapsedBusinessSecondsAtTransition: 18_000,
        clockCycle: 1,
      },
    });
  });

  it("requires goal-specific stop sources and monotonic Jira facts", () => {
    const first = initial();
    expect(() =>
      advanceSlaClock({
        current: first.clock,
        calendar: first.value,
        command: {
          kind: "STOP",
          sourceRef: {
            sourceType: "QA_VERDICT_REVISION",
            sourceId: id("11"),
            sourceVersion: 1,
            semanticHash: digest("verdict"),
          },
          effectiveAt: "2026-09-07T10:00:00.000Z",
        },
      }),
    ).toThrow("SLA_CLOCK_STOP_SOURCE_GOAL_MISMATCH");
    expect(() =>
      advanceSlaClock({
        current: first.clock,
        calendar: first.value,
        command: {
          kind: "PAUSE",
          sourceRef: jira(1, "2026-09-07T10:00:00.000Z"),
          mappedPauseReasonCode: "WAIT",
        },
      }),
    ).toThrow("SLA_CLOCK_JIRA_SOURCE_NON_MONOTONIC");
    const verdict = initial("READY_TO_SIGNED_VERDICT");
    expect(() =>
      advanceSlaClock({
        current: verdict.clock,
        calendar: verdict.value,
        command: {
          kind: "STOP",
          sourceRef: {
            sourceType: "QA_TEST_SESSION_REVISION",
            sourceId: id("12"),
            sourceVersion: 1,
            semanticHash: digest("session"),
          },
          effectiveAt: "2026-09-07T10:00:00.000Z",
        },
      }),
    ).toThrow("SLA_CLOCK_STOP_SOURCE_GOAL_MISMATCH");
  });

  it("enforces the closed transition truth table and freezes elapsed time while paused", () => {
    const { value, clock } = initial();
    expect(() =>
      advanceSlaClock({
        current: clock,
        calendar: value,
        command: { kind: "RESUME", sourceRef: jira(2, "2026-09-07T10:00:00.000Z") },
      }),
    ).toThrow("SLA_CLOCK_RESUME_STATE_INVALID");
    expect(() =>
      advanceSlaClock({
        current: clock,
        calendar: value,
        command: { kind: "REOPEN", sourceRef: jira(2, "2026-09-07T10:00:00.000Z") },
      }),
    ).toThrow("SLA_CLOCK_REOPEN_STATE_INVALID");
    const paused = advanceSlaClock({
      current: clock,
      calendar: value,
      command: {
        kind: "PAUSE",
        sourceRef: jira(2, "2026-09-07T11:00:00.000Z"),
        mappedPauseReasonCode: "WAITING_EXTERNAL",
      },
    });
    if (paused.outcome !== "APPENDED") throw new Error("expected pause");
    expect(() =>
      advanceSlaClock({
        current: paused.transition,
        calendar: value,
        command: {
          kind: "PAUSE",
          sourceRef: jira(3, "2026-09-07T12:00:00.000Z"),
          mappedPauseReasonCode: "WAITING_EXTERNAL",
        },
      }),
    ).toThrow("SLA_CLOCK_PAUSE_STATE_INVALID");
    const stopped = advanceSlaClock({
      current: paused.transition,
      calendar: value,
      command: {
        kind: "STOP",
        sourceRef: {
          sourceType: "QA_TEST_SESSION_REVISION",
          sourceId: id("19"),
          sourceVersion: 1,
          semanticHash: digest("paused-stop"),
        },
        effectiveAt: "2026-09-08T12:00:00.000Z",
      },
    });
    expect(stopped).toMatchObject({
      outcome: "APPENDED",
      transition: { elapsedBusinessSecondsAtTransition: 7_200, currentClockState: "STOPPED" },
    });
    if (stopped.outcome !== "APPENDED") throw new Error("expected stop");
    expect(() =>
      advanceSlaClock({
        current: stopped.transition,
        calendar: value,
        command: {
          kind: "STOP",
          sourceRef: {
            sourceType: "QA_TEST_SESSION_REVISION",
            sourceId: id("19"),
            sourceVersion: 2,
            semanticHash: digest("stopped-again"),
          },
          effectiveAt: "2026-09-08T13:00:00.000Z",
        },
      }),
    ).toThrow("SLA_CLOCK_STOP_STATE_INVALID");
  });

  it("accepts a one-time rollout verification as the initial source without backdating", () => {
    const value = calendar();
    const confirmedAt = "2026-09-10T09:00:00.000Z";
    const clock = createInitialSlaClock({
      workspaceId: id("2"),
      projectId: id("4"),
      workItemId: id("5"),
      slaClockId: id("30"),
      goal: "READY_TO_FIRST_QA_START",
      policyFacetRef: ref("31"),
      calendarRef: {
        id: value.calendarId,
        version: value.revision,
        semanticHash: value.semanticHash,
      },
      mappingRef: {
        sourceType: "JIRA_STATUS_MAPPING_REVISION",
        sourceId: id("32"),
        sourceVersion: 1,
        semanticHash: digest("mapping-rollout"),
      },
      algorithmRef: { key: "sla-clock", version: "1.0.0", semanticHash: digest("algorithm") },
      startSourceRef: {
        sourceType: "SLA_ROLLOUT_AUTHORITY_VERIFICATION",
        sourceId: id("33"),
        sourceVersion: 1,
        semanticHash: digest("rollout"),
        confirmedAt,
      },
    });
    expect(clock).toMatchObject({
      effectiveAt: confirmedAt,
      startedAt: confirmedAt,
      transitionSourceRef: { sourceType: "SLA_ROLLOUT_AUTHORITY_VERIFICATION" },
    });
  });

  it("starts a new cycle after STOP without reinterpreting pinned history", () => {
    const { value, clock } = initial();
    const stopped = advanceSlaClock({
      current: clock,
      calendar: value,
      command: {
        kind: "STOP",
        sourceRef: {
          sourceType: "QA_TEST_SESSION_REVISION",
          sourceId: id("13"),
          sourceVersion: 1,
          semanticHash: digest("session-stop"),
        },
        effectiveAt: "2026-09-07T11:00:00.000Z",
      },
    });
    if (stopped.outcome !== "APPENDED") throw new Error("expected stop");
    const reopened = advanceSlaClock({
      current: stopped.transition,
      calendar: value,
      command: { kind: "REOPEN", sourceRef: jira(4, "2026-09-09T09:00:00.000Z") },
    });
    expect(reopened).toMatchObject({
      outcome: "APPENDED",
      transition: {
        transition: "START",
        previousClockState: "STOPPED",
        currentClockState: "RUNNING",
        clockCycle: 2,
        elapsedBusinessSecondsAtTransition: 0,
        previousClockRevisionRef: stopped.transition.clockRevisionRef,
      },
    });
    if (reopened.outcome !== "APPENDED") throw new Error("expected reopen");
    expect(reopened.transition.policyFacetRef).toEqual(clock.policyFacetRef);
    expect(reopened.transition.calendarRef).toEqual(clock.calendarRef);
  });

  it("creates half-open RUNNING/PAUSED segment lineage", () => {
    const { value, clock } = initial();
    const opened = applySlaClockTransitionToSegments({
      transition: clock,
      calendar: value,
      nextSegmentId: id("20"),
    }).opened!;
    const paused = advanceSlaClock({
      current: clock,
      calendar: value,
      command: {
        kind: "PAUSE",
        sourceRef: jira(2, "2026-09-07T12:00:00.000Z"),
        mappedPauseReasonCode: "WAITING_EXTERNAL",
      },
    });
    if (paused.outcome !== "APPENDED") throw new Error("expected pause");
    const pauseSegments = applySlaClockTransitionToSegments({
      transition: paused.transition,
      calendar: value,
      openSegment: opened,
      nextSegmentId: id("21"),
    });
    expect(pauseSegments.closed).toMatchObject({
      state: "RUNNING",
      endedAt: "2026-09-07T12:00:00.000Z",
      businessSeconds: 10_800,
    });
    expect(pauseSegments.opened).toMatchObject({ state: "PAUSED", ordinal: 2, businessSeconds: 0 });
    const resumed = advanceSlaClock({
      current: paused.transition,
      calendar: value,
      command: { kind: "RESUME", sourceRef: jira(3, "2026-09-08T09:00:00.000Z") },
    });
    if (resumed.outcome !== "APPENDED") throw new Error("expected resume");
    const resumeSegments = applySlaClockTransitionToSegments({
      transition: resumed.transition,
      calendar: value,
      openSegment: pauseSegments.opened!,
      nextSegmentId: id("22"),
    });
    expect(resumeSegments.closed).toMatchObject({ state: "PAUSED", businessSeconds: 0 });
    expect(resumeSegments.opened).toMatchObject({ state: "RUNNING", ordinal: 3 });
  });

  it("rejects later calendar reinterpretation", () => {
    const { value, clock } = initial();
    const changed = publishBusinessCalendar({
      ...value,
      dateOverrides: [{ kind: "CLOSED", date: "2026-09-07", reasonCode: "PUBLIC_HOLIDAY" }],
      semanticHash: undefined as never,
    });
    expect(() =>
      advanceSlaClock({
        current: clock,
        calendar: changed,
        command: {
          kind: "PAUSE",
          sourceRef: jira(2, "2026-09-07T10:00:00.000Z"),
          mappedPauseReasonCode: "WAIT",
        },
      }),
    ).toThrow("SLA_CLOCK_CALENDAR_PIN_MISMATCH");
  });
});
