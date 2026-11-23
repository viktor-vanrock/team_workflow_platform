import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CorrectSessionReviewService,
  qaAggregateSnapshotHash,
  TypeOrmEvidenceReviewRepository,
  TypeOrmReviewManualSessionService,
} from "../../packages/competency-qa/src/node.ts";
import {
  executeUs3CleanPass,
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
  type Us3DatabaseFixture,
  us3Digest,
} from "../support/002-us3-database.ts";

let fixture: Us3DatabaseFixture | undefined;
beforeAll(async () => {
  fixture = await startUs3DatabaseFixture();
}, 120_000);
afterAll(async () => await stopUs3DatabaseFixture(fixture));

describe("US3 Session review crash-window recovery", () => {
  it("commits each initial/correction aggregate entirely once or writes nothing", async () => {
    const f = fixture!;
    const execution = await executeUs3CleanPass(f);
    const reviews = new TypeOrmReviewManualSessionService(f.source);
    const initialInput = {
      workspaceId: f.workspaceId,
      projectId: f.projectId,
      workItemId: f.workItemId,
      sessionId: f.sessionId,
      expectedSessionVersion: 9,
      expectedExecutionSetHash: execution.executionSetHash,
      actor: us3Actor,
      authorizationBasisHash: us3Digest("review-auth"),
      evidencePolicyRef: { key: "qa.evidence", version: "1.0.0" },
      riskReviewPolicyRef: { id: "risk", version: 1, contentHash: us3Digest("risk") },
      outcomeSummary: "All manual checks passed.",
      at: "2026-08-30T10:06:00.000Z",
    } as const;
    await expect(
      reviews.reviewCleanPass({
        ...initialInput,
        expectedExecutionSetHash: us3Digest("stale-execution"),
      }),
    ).rejects.toThrow("QA_SESSION_EXECUTION_SET_STALE");
    expect(
      await f.source.query(
        "SELECT (SELECT count(*) FROM qa_session_reviews)::int reviews,(SELECT count(*) FROM qa_evidence_manifest_revisions)::int revisions,state FROM qa_test_sessions WHERE session_id=$1",
        [f.sessionId],
      ),
    ).toEqual([{ reviews: 0, revisions: 0, state: "REVIEW_REQUIRED" }]);
    const initial = await reviews.reviewCleanPass(initialInput);
    await expect(reviews.reviewCleanPass(initialInput)).rejects.toThrow(
      /QA_SESSION_STALE_VERSION|QA_SESSION_REVIEW_STATE_INVALID/iu,
    );
    let counts = await f.source.query(
      "SELECT (SELECT count(*) FROM qa_session_reviews)::int reviews,(SELECT count(*) FROM qa_evidence_manifest_revisions)::int revisions,(SELECT count(*) FROM event_outbox WHERE event_type='qa.test-session.reviewed')::int events,state FROM qa_test_sessions WHERE session_id=$1",
      [f.sessionId],
    );
    expect(counts).toEqual([{ reviews: 1, revisions: 1, events: 1, state: "COMPLETED" }]);

    const basis = {
      kind: "PROJECT" as const,
      policyVersion: "qa-local@1",
      membershipRef: { id: "membership", version: 1 },
      roleAssignmentRefs: [{ id: "role", version: 1 }],
      entitlementRefs: [{ id: "entitlement", version: 1 }],
      skillContext: "NOT_APPLICABLE" as const,
    };
    const correctionInput = {
      workspaceId: f.workspaceId,
      projectId: f.projectId,
      workItemId: f.workItemId,
      sessionId: f.sessionId,
      expectedManifestResourceVersion: 1,
      expectedSessionResourceVersion: 10,
      reason: "Clarify the bounded human summary",
      outcomeSummary: "All manual checks passed; summary clarified.",
      actor: us3Actor,
      authorizationBasis: basis,
      authorizationBasisHash: qaAggregateSnapshotHash(basis as never),
      evidencePolicyRef: { key: "qa.evidence", version: "1.0.0" },
      riskReviewPolicyRef: { id: "risk", version: 1 },
      at: "2026-08-30T10:07:00.000Z",
      correlationId: "correction-correlation",
      causationId: "correction-causation",
    } as const;
    const corrected = await new CorrectSessionReviewService(f.source).correct(correctionInput);
    expect(corrected).toMatchObject({ manifestResourceVersion: 2, sessionResourceVersion: 11 });
    await expect(
      new CorrectSessionReviewService(f.source).correct(correctionInput),
    ).rejects.toThrow("QA_MANIFEST_STALE_VERSION");
    counts = await f.source.query(
      "SELECT (SELECT count(*) FROM qa_session_reviews)::int reviews,(SELECT count(*) FROM qa_evidence_manifest_revisions)::int revisions,(SELECT count(*) FROM event_outbox WHERE event_type='qa.test-session.reviewed')::int events,latest_session_review_id,adjudicative_manifest_revision_id FROM qa_test_sessions WHERE session_id=$1",
      [f.sessionId],
    );
    expect(counts).toEqual([
      {
        reviews: 2,
        revisions: 2,
        events: 2,
        latest_session_review_id: corrected.sessionReview.id,
        adjudicative_manifest_revision_id: corrected.manifestRevision.manifestRevisionId,
      },
    ]);
    const repository = new TypeOrmEvidenceReviewRepository(f.source);
    const history = await repository.manifestRevisions(
      { workspaceId: f.workspaceId, projectId: f.projectId },
      initial.manifestRevision.manifestId,
    );
    expect(history[1]?.previousRevisionRef).toEqual({
      id: history[0]?.manifestRevisionId,
      version: 1,
      contentHash: history[0]?.contentHash,
    });
  });
});
