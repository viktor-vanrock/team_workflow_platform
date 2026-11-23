import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { QaSessionsController } from "../../../apps/api/src/extensions/qa-sessions.controller.ts";
import { createLocalQaSessionRuntime } from "../../../apps/api/src/local/local-qa-session-runtime.ts";
import {
  createPlanItemWaiverCandidate,
  createQaArtifactAuthorizationContribution,
  createQaPlanItemWaiverActionContribution,
  qaAggregateSnapshotHash,
  TypeOrmManualExecutionRepository,
  TypeOrmRecordPlanItemResultService,
  TypeOrmReviewManualSessionService,
} from "../../../packages/competency-qa/src/node.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
  type Us3DatabaseFixture,
  us3Digest,
} from "../../support/002-us3-database.ts";
import { currentManualSessionEtag } from "../../support/008-qa-request.ts";

const candidate = createPlanItemWaiverCandidate({
  scope: { workspaceId: "w", projectId: "p" },
  workItemId: "wi",
  sessionId: "s",
  planItemId: "pi",
  initiatorId: "executor",
  reason: "Explicitly skip an unavailable optional check",
  expiresAt: "2026-08-31T12:00:00.000Z",
});
const action = {
  id: "action",
  kind: "QA_PLAN_ITEM_WAIVER",
  candidate,
  candidateHash: qaAggregateSnapshotHash(candidate as never),
  initiatorId: "executor",
  state: "EXECUTING" as const,
  rowVersion: 2,
};
let fixture: Us3DatabaseFixture | undefined;

beforeAll(async () => {
  fixture = await startUs3DatabaseFixture();
}, 120_000);
afterAll(async () => await stopUs3DatabaseFixture(fixture));

