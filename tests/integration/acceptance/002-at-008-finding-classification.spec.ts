import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { QaDefectsController } from "../../../apps/api/src/extensions/qa-defects.controller.ts";
import { QaFindingsController } from "../../../apps/api/src/extensions/qa-findings.controller.ts";
import { QaSessionsController } from "../../../apps/api/src/extensions/qa-sessions.controller.ts";
import { createLocalQaDefectApproval } from "../../../apps/api/src/local/local-qa-defect-approval.ts";
import { createLocalQaDefectPublication } from "../../../apps/api/src/local/local-qa-defect-publication.ts";
import { createLocalQaSessionRuntime } from "../../../apps/api/src/local/local-qa-session-runtime.ts";
import {
  qaAggregateSnapshotHash,
  TypeOrmEvidenceReviewRepository,
  TypeOrmManualAttemptService,
  TypeOrmManualExecutionRepository,
  TypeOrmRecordObservationService,
  TypeOrmRecordPlanItemResultService,
  TypeOrmReviewManualSessionService,
} from "../../../packages/competency-qa/src/node.ts";
import { qaUs4OperationalDefectRoute } from "../../../packages/runtime-composition/src/qa/operational-composition.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
  type Us3DatabaseFixture,
  us3Digest,
} from "../../support/002-us3-database.ts";
import { createFrozenFinding } from "../../support/002-us4-fixtures.ts";
import { create008GitLabArtifactReference } from "../../support/008-frozen-finding.ts";
import { currentManualSessionEtag, localQaTestRequest } from "../../support/008-qa-request.ts";

describe("AT-008 exact Finding review inventory", () => {
  it("invalidates a disposed decision on assignment and requires a fresh exact review before freeze", () => {
    const finding = createFrozenFinding({
      classification: "PRODUCT",
      disposition: "CREATE_DEFECT",
      freeze: false,
    });
    const oldReview = finding.currentReview!;
    finding.assign({
      membershipId: "membership-2",
      observation: {
        observationId: "observation-2",
        sessionId: finding.sessionId,
        kind: "AMBIGUOUS",
        affectedTargetHash: oldReview.affectedTargetHash,
        evidenceRefs: [{ id: "artifact-2", version: "1", contentHash: `sha256:${"e".repeat(64)}` }],
      },
      actor: finding.createdBy,
      at: "2026-08-30T12:00:00.000Z",
    });
    expect(finding.state).toBe("DRAFT");
    expect(finding.currentReview).toBeUndefined();
    expect(finding.reviews).toContain(oldReview);
    expect(() => finding.freeze("2026-08-30T12:01:00.000Z")).toThrow(
      "QA_FINDING_DISPOSITION_REQUIRED",
    );
  });

  it("freezes the complete ordered current membership set once", () => {
    const finding = createFrozenFinding({
      classification: "PRODUCT",
      disposition: "CREATE_DEFECT",
    });
    expect(finding.currentReview).toMatchObject({
      stage: "FROZEN",
      observationMembershipIds: ["membership-1"],
    });
    expect(() => finding.freeze("2026-08-30T12:01:00.000Z")).toThrow(
      "QA_FINDING_DISPOSITION_REQUIRED",
    );
  });
});

