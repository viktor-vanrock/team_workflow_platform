import { QaSessionsController } from "../../apps/api/src/extensions/qa-sessions.controller.ts";
import { createLocalQaSessionRuntime } from "../../apps/api/src/local/local-qa-session-runtime.ts";
import {
  qaAggregateSnapshotHash,
  type QaRequestExtension,
  type QaRequestInputRevision,
  QaTypeOrmIntakeConfirmationWriter,
  TypeOrmManualAttemptService,
  TypeOrmManualExecutionRepository,
  TypeOrmManualSessionRepository,
  TypeOrmRecordObservationService,
  TypeOrmRecordPlanItemResultService,
  TypeOrmReviewManualSessionService,
} from "../../packages/competency-qa/src/node.ts";
import { createPlatformDataSource } from "../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../packages/platform-testkit/src/postgres.ts";
import { strongSessionEtag } from "../../packages/runtime-composition/src/index.ts";
import {
  qaLocalEntities,
  qaLocalMigrations,
} from "../../packages/runtime-composition/src/qa/composition.ts";
import {
  localPersonaIds,
  localSeedIds,
} from "../../packages/runtime-composition/src/seed/local-seed.ts";
import {
  qaLocalSeedIds,
  runQaLocalSeed,
} from "../../packages/runtime-composition/src/seed/qa-local-seed.ts";
import { POSTGRES_TEST_IMAGES } from "../testcontainers.config.ts";
import { bootstrapLegacyQaFixtureProjects, localQaTestRequest } from "./008-qa-request.ts";

export const us3Digest = (value: string) => `sha256:${value.padEnd(64, "0").slice(0, 64)}` as const;
export const us3Actor = {
  kind: "HUMAN" as const,
  principalId: localPersonaIds["executor.alpha"],
  issuer: "https://fake-idp:4443/oidc",
  subject: "executor.alpha",
};

export interface Us3DatabaseFixture {
  readonly postgres: RunningPostgres;
  readonly source: ReturnType<typeof createPlatformDataSource>;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly planItemId: string;
  readonly sessionVersion: number;
  readonly targetSnapshotHash: `sha256:${string}`;
  readonly request: Readonly<{ localPersonaKey: string }>;
  readonly response: Readonly<{
    setHeader(name: string, value: string): void;
    status(code: number): Us3DatabaseFixture["response"];
  }>;
}

