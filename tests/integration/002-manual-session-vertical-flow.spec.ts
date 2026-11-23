import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { QaSessionsController } from "../../apps/api/src/extensions/qa-sessions.controller.ts";
import { createLocalQaSessionRuntime } from "../../apps/api/src/local/local-qa-session-runtime.ts";
import {
  qaAggregateSnapshotHash,
  TypeOrmEvidenceReviewRepository,
  TypeOrmManualAttemptService,
  TypeOrmManualExecutionRepository,
  TypeOrmRecordObservationService,
  TypeOrmRecordPlanItemResultService,
  TypeOrmReviewManualSessionService,
} from "../../packages/competency-qa/src/node.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
  type Us3DatabaseFixture,
  us3Digest,
} from "../support/002-us3-database.ts";
import { currentManualSessionEtag } from "../support/008-qa-request.ts";

let fixture: Us3DatabaseFixture | undefined;

beforeAll(async () => {
  fixture = await startUs3DatabaseFixture();
}, 120_000);
afterAll(async () => await stopUs3DatabaseFixture(fixture));

describe("US3 accepted request to completed clean-PASS manual Session", () => {
  it("freezes server-derived Attempt/Observation memberships and a signed human review", async () => {
    const f = fixture!;
    const attempts = new TypeOrmManualAttemptService(f.source);
    const execution = new TypeOrmManualExecutionRepository(f.source);
    const started = await attempts.start({
      workspaceId: f.workspaceId,
      projectId: f.projectId,
      sessionId: f.sessionId,
      planItemId: f.planItemId,
      actor: us3Actor,
      expectedSessionVersion: 4,
      at: "2026-08-30T10:01:00.000Z",
    });
    expect(started.sessionResourceVersion).toBe(5);
    const completed = await attempts.complete({
      workspaceId: f.workspaceId,
      projectId: f.projectId,
      attemptId: started.attempt.id,
      actor: us3Actor,
      result: "PASS",
      expectedSessionVersion: 5,
      at: "2026-08-30T10:02:00.000Z",
    });
    expect(completed.sessionResourceVersion).toBe(6);
    const observation = await new TypeOrmRecordObservationService(f.source).record({
      workspaceId: f.workspaceId,
      projectId: f.projectId,
      sessionId: f.sessionId,
      planItemId: f.planItemId,
      attemptId: started.attempt.id,
      kind: "POSITIVE",
      expectedOutcome: "Expected outcome observed",
      actualOutcome: "Expected outcome observed",
      severity: "INFO",
      actor: us3Actor,
      expectedSessionVersion: 6,
      at: "2026-08-30T10:03:00.000Z",
    });
    expect(observation.sessionResourceVersion).toBe(7);
    const snapshot = await execution.snapshot(
      { workspaceId: f.workspaceId, projectId: f.projectId },
      f.planItemId,
    );
    const recorded = await new TypeOrmRecordPlanItemResultService(f.source).record({
      workspaceId: f.workspaceId,
      projectId: f.projectId,
      sessionId: f.sessionId,
      planItemId: f.planItemId,
      result: "PASS",
      actualOutcome: "Expected outcome observed",
      decisionReason: "Exact expected result observed",
      reviewFlags: [],
      evidenceLinkIds: [],
      actor: us3Actor,
      expectedSessionVersion: 7,
      expectedMaximumAttemptNo: snapshot.maximumAttemptNo,
      expectedAttemptSetHash: snapshot.attemptSetHash,
      expectedObservationSetHash: snapshot.observationSetHash,
      at: "2026-08-30T10:04:00.000Z",
    });
    expect(recorded.result.consideredAttemptRefs).toEqual([
      { id: started.attempt.id, contentHash: completed.attempt.contentHash },
    ]);
    expect(recorded.result.consideredObservationRefs).toEqual([
      { id: observation.observation.id, contentHash: observation.observation.contentHash },
    ]);
    await expect(
      attempts.start({
        workspaceId: f.workspaceId,
        projectId: f.projectId,
        sessionId: f.sessionId,
        planItemId: f.planItemId,
        actor: us3Actor,
        expectedSessionVersion: 8,
        at: "2026-08-30T10:05:00.000Z",
      }),
    ).rejects.toThrow("QA_PLAN_ITEM_EXECUTION_CLOSED");

    const controller = new QaSessionsController(f.source, createLocalQaSessionRuntime());
    const reviewRequired = await controller.transition(
      f.request as never,
      f.workspaceId,
      f.projectId,
      f.workItemId,
      f.sessionId,
      await currentManualSessionEtag(f.source, f, f.sessionId),
      { requestedState: "REVIEW_REQUIRED" },
      f.response,
    );
    expect(reviewRequired).toMatchObject({ state: "REVIEW_REQUIRED", resourceVersion: 9 });
    const executionSetHash = qaAggregateSnapshotHash([
      { id: completed.attempt.id, contentHash: completed.attempt.contentHash },
    ] as never);
    const reviewed = await new TypeOrmReviewManualSessionService(f.source).reviewCleanPass({
      workspaceId: f.workspaceId,
      projectId: f.projectId,
      workItemId: f.workItemId,
      sessionId: f.sessionId,
      expectedSessionVersion: 9,
      expectedExecutionSetHash: executionSetHash,
      actor: us3Actor,
      authorizationBasisHash: us3Digest("review-auth"),
      evidencePolicyRef: { key: "qa.evidence", version: "1.0.0" },
      riskReviewPolicyRef: { id: "risk", version: 1, contentHash: us3Digest("risk") },
      outcomeSummary: "All manual checks passed with exact expected outcomes.",
      at: "2026-08-30T10:06:00.000Z",
    });
    expect(reviewed.session).toMatchObject({
      state: "COMPLETED",
      sessionOutcome: "PASSED",
      resourceVersion: 10,
    });
    expect(reviewed.manifestRevision).toMatchObject({
      kind: "INITIAL",
      version: 1,
      resultRevisions: [expect.objectContaining({ resultRevisionId: recorded.result.id })],
      attempts: [expect.objectContaining({ attemptId: started.attempt.id })],
      observations: [expect.objectContaining({ observationId: observation.observation.id })],
      frozenFindingReviews: [],
    });
    const persisted = new TypeOrmEvidenceReviewRepository(f.source);
    expect(
      await persisted.sessionReviews(
        { workspaceId: f.workspaceId, projectId: f.projectId },
        f.sessionId,
      ),
    ).toHaveLength(1);
    expect(
      await persisted.manifestRevisions(
        { workspaceId: f.workspaceId, projectId: f.projectId },
        reviewed.manifestRevision.manifestId,
      ),
    ).toHaveLength(1);
    expect(
      await f.source.query(
        "SELECT to_regclass('qa_findings') AS findings,to_regclass('qa_defect_links') AS defects",
      ),
    ).toEqual([{ findings: "qa_findings", defects: "qa_defect_links" }]);
  });
});