describe("AT-008 PostgreSQL negative review transaction", () => {
  let fixture: Us3DatabaseFixture | undefined;
  beforeAll(async () => {
    fixture = await startUs3DatabaseFixture();
  }, 120_000);
  afterAll(async () => await stopUs3DatabaseFixture(fixture));

  it("covers the current failed Attempt with a disposed Finding and freezes it in the single SessionReviewed event", async () => {
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
    const completed = await attempts.complete({
      workspaceId: f.workspaceId,
      projectId: f.projectId,
      attemptId: started.attempt.id,
      actor: us3Actor,
      result: "ASSERTION_FAILED",
      expectedSessionVersion: 5,
      at: "2026-08-30T10:02:00.000Z",
    });
    const observed = await new TypeOrmRecordObservationService(f.source).record({
      workspaceId: f.workspaceId,
      projectId: f.projectId,
      sessionId: f.sessionId,
      planItemId: f.planItemId,
      attemptId: started.attempt.id,
      kind: "NEGATIVE",
      expectedOutcome: "Expected outcome observed",
      actualOutcome: "Acceptance assertion failed",
      severity: "HIGH",
      actor: us3Actor,
      expectedSessionVersion: 6,
      at: "2026-08-30T10:03:00.000Z",
    });
    const artifact = await create008GitLabArtifactReference(f);
    const evidence = new TypeOrmEvidenceReviewRepository(f.source);
    const attemptEvidenceId = randomUUID();
    const observationEvidenceId = randomUUID();
    for (const [evidenceLinkId, owner] of [
      [attemptEvidenceId, { ownerType: "ATTEMPT" as const, ownerId: started.attempt.id }],
      [
        observationEvidenceId,
        { ownerType: "OBSERVATION" as const, ownerId: observed.observation.id },
      ],
    ] as const) {
      await evidence.attach({
        scope: { workspaceId: f.workspaceId, projectId: f.projectId },
        workItemId: f.workItemId,
        sessionId: f.sessionId,
        evidenceLinkId,
        artifactReferenceId: artifact.id,
        owner,
        checksum: artifact.checksum,
        sizeBytes: artifact.size_bytes,
        mediaType: artifact.media_type,
        classificationKey: artifact.classification_key,
        actorId: us3Actor.principalId,
        at: "2026-08-30T10:03:30.000Z",
      });
    }
    const snapshot = await execution.snapshot(
      { workspaceId: f.workspaceId, projectId: f.projectId },
      f.planItemId,
    );
    await new TypeOrmRecordPlanItemResultService(f.source).record({
      workspaceId: f.workspaceId,
      projectId: f.projectId,
      sessionId: f.sessionId,
      planItemId: f.planItemId,
      result: "FAIL",
      actualOutcome: "Acceptance assertion failed",
      decisionReason: "Exact failed Attempt and negative Observation",
      reviewFlags: [],
      evidenceLinkIds: [attemptEvidenceId, observationEvidenceId],
      actor: us3Actor,
      expectedSessionVersion: observed.sessionResourceVersion,
      expectedMaximumAttemptNo: snapshot.maximumAttemptNo,
      expectedAttemptSetHash: snapshot.attemptSetHash,
      expectedObservationSetHash: snapshot.observationSetHash,
      at: "2026-08-30T10:04:00.000Z",
    });
    const reviewRequired = await new QaSessionsController(
      f.source,
      createLocalQaSessionRuntime(),
    ).transition(
      f.request as never,
      f.workspaceId,
      f.projectId,
      f.workItemId,
      f.sessionId,
      await currentManualSessionEtag(f.source, f, f.sessionId),
      { requestedState: "REVIEW_REQUIRED" },
      f.response,
    );
    assert(
      "sessionId" in reviewRequired,
      "Expected a persisted manual session, received admission denial",
    );
    const controller = new QaFindingsController(f.source);
    const created = await controller.create(
      f.request as never,
      f.workspaceId,
      f.projectId,
      f.workItemId,
      `W/"${reviewRequired.resourceVersion}"`,
      {
        sessionId: f.sessionId,
        observationIds: [observed.observation.id],
        severity: "HIGH",
        summary: "Acceptance assertion failed",
      },
      f.response,
    );
    const findingId = String(created.findingId);
    const membership = await controller.memberships(
      f.request as never,
      f.workspaceId,
      f.projectId,
      findingId,
      f.response,
    );
    const classified = await controller.classify(
      f.request as never,
      f.workspaceId,
      f.projectId,
      f.workItemId,
      findingId,
      `W/"${created.resourceVersion}"`,
      {
        classification: "PRODUCT",
        reason: "Reproduced against the frozen target",
        expectedCurrentReviewRef: null,
        expectedMembershipSetHash: membership.activeMembershipSetHash,
      },
      f.response,
    );
    await controller.dispose(
      f.request as never,
      f.workspaceId,
      f.projectId,
      f.workItemId,
      findingId,
      `W/"${classified.finding.resourceVersion}"`,
      {
        dispositionDecision: "CREATE_DEFECT",
        dispositionReason: "Publish one exact product defect",
        expectedReviewContentHash: classified.reviewRevision.contentHash,
        expectedMembershipSetHash: membership.activeMembershipSetHash,
      },
      f.response,
    );
    const executionSetHash = qaAggregateSnapshotHash([
      { id: completed.attempt.id, contentHash: completed.attempt.contentHash },
    ] as never);
    const reviewed = await new TypeOrmReviewManualSessionService(f.source).reviewWithFindings({
      workspaceId: f.workspaceId,
      projectId: f.projectId,
      workItemId: f.workItemId,
      sessionId: f.sessionId,
      expectedSessionVersion: reviewRequired.resourceVersion,
      expectedExecutionSetHash: executionSetHash,
      sessionOutcome: "FAILED",
      actor: us3Actor,
      authorizationBasisHash: us3Digest("review-auth"),
      evidencePolicyRef: { key: "qa.evidence", version: "1.0.0" },
      riskReviewPolicyRef: { id: "risk", version: 1, contentHash: us3Digest("risk") },
      outcomeSummary: "Manual validation failed with a frozen product Finding.",
      at: "2026-08-30T10:06:00.000Z",
    });
    expect(reviewed.session).toMatchObject({ state: "COMPLETED", sessionOutcome: "FAILED" });
    expect(reviewed.manifestRevision.frozenFindingReviews).toEqual([
      expect.objectContaining({ findingId }),
    ]);
    const events = (await f.source.query(
      "SELECT envelope FROM event_outbox WHERE workspace_id=$1 AND project_id=$2 AND event_type='qa.test-session.reviewed'",
      [f.workspaceId, f.projectId],
    )) as readonly { envelope: Readonly<{ frozenFindingReviewRefs: readonly unknown[] }> }[];
    expect(events).toHaveLength(1);
    expect(events[0]!.envelope.frozenFindingReviewRefs).toHaveLength(1);
    const frozenRows = (await f.source.query(
      "SELECT resource_version FROM qa_findings WHERE finding_id=$1",
      [findingId],
    )) as readonly { resource_version: number }[];
    const invoke = vi.fn(
      async (
        context: Readonly<{ effectIdempotencyKey: string }>,
        target: Readonly<{ naturalKey?: string }>,
      ) => ({
        operation: "defect.create" as const,
        entityKind: "DEFECT" as const,
        externalEntityId: "DEF-AT008",
        externalDisplayKey: "DEF-AT008",
        externalVersion: "1",
        rawExternalState: "MOCK_NEW",
        normalizedStatus: "NEW" as const,
        naturalKey: target.naturalKey!,
        effectId: context.effectIdempotencyKey,
        observedAt: "2026-08-30T10:07:00.000Z",
      }),
    );
    const defects = new QaDefectsController(
      f.source,
      createLocalQaDefectPublication(f.source),
      createLocalQaDefectApproval(f.source, createLocalQaDefectPublication(f.source), {
        [qaUs4OperationalDefectRoute]: { invoke, readByEffect: async () => undefined },
      } as never),
    );
    const draft = await defects.create(
      f.request as never,
      f.workspaceId,
      f.projectId,
      f.workItemId,
      findingId,
      `W/"${frozenRows[0]!.resource_version}"`,
      { source: "DETERMINISTIC_TEMPLATE" },
      f.response,
    );
    const publication = await defects.publish(
      f.request as never,
      f.workspaceId,
      f.projectId,
      f.workItemId,
      draft.defectDraftId,
      'W/"1"',
      { expectedResourceVersion: 1 },
      f.response,
    );
    expect(publication).toMatchObject({
      state: "AWAITING_APPROVAL",
      defectDraftId: draft.defectDraftId,
    });
    expect(invoke).not.toHaveBeenCalled();
    const linked = await defects.approve(
      await localQaTestRequest(f.source, "lead.alpha"),
      f.workspaceId,
      f.projectId,
      f.workItemId,
      publication.approvalId,
    );
    expect(linked).toMatchObject({ state: "LINKED", defectDraftId: draft.defectDraftId });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(
      await defects.links(f.request as never, f.workspaceId, f.projectId, f.workItemId),
    ).toEqual([
      expect.objectContaining({
        findingId,
        externalDisplayKey: "DEF-AT008",
        normalizedStatus: "NEW",
      }),
    ]);
  }, 120_000);
});