describe("US3 effect-time human review and PLAN_ITEM waiver authorization", () => {
  it("allows only a distinct live QA Lead and rejects self/requester/service/agent/stale scope", async () => {
    const persisted: string[] = [];
    const contribution = createQaPlanItemWaiverActionContribution({
      now: () => "2026-08-30T12:00:00.000Z",
      roleFor: async (id) =>
        id === "lead" ? "QA_LEAD" : id === "executor" ? "QA_EXECUTOR" : "REQUESTER",
      persistApproved: async (_value, approval) => {
        persisted.push(approval.approverId);
        return { waiverId: "waiver", contentHash: "sha256:waiver" };
      },
    });
    const context = (approverId: string, workspaceId = "w") => ({
      workspaceId,
      projectId: "p",
      approvalId: "approval",
      approverId,
      authorizationBasisHash: "sha256:basis",
    });
    await expect(contribution.execute(action, context("executor"))).rejects.toThrow(
      "QA_PLAN_ITEM_WAIVER_DISTINCT_LEAD_REQUIRED",
    );
    for (const principal of ["requester", "service", "agent"])
      await expect(contribution.execute(action, context(principal))).rejects.toThrow(
        "QA_PLAN_ITEM_WAIVER_LEAD_REQUIRED",
      );
    await expect(contribution.execute(action, context("lead", "other"))).rejects.toThrow(
      "QA_PLAN_ITEM_WAIVER_SCOPE_MISMATCH",
    );
    await expect(contribution.execute(action, context("lead"))).resolves.toEqual({
      waiverId: "waiver",
      contentHash: "sha256:waiver",
    });
    expect(persisted).toEqual(["lead"]);
    const expired = createQaPlanItemWaiverActionContribution({
      now: () => "2026-09-01T00:00:00.000Z",
      roleFor: async () => "QA_LEAD",
      persistApproved: async () => ({ waiverId: "never", contentHash: "never" }),
    });
    await expect(expired.execute(action, context("lead"))).rejects.toThrow(
      "QA_PLAN_ITEM_WAIVER_EXPIRED",
    );
  });

  it("enforces HUMAN exact-project evidence access at effect time", async () => {
    let storageCalls = 0;
    const policy = createQaArtifactAuthorizationContribution({
      liveAuthorization: async ({ artifact }) => {
        storageCalls += 1;
        return artifact.classification.rank <= 2;
      },
    });
    const artifact = {
      workspaceId: "w",
      projectId: "p",
      artifactKind: "QA_EVIDENCE",
      classification: { key: "INTERNAL", rank: 2 },
    };
    const request = (
      actor: Readonly<{ kind: "HUMAN" | "SERVICE"; principalId: string }>,
      scope: Readonly<{ kind: "PROJECT"; workspaceId: string; projectId: string }>,
    ) => ({ context: { actor, scope }, artifact, operation: "STREAM_CONTENT" as const });
    await expect(
      policy.authorize(
        request(
          { kind: "SERVICE", principalId: "service" },
          { kind: "PROJECT", workspaceId: "w", projectId: "p" },
        ),
      ),
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      policy.authorize(
        request(
          { kind: "HUMAN", principalId: "executor" },
          { kind: "PROJECT", workspaceId: "w", projectId: "other" },
        ),
      ),
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      policy.authorize(
        request(
          { kind: "HUMAN", principalId: "executor" },
          { kind: "PROJECT", workspaceId: "w", projectId: "p" },
        ),
      ),
    ).resolves.toEqual({ allowed: true, reason: "ALLOW" });
    expect(storageCalls).toBe(1);
  });

  it("rolls back review when an accepted PLAN_ITEM waiver expires before signing", async () => {
    const f = fixture!;
    const waiverId = "waiver-plan-item-us3";
    const waiverHash = us3Digest("plan-item-waiver");
    await f.source.query(
      "INSERT INTO qa_waivers(waiver_id,workspace_id,project_id,work_item_id,waiver_kind,state,subject_hash,content_hash,content,expires_at,row_version) VALUES($1,$2,$3,$4,'PLAN_ITEM','APPROVED',$5,$6,$7,$8,1)",
      [
        waiverId,
        f.workspaceId,
        f.projectId,
        f.workItemId,
        us3Digest("waiver-subject"),
        waiverHash,
        JSON.stringify({ sessionId: f.sessionId, planItemId: f.planItemId, approverId: "lead" }),
        "2026-08-30T10:30:00.000Z",
      ],
    );
    const snapshot = await new TypeOrmManualExecutionRepository(f.source).snapshot(
      { workspaceId: f.workspaceId, projectId: f.projectId },
      f.planItemId,
    );
    await new TypeOrmRecordPlanItemResultService(f.source).record({
      workspaceId: f.workspaceId,
      projectId: f.projectId,
      sessionId: f.sessionId,
      planItemId: f.planItemId,
      result: "NOT_RUN",
      actualOutcome: "Check explicitly waived",
      decisionReason: "Approved optional-check waiver",
      reviewFlags: [],
      evidenceLinkIds: [],
      waiverRef: { id: waiverId, contentHash: waiverHash },
      actor: us3Actor,
      expectedSessionVersion: 4,
      expectedMaximumAttemptNo: 0,
      expectedAttemptSetHash: snapshot.attemptSetHash,
      expectedObservationSetHash: snapshot.observationSetHash,
      at: "2026-08-30T10:10:00.000Z",
    });
    await new QaSessionsController(f.source, createLocalQaSessionRuntime()).transition(
      f.request as never,
      f.workspaceId,
      f.projectId,
      f.workItemId,
      f.sessionId,
      await currentManualSessionEtag(f.source, f, f.sessionId),
      { requestedState: "REVIEW_REQUIRED" },
      f.response,
    );
    await f.source.query(
      "UPDATE qa_waivers SET state='EXPIRED',row_version=row_version+1 WHERE waiver_id=$1",
      [waiverId],
    );
    await expect(
      new TypeOrmReviewManualSessionService(f.source).reviewCleanPass({
        workspaceId: f.workspaceId,
        projectId: f.projectId,
        workItemId: f.workItemId,
        sessionId: f.sessionId,
        expectedSessionVersion: 6,
        expectedExecutionSetHash: qaAggregateSnapshotHash([] as never),
        actor: us3Actor,
        authorizationBasisHash: us3Digest("review-auth"),
        evidencePolicyRef: { key: "qa.evidence", version: "1.0.0" },
        riskReviewPolicyRef: { id: "risk", version: 1 },
        outcomeSummary: "Waived check reviewed",
        at: "2026-08-30T11:00:00.000Z",
      }),
    ).rejects.toThrow("QA_PLAN_ITEM_WAIVER_NOT_LIVE");
    expect(
      await f.source.query(
        "SELECT state,(SELECT count(*) FROM qa_session_reviews)::int reviews,(SELECT count(*) FROM qa_evidence_manifest_revisions)::int manifests FROM qa_test_sessions WHERE session_id=$1",
        [f.sessionId],
      ),
    ).toEqual([{ state: "REVIEW_REQUIRED", reviews: 0, manifests: 0 }]);
  });
});
