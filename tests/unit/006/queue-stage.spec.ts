import { describe, expect, it } from "vitest";

import {
  deriveQueueStage,
  type QueueStageInput,
  shouldSuppressQueuePrecursor,
} from "../../../packages/platform-core/src/work-management/queue-stage.ts";

const workItem = (overrides: Partial<QueueStageInput> = {}): QueueStageInput => ({
  subject: { kind: "WORK_ITEM", id: "work-1" },
  operational: { state: "CONFIRMED", normalizedStatus: "BACKLOG", displayStatus: "Open" },
  qa: { readiness: "NOT_ASSESSED", activities: [] },
  ...overrides,
});

describe("queue-stage@1.0.0 precedence", () => {
  it.each([
    [{ kind: "CANDIDATE", id: "candidate-1", candidateState: "PENDING" }, "PENDING_CANDIDATE"],
    [{ kind: "CANDIDATE", id: "candidate-2", candidateState: "SNOOZED" }, "SNOOZED_CANDIDATE"],
    [{ kind: "DRAFT", id: "draft-1", linkedToConfirmedWorkItem: false }, "UNLINKED_DRAFT"],
  ] as const)("keeps %s in Candidate without operational effects", (subject, detail) => {
    expect(
      deriveQueueStage({
        subject,
        operational: { state: "NOT_APPLICABLE" },
        qa: { readiness: "NOT_ASSESSED", activities: [] },
      }),
    ).toMatchObject({
      algorithm: "queue-stage@1.0.0",
      stage: "CANDIDATE",
      detail,
      activityOrigins: [],
      consistencyWarnings: [],
    });
  });

  it("gives confirmed terminal Jira state precedence and reports open QA", () => {
    expect(
      deriveQueueStage(
        workItem({
          operational: { state: "CONFIRMED", normalizedStatus: "DONE", displayStatus: "Done" },
          qa: {
            readiness: "READY",
            activities: [{ sessionId: "s1", mode: "MANUAL", state: "RUNNING" }],
          },
        }),
      ),
    ).toMatchObject({
      stage: "COMPLETED",
      reasonCodes: ["JIRA_TERMINAL"],
      consistencyWarnings: ["TERMINAL_WITH_OPEN_QA"],
    });
  });

  it.each([
    ["RUNNING", "SESSION_MANUAL"],
    ["REVIEW_REQUIRED", "SESSION_MANUAL"],
    ["BLOCKED", "SESSION_MANUAL"],
  ] as const)("treats post-start manual %s as Active", (state, origin) => {
    expect(
      deriveQueueStage(
        workItem({
          qa: { readiness: "READY", activities: [{ sessionId: "s1", mode: "MANUAL", state }] },
        }),
      ),
    ).toMatchObject({
      stage: "ACTIVE",
      activityOrigins: [origin],
    });
  });

  it("keeps Jira and Session origins separate and exposes inconsistency", () => {
    expect(
      deriveQueueStage(
        workItem({
          operational: {
            state: "CONFIRMED",
            normalizedStatus: "IN_PROGRESS",
            displayStatus: "Doing",
          },
          qa: { readiness: "READY", activities: [] },
        }),
      ),
    ).toMatchObject({
      stage: "ACTIVE",
      activityOrigins: ["JIRA"],
      consistencyWarnings: ["EXTERNAL_STATE_AHEAD"],
    });
  });

  it.each([
    ["READY", "READY"],
    ["PLANNED", "COMMITTED"],
  ] as const)(
    "derives Ready from confirmed Jira %s plus current DoR",
    (normalizedStatus, detail) => {
      expect(
        deriveQueueStage(
          workItem({
            operational: { state: "CONFIRMED", normalizedStatus, displayStatus: normalizedStatus },
            qa: {
              readiness: "READY_WITH_WAIVER",
              activities: [{ sessionId: "s1", mode: "MANUAL", state: "READY" }],
            },
          }),
        ),
      ).toMatchObject({ stage: "READY", detail });
    },
  );

  it.each([
    [{ operational: { state: "PENDING" } }, "OPERATIONAL_PENDING"],
    [{ operational: { state: "ERROR" } }, "SYNC_ERROR"],
    [{ qa: { readiness: "NEEDS_INFO", activities: [] } }, "NEEDS_INFO"],
    [{ qa: { readiness: "STALE", activities: [] } }, "READINESS_STALE"],
    [
      {
        operational: {
          state: "CONFIRMED",
          normalizedStatus: "COMPLETION_PENDING",
          displayStatus: "Done pending",
        },
      },
      "COMPLETION_PENDING",
    ],
  ] as const)("uses stable Backlog reason %s", (override, reason) => {
    expect(deriveQueueStage(workItem(override as Partial<QueueStageInput>))).toMatchObject({
      stage: "BACKLOG",
      reasonCodes: [reason],
    });
  });

  it("suppresses only a precursor linked to the same confirmed Work Item", () => {
    expect(
      shouldSuppressQueuePrecursor({
        precursorProjectId: "p1",
        workItemProjectId: "p1",
        linkedWorkItemId: "w1",
        confirmedWorkItemId: "w1",
      }),
    ).toBe(true);
    expect(
      shouldSuppressQueuePrecursor({
        precursorProjectId: "p1",
        workItemProjectId: "p2",
        linkedWorkItemId: "w1",
        confirmedWorkItemId: "w1",
      }),
    ).toBe(false);
  });
});