export async function startUs3DatabaseFixture(
  options: Readonly<{
    postgresImage?: string;
    requestRisk?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    entities?: Parameters<typeof createPlatformDataSource>[0]["entities"];
    migrations?: Parameters<typeof createPlatformDataSource>[0]["migrations"];
  }> = {},
): Promise<Us3DatabaseFixture> {
  const postgres = await startPostgres(options.postgresImage ?? POSTGRES_TEST_IMAGES[0]!);
  const source = createPlatformDataSource({
    url: postgres.url,
    entities: options.entities ?? qaLocalEntities,
    migrations: options.migrations ?? qaLocalMigrations,
  });
  await source.initialize();
  await source.runMigrations({ transaction: "all" });
  await runQaLocalSeed(source);
  await bootstrapLegacyQaFixtureProjects(source);
  Object.assign(process.env, {
    AWP_RUNTIME_PROFILE: "test",
    AWP_COMPOSITION: "qa-local",
    AWP_EXTERNAL_NETWORK_MODE: "deny",
    AWP_IDENTITY_ISSUER: "https://fake-idp:4443/oidc",
    AWP_MOCK_HUB_URL: "http://127.0.0.1:1",
    AWP_QUEUE_STATIC_CONTOUR: "false",
  });

  const workspaceId = localSeedIds.workspaceFunctional;
  const projectId = localSeedIds.alpha;
  const workItemId = localSeedIds.workItem;
  const inputId = "c2100000-0000-4000-8000-000000000001";
  const extensionId = "c3100000-0000-4000-8000-000000000001";
  const assessmentId = "c4100000-0000-4000-8000-000000000001";
  const planId = "c5100000-0000-4000-8000-000000000001";
  const planVersionId = "c6100000-0000-4000-8000-000000000001";
  const requirementId = "c7100000-0000-4000-8000-000000000001";
  const at = "2026-08-30T10:00:00.000Z";
  const input: QaRequestInputRevision = {
    ...(options.requestRisk ? { requestRisk: options.requestRisk } : {}),
    schemaVersion: 1,
    inputRevisionId: inputId,
    version: 1,
    previousRevisionRef: null,
    workspaceId,
    projectId,
    workItemId,
    definitionRef: { key: "qa.validation", version: "1.0.0" },
    acceptedDraftRef: {
      kind: "intake-draft",
      id: "draft",
      version: "1",
      contentHash: us3Digest("draft"),
    },
    externalRequestRef: {
      kind: "request",
      id: "REQ-us3",
      version: "2",
      contentHash: us3Digest("external"),
    },
    operationalBindingRef: { id: qaLocalSeedIds.alphaBinding, version: 2 },
    originalRequesterRef: us3Actor,
    title: "US3 execution fixture",
    requestKind: "feature-validation",
    goal: "Validate clean PASS",
    scope: "Manual scope",
    acceptanceOutcome: "Expected outcome observed",
    blockersDeclared: true,
    blockers: [],
    dependenciesDeclared: true,
    dependencies: [],
    requestedTarget: {
      environmentId: qaLocalSeedIds.environment,
      environmentRevision: 1,
      buildRef: { kind: "build", id: "build", version: "1", contentHash: us3Digest("build") },
      testDataRef: { kind: "test-data", id: "data", version: "1", contentHash: us3Digest("data") },
    },
    dataClassificationKey: "INTERNAL",
    responseChannelResolution: {
      state: "MISSING",
      requesterPrincipal: us3Actor,
      resolutionPolicyRef: { key: "response", version: "1", contentHash: us3Digest("response") },
      evaluatedAt: at,
      missingReasonCode: "NOT_NEEDED_FOR_US3",
    },
    readyEffectGuard: { observedState: "NONE", expectedAggregateVersion: 1 },
    invalidatedState: { readinessAssessmentRefs: [], waiverRefs: [], pendingReadyCommandRefs: [] },
    changeReasonCode: "INITIAL_CONFIRMED_DRAFT",
    contentHash: us3Digest("input"),
    recordedBy: us3Actor,
    authorizationBasisHash: us3Digest("auth"),
    recordedAt: at,
    correlationId: "c8100000-0000-4000-8000-000000000001",
  };
  const extension: QaRequestExtension = {
    schemaVersion: 1,
    extensionId,
    workspaceId,
    projectId,
    workItemId,
    definitionRef: input.definitionRef,
    currentRequestInputRevisionRef: { id: inputId, version: 1, contentHash: input.contentHash },
    projectContextRef: {
      id: qaLocalSeedIds.context,
      version: 1,
      contentHash: us3Digest("context"),
    },
    dorRuleSetRef: { key: "qa.dor", version: "1.0.0", contentHash: us3Digest("dor") },
    dodRuleSetRef: { key: "qa.dod", version: "1.0.0", contentHash: us3Digest("dod") },
    evidencePolicyRef: { key: "qa.evidence", version: "1.0.0", contentHash: us3Digest("evidence") },
    riskReviewPolicyRef: {
      id: qaLocalSeedIds.riskPolicy,
      version: 1,
      contentHash: us3Digest("risk"),
    },
    adjudicativeAggregateHash: us3Digest("aggregate"),
    completionDispatchGuard: { state: "OPEN" },
    resourceVersion: 1,
    contentHash: us3Digest("extension"),
    createdBy: us3Actor,
    createdAt: at,
    updatedAt: at,
    correlationId: input.correlationId,
  };
  await source.transaction(
    async (manager) =>
      await new QaTypeOrmIntakeConfirmationWriter().persist(
        {
          transactionId: "us3-fixture",
          native: manager,
          contributionKey: "qa.request-create.confirmation",
          idempotencyKey: "us3-fixture",
        },
        { extension, initialInput: input },
      ),
  );
  const requirement = {
    id: requirementId,
    ordinal: 1,
    requirementKey: "primary",
    mode: "MANUAL" as const,
    purpose: "feature-validation",
    minimumSessionCount: 1,
    requiredCapabilities: ["manual"],
    targetPolicyRef: {
      kind: "target-policy",
      id: "target",
      version: "1",
      contentHash: us3Digest("target"),
    },
    scopePolicyRef: {
      kind: "scope-policy",
      id: "scope",
      version: "1",
      contentHash: us3Digest("scope"),
    },
    checklistPolicyRefs: [
      { kind: "checklist", id: "check", version: "1", contentHash: us3Digest("check") },
    ],
    resolution: "REQUIRED" as const,
    contentHash: us3Digest("requirement"),
    carriedForwardFromRequirementRef: null,
  };
  const plan = {
    id: planVersionId,
    version: 1,
    previousRevisionRef: null,
    workspaceId,
    projectId,
    workItemId,
    readinessProofRef: { id: assessmentId, version: 1, contentHash: us3Digest("ready") },
    requirements: [requirement],
    reason: "Initial plan",
    publishedBy: us3Actor,
    publishedAt: at,
    contentHash: us3Digest("plan"),
  };
  await source.transaction(async (manager) => {
    await manager.query(
      "INSERT INTO qa_readiness_assessments(assessment_id,workspace_id,project_id,work_item_id,input_revision_id,input_revision_version,input_content_hash,extension_resource_version,assessment_version,state,input_fingerprint,content_hash,content,evaluated_at) VALUES($1,$2,$3,$4,$5,1,$6,1,1,'READY',$7,$8,$9,$10)",
      [
        assessmentId,
        workspaceId,
        projectId,
        workItemId,
        inputId,
        input.contentHash,
        us3Digest("fingerprint"),
        us3Digest("ready"),
        JSON.stringify({ state: "READY" }),
        at,
      ],
    );
    await manager.query(
      "INSERT INTO qa_required_session_plans(plan_id,workspace_id,project_id,work_item_id,extension_id,resource_version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,1,$6,$6)",
      [planId, workspaceId, projectId, workItemId, extensionId, at],
    );
    await manager.query(
      "INSERT INTO qa_required_session_plan_versions(plan_version_id,workspace_id,project_id,work_item_id,plan_id,version,readiness_assessment_id,content_hash,content,published_at) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9)",
      [
        planVersionId,
        workspaceId,
        projectId,
        workItemId,
        planId,
        assessmentId,
        plan.contentHash,
        JSON.stringify(plan),
        at,
      ],
    );
    await manager.query(
      "INSERT INTO qa_required_session_plan_requirements(requirement_id,workspace_id,project_id,work_item_id,plan_version_id,requirement_key,ordinal,mode,minimum_session_count,resolution,content_hash,content) VALUES($1,$2,$3,$4,$5,'primary',1,'MANUAL',1,'REQUIRED',$6,$7)",
      [
        requirementId,
        workspaceId,
        projectId,
        workItemId,
        planVersionId,
        requirement.contentHash,
        JSON.stringify(requirement),
      ],
    );
    await manager.query(
      "UPDATE qa_required_session_plans SET current_version_id=$1,current_version=1,current_content_hash=$2,resource_version=2 WHERE plan_id=$3",
      [planVersionId, plan.contentHash, planId],
    );
    await manager.query(
      "UPDATE work_items SET state='READY' WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [workspaceId, projectId, workItemId],
    );
  });

  const request = await localQaTestRequest(source, "executor.alpha");
  let latestSessionEtag = "";
  const response = {
    setHeader(name: string, value: string) {
      if (name.toLowerCase() === "etag") latestSessionEtag = value;
    },
    status() {
      return response;
    },
  };
  const controller = new QaSessionsController(source, createLocalQaSessionRuntime());
  const created = (await controller.create(
    request as never,
    workspaceId,
    projectId,
    workItemId,
    'W/"1"',
    {
      requiredSessionRequirementRef: {
        planRef: { id: planVersionId, revision: 1, contentHash: plan.contentHash },
        requirementKey: "primary",
        ordinal: 1,
        contentHash: requirement.contentHash,
      },
    },
    response,
  )) as unknown as Readonly<{ sessionId: string; structureHash: `sha256:${string}` }>;
  const sessionId = created.sessionId;
  const mutation = (await controller.createPlanItem(
    request as never,
    workspaceId,
    projectId,
    workItemId,
    sessionId,
    'W/"1"',
    {
      title: "Manual acceptance check",
      expectedOutcome: "Expected outcome observed",
      definition: { kind: "session-plan-item-snapshot", snapshotHash: created.structureHash },
    },
    response,
  )) as unknown as Readonly<{ planItem: Readonly<{ planItemId: string }> }>;
  const ready = (await controller.transition(
    request as never,
    workspaceId,
    projectId,
    workItemId,
    sessionId,
    'W/"2"',
    { requestedState: "READY" },
    response,
  )) as unknown as Readonly<{
    targetSnapshotHash: string;
    scopeSnapshotHash: string;
    structureHash: `sha256:${string}`;
  }>;
  const running = (await controller.transition(
    request as never,
    workspaceId,
    projectId,
    workItemId,
    sessionId,
    latestSessionEtag,
    {
      requestedState: "RUNNING",
      targetInputFingerprint: ready.targetSnapshotHash,
      scopeInputFingerprint: ready.scopeSnapshotHash,
      expectedStructureHash: ready.structureHash,
    },
    response,
  )) as unknown as Readonly<{ resourceVersion: number; targetSnapshotHash: `sha256:${string}` }>;
  return {
    postgres,
    source,
    workspaceId,
    projectId,
    workItemId,
    sessionId,
    planItemId: mutation.planItem.planItemId,
    sessionVersion: running.resourceVersion,
    targetSnapshotHash: running.targetSnapshotHash,
    request,
    response,
  };
}

