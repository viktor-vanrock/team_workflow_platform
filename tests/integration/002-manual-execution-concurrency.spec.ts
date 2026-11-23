import { describe, expect, it } from "vitest";

import {
  InMemoryManualExecutionRepository,
  ManualAttemptService,
  type ManualExecutionSeed,
  RecordObservationService,
} from "../../packages/competency-qa/src/node.ts";

const digest = (value: string) => `sha256:${value.padEnd(64, "0").slice(0, 64)}` as const;
const actor = {
  kind: "HUMAN" as const,
  principalId: "executor",
  issuer: "fake",
  subject: "executor",
};
const seed: ManualExecutionSeed = {
  scope: { workspaceId: "w", projectId: "p" },
  workItemId: "wi",
  sessionId: "s",
  sessionState: "RUNNING",
  sessionResourceVersion: 1,
  targetSnapshotHash: digest("target"),
  planItems: [{ planItemId: "pi", expectedOutcome: "ok" }],
};

describe("US3 execution aggregate serialization", () => {
  it("allows one concurrent correction winner and rejects the stale branch", async () => {
    const repository = new InMemoryManualExecutionRepository(seed);
    const attempts = new ManualAttemptService(repository);
    const observations = new RecordObservationService(repository);
    const started = await attempts.start({
      sessionId: "s",
      planItemId: "pi",
      actor,
      expectedSessionVersion: 1,
      at: "2026-08-30T10:00:00.000Z",
    });
    await attempts.complete({
      attemptId: started.attempt.id,
      actor,
      result: "PASS",
      expectedSessionVersion: 2,
      at: "2026-08-30T10:01:00.000Z",
    });
    const initial = await observations.record({
      sessionId: "s",
      planItemId: "pi",
      attemptId: started.attempt.id,
      kind: "POSITIVE",
      expectedOutcome: "ok",
      actualOutcome: "ok",
      severity: "INFO",
      actor,
      expectedSessionVersion: 3,
      at: "2026-08-30T10:02:00.000Z",
    });
    const command = {
      sessionId: "s",
      planItemId: "pi",
      attemptId: started.attempt.id,
      kind: "POSITIVE" as const,
      expectedOutcome: "ok",
      actualOutcome: "corrected",
      severity: "INFO" as const,
      actor,
      expectedSessionVersion: 4,
      correctsObservationRef: {
        id: initial.observation.id,
        contentHash: initial.observation.contentHash,
      },
      correctionReason: "Clarify actual result",
      at: "2026-08-30T10:03:00.000Z",
    };
    const settled = await Promise.allSettled([
      observations.record(command),
      observations.record(command),
    ]);
    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(settled.filter(({ status }) => status === "rejected")).toHaveLength(1);
  });
});
