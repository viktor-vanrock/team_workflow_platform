import { describe, expect, it } from "vitest";

import {
  advanceSlaClock,
  applySlaClockTransitionToSegments,
  createInitialSlaClock,
  projectQueuePolicyFacet,
} from "../../../packages/platform-core/src/index.ts";
import { evaluateSlaSnapshot } from "../../../packages/runtime-composition/src/index.ts";
import {
  businessCalendarFixture,
  policyIds,
  queuePolicyFixture,
} from "../../helpers/006/policy-fixture.ts";
import { digest } from "../../helpers/006/triage-fixture.ts";

const id = (suffix: string): string => `64000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const jira = (version: number, confirmedAt: string) =>
  Object.freeze({
    sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION" as const,
    sourceId: id(`${version}`),
    sourceVersion: version,
    semanticHash: digest(`jira:${version}`),
    observedAt: confirmedAt,
    confirmedAt,
  });

function started(mode: "MEASURE_ONLY" | "ENFORCED") {
  const calendar = businessCalendarFixture();
  const policy = projectQueuePolicyFacet(queuePolicyFixture(mode, calendar), policyIds.projectA, {
    id: id(mode === "ENFORCED" ? "10" : "11"),
    version: 1,
  });
  const target = policy.slaGoals[0]!;
  const transition = createInitialSlaClock({
    workspaceId: policyIds.workspace,
    projectId: policyIds.projectA,
    workItemId: id("12"),
    slaClockId: id(mode === "ENFORCED" ? "13" : "14"),
    goal: "READY_TO_FIRST_QA_START",
    policyFacetRef: policy.policyFacetRef,
    calendarRef: policy.calendarRef,
    mappingRef: {
      ...policy.statusMappingRef,
      sourceVersion: Number(policy.statusMappingRef.sourceVersion),
    },
    algorithmRef: {
      key: "sla-business-time",
      version: "1.0.0",
      semanticHash: digest("sla-business-time"),
    },
    startSourceRef: jira(1, "2026-09-07T05:00:00.000Z"),
  });
  const openSegment = applySlaClockTransitionToSegments({
    transition,
    calendar,
    nextSegmentId: id(mode === "ENFORCED" ? "15" : "16"),
  }).opened!;
  return { calendar, target, transition, openSegment };
}

describe("US5 SLA policy modes", () => {
  it("keeps a running MEASURE_ONLY clock explicitly NOT_CONFIGURED", () => {
    const value = started("MEASURE_ONLY");
    expect(evaluateSlaSnapshot({ ...value, asOf: "2026-09-07T09:00:00.000Z" })).toMatchObject({
      clockState: "RUNNING",
      targetState: "NOT_CONFIGURED",
      targetConfiguration: { state: "NOT_CONFIGURED" },
      elapsedBusinessSeconds: 14_400,
    });
  });

  it("derives ON_TRACK, AT_RISK and BREACHED from exact ordered thresholds and target", () => {
    const value = started("ENFORCED");
    expect(evaluateSlaSnapshot({ ...value, asOf: "2026-09-07T08:59:59.000Z" })).toMatchObject({
      targetState: "ON_TRACK",
      elapsedBusinessSeconds: 14_399,
    });
    expect(evaluateSlaSnapshot({ ...value, asOf: "2026-09-07T09:00:00.000Z" })).toMatchObject({
      targetState: "AT_RISK",
      elapsedBusinessSeconds: 14_400,
      targetConfiguration: {
        targetBusinessSeconds: 28_800,
        remainingBusinessSeconds: 14_400,
        computedTargetAt: "2026-09-07T13:00:00.000Z",
      },
    });
    expect(evaluateSlaSnapshot({ ...value, asOf: "2026-09-07T13:00:00.000Z" })).toMatchObject({
      targetState: "BREACHED",
      elapsedBusinessSeconds: 28_800,
      targetConfiguration: { remainingBusinessSeconds: 0 },
    });
  });

  it("reports COMPLETED after the exact goal stop even when the target was not exhausted", () => {
    const value = started("ENFORCED");
    const stopped = advanceSlaClock({
      current: value.transition,
      calendar: value.calendar,
      command: {
        kind: "STOP",
        sourceRef: {
          sourceType: "QA_TEST_SESSION_REVISION",
          sourceId: id("20"),
          sourceVersion: 2,
          semanticHash: digest("session"),
        },
        effectiveAt: "2026-09-07T07:00:00.000Z",
      },
    });
    if (stopped.outcome !== "APPENDED") throw new Error("expected stop");
    expect(
      evaluateSlaSnapshot({
        transition: stopped.transition,
        calendar: value.calendar,
        target: value.target,
        asOf: "2026-09-07T12:00:00.000Z",
      }),
    ).toMatchObject({
      clockState: "STOPPED",
      targetState: "COMPLETED",
      elapsedBusinessSeconds: 7_200,
      stoppedAt: "2026-09-07T07:00:00.000Z",
      stopSourceRef: { sourceType: "QA_TEST_SESSION_REVISION" },
    });
  });
});
