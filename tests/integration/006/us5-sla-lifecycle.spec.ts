import { describe, expect, it, vi } from "vitest";

import {
  applySlaClockTransitionToSegments,
  createInitialSlaClock,
  projectQueuePolicyFacet,
  type SlaClockSegmentRevision,
  type SlaClockTransition,
  type SlaGoal,
} from "../../../packages/platform-core/src/index.ts";
import {
  type SlaLifecycleFacts,
  SlaLifecycleProjector,
} from "../../../packages/runtime-composition/src/index.ts";
import {
  businessCalendarFixture,
  policyIds,
  queuePolicyFixture,
} from "../../helpers/006/policy-fixture.ts";
import { digest } from "../../helpers/006/triage-fixture.ts";

const id = (suffix: string): string => `68000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

describe("US5 authoritative SLA lifecycle projection", () => {
  it("pauses/resumes from confirmed Jira and stops each goal only from its exact QA fact", async () => {
    const calendar = businessCalendarFixture();
    const policy = projectQueuePolicyFacet(
      queuePolicyFixture("ENFORCED", calendar),
      policyIds.projectA,
      { id: id("1"), version: 1 },
    );
    const workItemId = id("2");
    const values = new Map<SlaGoal, SlaLifecycleFacts>();
    for (const [index, goal] of (
      ["READY_TO_FIRST_QA_START", "READY_TO_SIGNED_VERDICT"] as const
    ).entries()) {
      const transition = createInitialSlaClock({
        workspaceId: policyIds.workspace,
        projectId: policyIds.projectA,
        workItemId,
        slaClockId: id(String(3 + index)),
        goal,
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
          sourceId: id("10"),
          sourceVersion: 1,
          semanticHash: digest("jira-ready"),
          observedAt: "2026-09-07T04:59:00.000Z",
          confirmedAt: "2026-09-07T05:00:00.000Z",
        },
      });
      const opened = applySlaClockTransitionToSegments({
        transition,
        calendar,
        nextSegmentId: id(String(20 + index)),
      }).opened!;
      values.set(goal, {
        transition,
        calendar,
        segments: [opened],
        target: policy.slaGoals.find((candidate) => candidate.goal === goal)!,
      });
    }
    const provider = { read: vi.fn() };
    const model = { invoke: vi.fn() };
    const append = vi.fn(
      async (
        input: Readonly<{
          transition: SlaClockTransition;
          closedSegment: Readonly<{ value: SlaClockSegmentRevision }>;
          openedSegment?: Readonly<{ value: SlaClockSegmentRevision }>;
        }>,
      ) => {
        const prior = values.get(input.transition.goal)!;
        values.set(
          input.transition.goal,
          Object.freeze({
            ...prior,
            transition: input.transition,
            segments: Object.freeze([
              ...prior.segments.filter(
                (segment) =>
                  segment.segmentRef.sourceId !== input.closedSegment.value.segmentRef.sourceId,
              ),
              input.closedSegment.value,
              ...(input.openedSegment ? [input.openedSegment.value] : []),
            ]),
          }),
        );
        return Object.freeze({ outcome: "APPENDED" as const });
      },
    );
    const projector = new SlaLifecycleProjector({
      load: async ({ goal }) => values.get(goal),
      append,
    });
    const setOperational = (effect: "PAUSE" | "RESUME", version: number, confirmedAt: string) => {
      for (const [goal, facts] of values)
        values.set(
          goal,
          Object.freeze({
            ...facts,
            operational: Object.freeze({
              sourceRef: Object.freeze({
                sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION" as const,
                sourceId: id(String(10 + version)),
                sourceVersion: version,
                semanticHash: digest(`jira-${version}`),
                observedAt: confirmedAt,
                confirmedAt,
              }),
              effect,
              ...(effect === "PAUSE" ? { mappedPauseReasonCode: "WAITING_EXTERNAL" } : {}),
            }),
          }),
        );
    };

    setOperational("PAUSE", 2, "2026-09-07T07:00:00.000Z");
    await expect(
      projector.project({
        workspaceId: policyIds.workspace,
        projectId: policyIds.projectA,
        workItemId,
      }),
    ).resolves.toBe(2);
    expect(
      [...values.values()].every(
        ({ transition }) =>
          transition.currentClockState === "PAUSED" &&
          transition.transition === "PAUSE" &&
          transition.mappedPauseReasonCode === "WAITING_EXTERNAL",
      ),
    ).toBe(true);

    setOperational("RESUME", 3, "2026-09-07T08:00:00.000Z");
    await expect(
      projector.project({
        workspaceId: policyIds.workspace,
        projectId: policyIds.projectA,
        workItemId,
      }),
    ).resolves.toBe(2);
    expect(
      [...values.values()].every(
        ({ transition }) =>
          transition.currentClockState === "RUNNING" && transition.transition === "RESUME",
      ),
    ).toBe(true);

    const first = values.get("READY_TO_FIRST_QA_START")!;
    values.set(
      "READY_TO_FIRST_QA_START",
      Object.freeze({
        ...first,
        firstConsumingSession: Object.freeze({
          sourceRef: Object.freeze({
            sourceType: "QA_TEST_SESSION_REVISION",
            sourceId: id("30"),
            sourceVersion: 4,
            semanticHash: digest("session-running"),
          }),
          effectiveAt: "2026-09-07T09:00:00.000Z",
        }),
      }),
    );
    await expect(
      projector.project({
        workspaceId: policyIds.workspace,
        projectId: policyIds.projectA,
        workItemId,
      }),
    ).resolves.toBe(1);
    expect(values.get("READY_TO_FIRST_QA_START")!.transition).toMatchObject({
      currentClockState: "STOPPED",
      transition: "STOP",
      transitionSourceRef: { sourceType: "QA_TEST_SESSION_REVISION" },
    });
    expect(values.get("READY_TO_SIGNED_VERDICT")!.transition.currentClockState).toBe("RUNNING");

    const verdictGoal = values.get("READY_TO_SIGNED_VERDICT")!;
    values.set(
      "READY_TO_SIGNED_VERDICT",
      Object.freeze({
        ...verdictGoal,
        signedVerdict: Object.freeze({
          sourceRef: Object.freeze({
            sourceType: "QA_VERDICT_REVISION",
            sourceId: id("31"),
            sourceVersion: 1,
            semanticHash: digest("verdict-signed"),
          }),
          effectiveAt: "2026-09-07T10:00:00.000Z",
        }),
      }),
    );
    await expect(
      projector.project({
        workspaceId: policyIds.workspace,
        projectId: policyIds.projectA,
        workItemId,
      }),
    ).resolves.toBe(1);
    expect(values.get("READY_TO_SIGNED_VERDICT")!.transition).toMatchObject({
      currentClockState: "STOPPED",
      transitionSourceRef: { sourceType: "QA_VERDICT_REVISION" },
    });
    expect(provider.read).not.toHaveBeenCalled();
    expect(model.invoke).not.toHaveBeenCalled();
  });
});
