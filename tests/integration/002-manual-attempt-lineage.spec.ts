import { describe, expect, it } from "vitest";

import {
  InMemoryManualExecutionRepository,
  ManualAttemptService,
  type ManualExecutionSeed,
  RecordObservationService,
  RecordPlanItemResultService,
} from "../../packages/competency-qa/src/node.ts";

const digest = (value: string) => `sha256:${value.padEnd(64, "0").slice(0, 64)}` as const;
const actor = {
  kind: "HUMAN" as const,
  principalId: "executor",
  issuer: "fake-idp",
  subject: "executor",
};

function seed(): ManualExecutionSeed {
  return {
    scope: { workspaceId: "workspace", projectId: "project" },
    workItemId: "work-item",
    sessionId: "session",
    sessionState: "RUNNING",
    sessionResourceVersion: 1,
    targetSnapshotHash: digest("target"),
    planItems: [{ planItemId: "item", expectedOutcome: "Page is healthy" }],
  };
}

describe("US3 immutable manual execution lineage", () => {
  it("keeps contiguous retries and atomically closes a Plan Item with server-derived memberships", async () => {
    const repository = new InMemoryManualExecutionRepository(seed());
    const attempts = new ManualAttemptService(repository);
    const observations = new RecordObservationService(repository);
    const results = new RecordPlanItemResultService(repository);

    const first = await attempts.start({
      sessionId: "session",
      planItemId: "item",
      actor,
      expectedSessionVersion: 1,
      at: "2026-08-30T10:00:00.000Z",
    });
    await attempts.complete({
      attemptId: first.attempt.id,
      actor,
      result: "ASSERTION_FAILED",
      expectedSessionVersion: 2,
      at: "2026-08-30T10:01:00.000Z",
    });
    await observations.record({
      sessionId: "session",
      planItemId: "item",
      attemptId: first.attempt.id,
      kind: "NEGATIVE",
      expectedOutcome: "Page is healthy",
      actualOutcome: "HTTP 500",
      severity: "HIGH",
      actor,
      expectedSessionVersion: 3,
      at: "2026-08-30T10:02:00.000Z",
    });
    const second = await attempts.start({
      sessionId: "session",
      planItemId: "item",
      actor,
      expectedSessionVersion: 4,
      at: "2026-08-30T10:03:00.000Z",
    });
    await attempts.complete({
      attemptId: second.attempt.id,
      actor,
      result: "PASS",
      expectedSessionVersion: 5,
      at: "2026-08-30T10:04:00.000Z",
    });
    await observations.record({
      sessionId: "session",
      planItemId: "item",
      attemptId: second.attempt.id,
      kind: "POSITIVE",
      expectedOutcome: "Page is healthy",
      actualOutcome: "HTTP 200",
      severity: "INFO",
      actor,
      expectedSessionVersion: 6,
      at: "2026-08-30T10:05:00.000Z",
    });
    const snapshot = repository.snapshot("item");

    await expect(
      results.record({
        sessionId: "session",
        planItemId: "item",
        result: "PASS",
        actualOutcome: "Passed on retry",
        decisionReason: "Retry passed",
        reviewFlags: ["FLAKY_SUSPECTED"],
        evidenceLinkIds: ["failed-attempt-evidence"],
        actor,
        expectedSessionVersion: 7,
        expectedMaximumAttemptNo: 2,
        expectedAttemptSetHash: snapshot.attemptSetHash,
        expectedObservationSetHash: snapshot.observationSetHash,
        at: "2026-08-30T10:06:00.000Z",
      }),
    ).rejects.toThrow("QA_FLAKY_DISPOSITION_BASIS_REQUIRED");

    const recorded = await results.record({
      sessionId: "session",
      planItemId: "item",
      result: "INCONCLUSIVE",
      actualOutcome: "Pass after assertion failure",
      decisionReason: "Requires flaky disposition",
      reviewFlags: ["FLAKY_SUSPECTED"],
      evidenceLinkIds: ["failed-attempt-evidence"],
      actor,
      expectedSessionVersion: 7,
      expectedMaximumAttemptNo: 2,
      expectedAttemptSetHash: snapshot.attemptSetHash,
      expectedObservationSetHash: snapshot.observationSetHash,
      at: "2026-08-30T10:06:00.000Z",
    });

    expect(recorded.result.consideredAttemptRefs).toHaveLength(2);
    expect(recorded.result.consideredObservationRefs).toHaveLength(2);
    expect(repository.planItem("item").state).toBe("TERMINAL");
    await expect(
      attempts.start({
        sessionId: "session",
        planItemId: "item",
        actor,
        expectedSessionVersion: 8,
        at: "2026-08-30T10:07:00.000Z",
      }),
    ).rejects.toThrow("QA_PLAN_ITEM_EXECUTION_CLOSED");
  });

  it("requires a bounded cancellation reason and never accepts caller omission", async () => {
    const repository = new InMemoryManualExecutionRepository(seed());
    const attempts = new ManualAttemptService(repository);
    const attempt = await attempts.start({
      sessionId: "session",
      planItemId: "item",
      actor,
      expectedSessionVersion: 1,
      at: "2026-08-30T10:00:00.000Z",
    });
    await expect(
      attempts.complete({
        attemptId: attempt.attempt.id,
        actor,
        result: "CANCELLED",
        expectedSessionVersion: 2,
        at: "2026-08-30T10:01:00.000Z",
      }),
    ).rejects.toThrow("QA_ATTEMPT_CANCELLATION_REASON_REQUIRED");
    await expect(
      attempts.complete({
        attemptId: attempt.attempt.id,
        actor,
        result: "PASS",
        cancellationReason: "not allowed",
        expectedSessionVersion: 2,
        at: "2026-08-30T10:01:00.000Z",
      }),
    ).rejects.toThrow("QA_ATTEMPT_CANCELLATION_REASON_FORBIDDEN");
  });
});
