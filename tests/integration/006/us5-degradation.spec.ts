import { describe, expect, it, vi } from "vitest";

import {
  applySlaClockTransitionToSegments,
  createInitialSlaClock,
  projectQueuePolicyFacet,
  type SlaClockSegmentRevision,
  type SlaClockTransition,
} from "../../../packages/platform-core/src/index.ts";
import {
  planSlaThresholds,
  ProjectSlaQueryService,
  SlaLifecycleProjector,
  SlaThresholdNotificationService,
} from "../../../packages/runtime-composition/src/index.ts";
import {
  businessCalendarFixture,
  policyIds,
  queuePolicyFixture,
} from "../../helpers/006/policy-fixture.ts";
import { digest } from "../../helpers/006/triage-fixture.ts";

const id = (suffix: string): string => `69000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

function running() {
  const calendar = businessCalendarFixture();
  const policy = projectQueuePolicyFacet(
    queuePolicyFixture("ENFORCED", calendar),
    policyIds.projectA,
    { id: id("1"), version: 1 },
  );
  const transition = createInitialSlaClock({
    workspaceId: policyIds.workspace,
    projectId: policyIds.projectA,
    workItemId: id("2"),
    slaClockId: id("3"),
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
      semanticHash: digest("sla-business-time@1"),
    },
    startSourceRef: {
      sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
      sourceId: id("4"),
      sourceVersion: 1,
      semanticHash: digest("jira-ready"),
      observedAt: "2026-09-07T04:59:00.000Z",
      confirmedAt: "2026-09-07T05:00:00.000Z",
    },
  });
  const segment = applySlaClockTransitionToSegments({
    transition,
    calendar,
    nextSegmentId: id("5"),
  }).opened!;
  return { calendar, policy, transition, segment, target: policy.slaGoals[0]! };
}

describe("US5 degradation preserves local SLA authority", () => {
  it("keeps a stale clock visible and does not auto-pause or invoke Jira/model/GitLab/Mattermost", async () => {
    const value = running();
    const jiraRead = vi.fn().mockRejectedValue(new Error("JIRA_DOWN"));
    const jiraWrite = vi.fn().mockRejectedValue(new Error("JIRA_DOWN"));
    const model = vi.fn().mockRejectedValue(new Error("MODEL_DOWN"));
    const gitlab = vi.fn().mockRejectedValue(new Error("GITLAB_DOWN"));
    const mattermost = vi.fn().mockRejectedValue(new Error("MATTERMOST_DOWN"));
    const service = new ProjectSlaQueryService({
      authorize: vi.fn().mockResolvedValue(true),
      workItemExists: vi.fn().mockResolvedValue(true),
      currentPolicyFacet: vi.fn().mockResolvedValue(value.policy),
      policyFacetByRef: vi.fn().mockResolvedValue(value.policy),
      calendarByRef: vi.fn().mockResolvedValue(value.calendar),
      currentClock: vi.fn(async (_input, goal) =>
        goal === value.transition.goal ? value.transition : undefined,
      ),
      openSegment: vi.fn().mockResolvedValue(value.segment),
      freshness: vi.fn().mockResolvedValue("STALE"),
      now: () => "2026-09-07T10:00:00.000Z",
      provider: { read: jiraRead },
      model: { invoke: model },
    });

    const response = await service.read({
      workspaceId: policyIds.workspace,
      projectId: policyIds.projectA,
      workItemId: id("2"),
      principalId: id("6"),
    });
    expect(response.snapshots[0]).toMatchObject({
      clockState: "RUNNING",
      freshness: "STALE",
      elapsedBusinessSeconds: 18_000,
    });

    const lifecycle = new SlaLifecycleProjector({
      load: vi.fn().mockResolvedValue({
        transition: value.transition,
        calendar: value.calendar,
        segments: [value.segment],
        target: value.target,
        operational: {
          sourceRef: {
            ...value.transition.startSourceRef,
            sourceVersion: 2,
            sourceId: id("7"),
            semanticHash: digest("jira-current"),
            confirmedAt: "2026-09-07T10:00:00.000Z",
          },
          effect: "CONTINUE",
        },
      }),
      append: vi.fn(),
    });
    await expect(
      lifecycle.project({
        workspaceId: policyIds.workspace,
        projectId: policyIds.projectA,
        workItemId: id("2"),
      }),
    ).resolves.toBe(0);
    expect(value.transition.currentClockState).toBe("RUNNING");

    expect(jiraRead).not.toHaveBeenCalled();
    expect(jiraWrite).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
    expect(gitlab).not.toHaveBeenCalled();
    expect(mattermost).not.toHaveBeenCalled();
  });

  it("preserves a queued notification during delivery outage and still accepts a local manual stop", async () => {
    const value = running();
    const plan = planSlaThresholds({
      transition: value.transition,
      segments: [value.segment],
      calendar: value.calendar,
      target: value.target,
      asOf: "2026-09-07T10:00:00.000Z",
    });
    const stored: unknown[] = [];
    const notifications = new SlaThresholdNotificationService({
      createNotificationIntent: async (intent) => {
        stored.push(intent);
        return { value: intent, replayed: false };
      },
      appendThresholdEmission: async () => ({ outcome: "APPENDED" }),
    });
    const emitted = await notifications.emit({
      transition: value.transition,
      crossing: plan.crossings[0]!,
      expiresAt: "2026-10-07T09:00:00.000Z",
    });
    expect(emitted.notificationIntent.state).toBe("QUEUED");
    expect(stored).toHaveLength(1);

    let transition: SlaClockTransition = value.transition;
    let segments: readonly SlaClockSegmentRevision[] = [value.segment];
    const lifecycle = new SlaLifecycleProjector({
      load: async ({ goal }) =>
        goal === "READY_TO_FIRST_QA_START"
          ? {
              transition,
              calendar: value.calendar,
              segments,
              target: value.target,
              firstConsumingSession: {
                sourceRef: {
                  sourceType: "QA_TEST_SESSION_REVISION",
                  sourceId: id("8"),
                  sourceVersion: 2,
                  semanticHash: digest("manual-running"),
                },
                effectiveAt: "2026-09-07T10:00:00.000Z",
              },
            }
          : undefined,
      append: async (input) => {
        transition = input.transition;
        segments = [input.closedSegment.value];
        return { outcome: "APPENDED" };
      },
    });
    await expect(
      lifecycle.project({
        workspaceId: policyIds.workspace,
        projectId: policyIds.projectA,
        workItemId: id("2"),
      }),
    ).resolves.toBe(1);
    expect(transition).toMatchObject({
      currentClockState: "STOPPED",
      transitionSourceRef: { sourceType: "QA_TEST_SESSION_REVISION" },
    });
  });
});
