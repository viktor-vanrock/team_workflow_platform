import { randomUUID } from "node:crypto";

import { QaFindingsController } from "../../apps/api/src/extensions/qa-findings.controller.ts";
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
import { us3Actor, type Us3DatabaseFixture, us3Digest } from "./002-us3-database.ts";
import { currentManualSessionEtag } from "./008-qa-request.ts";

export async function create008GitLabArtifactReference(f: Us3DatabaseFixture) {
  const artifact = Object.freeze({
    id: randomUUID(),
    checksum: us3Digest("gitlab-artifact"),
    size_bytes: 128,
    media_type: "text/plain",
    classification_key: "INTERNAL",
  });
  await f.source.query(
    `INSERT INTO artifact_references(
    id,workspace_id,project_id,owner_entity_type,owner_entity_id,artifact_kind,storage_provider_kind,
    opaque_locator,object_version_or_etag,file_name,media_type,size_bytes,checksum_algorithm,checksum,
    classification_key,availability,created_by,created_at,expires_at
  ) VALUES($1,$2,$3,'WORK_ITEM',$4,'QA_EVIDENCE','GITLAB_CI',$5,$6,'gitlab-evidence.txt',$7,$8,'SHA256',$9,$10,'AVAILABLE',$11,$12,NULL)`,
    [
      artifact.id,
      f.workspaceId,
      f.projectId,
      f.workItemId,
      `gitlab-artifact-reference:${artifact.id}`,
      us3Digest("gitlab-descriptor"),
      artifact.media_type,
      artifact.size_bytes,
      artifact.checksum,
      artifact.classification_key,
      us3Actor.principalId,
      "2026-08-30T10:00:30.000Z",
    ],
  );
  return artifact;
}

export async function create008FrozenProductFinding(f: Us3DatabaseFixture) {
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
  if (!("resourceVersion" in reviewRequired)) throw new Error("FIXTURE_SESSION_REVIEW_NOT_READY");
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
  await new TypeOrmReviewManualSessionService(f.source).reviewWithFindings({
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
  const [frozen] = (await f.source.query(
    "SELECT f.resource_version,r.finding_review_revision_id,r.version,r.content_hash FROM qa_findings f JOIN qa_finding_review_revisions r ON r.finding_review_revision_id=f.frozen_review_revision_id WHERE f.finding_id=$1",
    [findingId],
  )) as {
    resource_version: number;
    finding_review_revision_id: string;
    version: number;
    content_hash: string;
  }[];
  if (!frozen) throw new Error("FIXTURE_FROZEN_FINDING_MISSING");
  return {
    findingId,
    resourceVersion: frozen.resource_version,
    frozenFindingReviewRef: {
      id: frozen.finding_review_revision_id,
      version: frozen.version,
      contentHash: frozen.content_hash,
    },
  };
}