export async function stopUs3DatabaseFixture(
  fixture: Us3DatabaseFixture | undefined,
): Promise<void> {
  if (fixture?.source.isInitialized) await fixture.source.destroy();
  await fixture?.postgres.stop();
}

export async function executeUs3CleanPass(f: Us3DatabaseFixture) {
  const attempts = new TypeOrmManualAttemptService(f.source);
  const execution = new TypeOrmManualExecutionRepository(f.source);
  const started = await attempts.start({
    workspaceId: f.workspaceId,
    projectId: f.projectId,
    sessionId: f.sessionId,
    planItemId: f.planItemId,
    actor: us3Actor,
    expectedSessionVersion: f.sessionVersion,
    at: "2026-08-30T10:01:00.000Z",
  });
  const completed = await attempts.complete({
    workspaceId: f.workspaceId,
    projectId: f.projectId,
    attemptId: started.attempt.id,
    actor: us3Actor,
    result: "PASS",
    expectedSessionVersion: started.sessionResourceVersion,
    at: "2026-08-30T10:02:00.000Z",
  });
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
    expectedSessionVersion: completed.sessionResourceVersion,
    at: "2026-08-30T10:03:00.000Z",
  });
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
    expectedSessionVersion: observation.sessionResourceVersion,
    expectedMaximumAttemptNo: snapshot.maximumAttemptNo,
    expectedAttemptSetHash: snapshot.attemptSetHash,
    expectedObservationSetHash: snapshot.observationSetHash,
    at: "2026-08-30T10:04:00.000Z",
  });
  const controller = new QaSessionsController(f.source, createLocalQaSessionRuntime());
  const currentSession = await new TypeOrmManualSessionRepository(f.source).get(
    { workspaceId: f.workspaceId, projectId: f.projectId },
    f.sessionId,
  );
  if (!currentSession) throw new Error("QA_SESSION_NOT_FOUND");
  const reviewRequired = await controller.transition(
    f.request as never,
    f.workspaceId,
    f.projectId,
    f.workItemId,
    f.sessionId,
    strongSessionEtag({
      sourceId: currentSession.id,
      sourceVersion: currentSession.resourceVersion,
      semanticHash: qaAggregateSnapshotHash(currentSession as never),
    }),
    { requestedState: "REVIEW_REQUIRED" },
    f.response,
  );
  return Object.freeze({
    started,
    completed,
    observation,
    recorded,
    reviewRequired,
    executionSetHash: qaAggregateSnapshotHash([
      { id: completed.attempt.id, contentHash: completed.attempt.contentHash },
    ] as never),
  });
}

export async function reviewUs3CleanPass(
  f: Us3DatabaseFixture,
  executionSetHash: `sha256:${string}`,
) {
  return await new TypeOrmReviewManualSessionService(f.source).reviewCleanPass({
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
}
