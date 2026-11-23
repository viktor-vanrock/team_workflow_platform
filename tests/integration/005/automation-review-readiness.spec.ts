import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createQaObservation,
  decideQaAutomationRetry,
  ManualExecutionUnitOfWork,
  prepareQaAutomationResultSync,
  qaAggregateSnapshotHash,
  type QaAutomationResultSyncPreparation,
  TypeOrmAutomationExecutionRepository,
  TypeOrmAutomationResultEvidenceUnitOfWork,
  TypeOrmAutomationReviewFreezeService,
  TypeOrmRecordPlanItemResultService,
} from "../../../packages/competency-qa/src/node.ts";
import { TypeOrmGitLabAutomationLaunchService } from "../../../packages/runtime-composition/src/gitlab/automation-launch-service.ts";
import { localPersonaIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
  type Us3DatabaseFixture,
} from "../../support/002-us3-database.ts";
import {
  type PreparedUs2AutomationSession,
  prepareUs2AutomationSession,
  us2AutomationAuthorizationBasis,
  us2AutomationSessionId,
} from "../../support/005-us2-automation.ts";

const hash = (value: string) => qaAggregateSnapshotHash(value as never);
const worker = Object.freeze({
  kind: "SERVICE" as const,
  principalId: localPersonaIds["worker.local"],
  serviceKey: "qa-result-review",
});
let fixture: Us3DatabaseFixture | undefined;
let planned: PreparedUs2AutomationSession;
let launchService: TypeOrmGitLabAutomationLaunchService;
let terminal: QaAutomationResultSyncPreparation;

const scope = () =>
  Object.freeze({ workspaceId: fixture!.workspaceId, projectId: fixture!.projectId });

beforeAll(async () => {
  fixture = await startUs3DatabaseFixture();
  planned = await prepareUs2AutomationSession(fixture);
  launchService = new TypeOrmGitLabAutomationLaunchService(fixture.source, {
    executingService: worker,
    async authorize() {},
  });
  const confirmation = await launchService.currentConfirmation(scope(), us2AutomationSessionId);
  const launched = await launchService.launch({
    scope: scope(),
    sessionId: us2AutomationSessionId,
    idempotencyKey: "us3-review-initial-launch",
    ifMatch: 1,
    confirmation,
    actor: us3Actor,
    authorizationBasis: us2AutomationAuthorizationBasis,
    authorizationBasisHash: qaAggregateSnapshotHash(us2AutomationAuthorizationBasis as never),
    correlationId: "e6800000-0000-4000-8000-000000000001",
    causationId: "e6800000-0000-4000-8000-000000000002",
    launchedAt: "2026-09-01T10:00:00.000Z",
  });
  const repository = new TypeOrmAutomationExecutionRepository(fixture.source);
  const running = await fixture.source.transaction(
    async (manager) =>
      await repository.attachAutomationTriggerReceipt(
        manager,
        scope(),
        launched.attempt.automationAttemptId,
        {
          externalPipelineId: "301",
          observedState: "RUNNING",
          providerCreatedAt: "2026-09-01T10:00:01.000Z",
          observedAt: "2026-09-01T10:00:02.000Z",
          observationHash: hash("review-running"),
        },
        "2026-09-01T10:00:02.000Z",
      ),
  );
  const previousStatus = (
    await repository.automationStatusHistory(scope(), running.automationAttemptId)
  ).at(-1)!;
  const artifactPin = running.configurationPins.find(
    ({ logicalRole }) => logicalRole === "ARTIFACT_SOURCE",
  )!;
  const resultContentHash = hash("review-result-bytes");
  terminal = prepareQaAutomationResultSync({
    context: {
      actor: worker,
      scope: { kind: "PROJECT", ...scope() },
      correlationId: "e6900000-0000-4000-8000-000000000001",
      causationId: "e6900000-0000-4000-8000-000000000002",
    },
    attempt: running,
    previousStatus,
    targetSnapshot: planned.planned.targetSnapshot,
    observation: {
      externalPipelineId: "301",
      externalJobIds: ["3001"],
      providerStatus: "SUCCESS",
      providerRevisionToken: "success:1",
      providerUpdatedAt: "2026-09-01T10:05:00.000Z",
      terminal: true,
      observedAt: "2026-09-01T10:05:00.000Z",
      observationHash: hash("review-terminal"),
      source: "POLL_READ",
      sourceReceiptRef: "gitlab-observation:301:success:1",
    },
    normalization: {
      normalizationKind: "SCHEMA_VALIDATED",
      normalizationStatus: "VALID",
      issueCodes: [],
      outcome: "PASS",
      resultSchemaRef: running.resultSchemaRef,
      sourceResultArtifactRef: "gitlab-result:301:3001:awp/results/result.json",
      resultContentHash,
      externalPipelineId: "301",
      externalJobIds: ["3001"],
      target: planned.planned.targetSnapshot.target,
      suiteKey: planned.planned.targetSnapshot.suite.suiteKey,
      environmentRef: planned.planned.targetSnapshot.environment.environmentRef,
      durationMs: 120_000,
      terminalAt: "2026-09-01T10:05:00.000Z",
    },
    artifactDescriptors: [
      {
        artifactReferenceId: "e6900000-0000-4000-8000-000000000003",
        descriptorHash: hash("review-descriptor"),
        externalPipelineId: "301",
        externalJobId: "3001",
        logicalPath: "awp/results/result.json",
        checksum: resultContentHash,
        checksumSource: "CONNECTOR_CONTENT_SHA256",
        sizeBytes: 2_048,
        mediaType: "application/json",
        fileName: "result.json",
        artifactKind: "RESULT",
        classificationKey: "INTERNAL",
        sourceProfileRef: {
          id: artifactPin.profileRef.id,
          version: artifactPin.profileRef.version,
        },
        sourceProfileContentHash: artifactPin.profileRef.contentHash,
        retentionPolicyRef: running.artifactPolicyRef,
        availability: "AVAILABLE",
        opaqueLocatorHash: hash("review-locator"),
        expiresAt: "2026-09-08T10:05:00.000Z",
        registeredAt: "2026-09-01T10:05:00.000Z",
      },
    ],
    machineArtifactManifest: [],
    previousLineageResults: [],
    session: { state: "RUNNING", resourceVersion: 2 },
    recordedAt: "2026-09-01T10:05:01.000Z",
  });
  const resultUow = new TypeOrmAutomationResultEvidenceUnitOfWork(fixture.source);
  await resultUow.persistTerminalResult(terminal);
  const evaluation = decideQaAutomationRetry({
    attempt: terminal.attempt,
    result: terminal.result,
    lineage: [terminal.attempt],
    policy: {
      policyRef: terminal.attempt.retryPolicyRef,
      policyHash: terminal.attempt.retryPolicyHash,
      automaticRetryBudget: 1,
      allowedInfrastructureCodes: ["RUNNER_UNAVAILABLE"],
    },
    authority: {
      authorizationAllowed: true,
      policyAllowed: true,
      quarantineActive: false,
      configurationPinsCurrent: true,
      targetCurrent: true,
      authorizationRecheckHash: hash("review-auth-recheck"),
    },
    decidedBy: worker,
    decidedAt: "2026-09-01T10:05:02.000Z",
    correlationId: "e6900000-0000-4000-8000-000000000004",
    causationId: "e6900000-0000-4000-8000-000000000005",
  });
  await resultUow.persistRetryEvaluation({
    context: {
      actor: worker,
      scope: { kind: "PROJECT", ...scope() },
      correlationId: "e6900000-0000-4000-8000-000000000004",
      causationId: "e6900000-0000-4000-8000-000000000005",
      authorizationBasis: us2AutomationAuthorizationBasis,
    },
    evaluation,
    predecessor: terminal.attempt,
    previousAttempts: [terminal.attempt],
    targetSnapshot: planned.planned.targetSnapshot,
    executingService: worker,
    causalAuthorizationBasis: us2AutomationAuthorizationBasis,
  });
  await fixture.source.query("UPDATE connector_commands SET state='CONFIRMED' WHERE id=$1", [
    terminal.attempt.connectorCommandId,
  ]);
  const observation = createQaObservation({
    id: "e6900000-0000-4000-8000-000000000006",
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    workItemId: terminal.attempt.workItemId,
    sessionId: terminal.attempt.testSessionId,
    planItemId: terminal.attempt.planItemId,
    attemptId: terminal.attempt.automationAttemptId,
    kind: "POSITIVE",
    expectedOutcome: "Automated suite passes",
    actualOutcome: "Canonical machine result is PASS",
    severity: "INFO",
    actor: us3Actor,
    observedAt: "2026-09-01T10:06:00.000Z",
  });
  await fixture.source.transaction(
    async (manager) =>
      await new ManualExecutionUnitOfWork(manager).persistObservation(observation, 3, "AUTOMATED"),
  );
}, 120_000);

afterAll(async () => {
  await stopUs3DatabaseFixture(fixture);
}, 120_000);

describe("US3 automation review readiness and review-first race", () => {
  it("records a HUMAN PASS against the complete Attempt-set and makes a later rerun fail closed", async () => {
    const attemptSetHash = qaAggregateSnapshotHash([
      { id: terminal.attempt.automationAttemptId, contentHash: terminal.result.contentHash },
    ] as never);
    const reviewService = new TypeOrmRecordPlanItemResultService(fixture!.source);
    const reviewInput = {
      workspaceId: fixture!.workspaceId,
      projectId: fixture!.projectId,
      sessionId: terminal.attempt.testSessionId,
      planItemId: terminal.attempt.planItemId,
      result: "PASS",
      actualOutcome: "Canonical automated PASS reviewed with positive HUMAN observation.",
      decisionReason: "Complete immutable Attempt-set and evidence reviewed.",
      reviewFlags: [],
      actor: us3Actor,
      expectedSessionVersion: 4,
      expectedAttemptSetHash: attemptSetHash,
      riskReviewerPolicy: {
        policyRef: "policy:qa-risk-review:v1",
        policyHash: hash("review-risk-policy"),
        highAndCriticalRequireDistinctReviewer: true,
        waiverRequiresDistinctReviewer: true,
        eligibleReviewerIds: [us3Actor.principalId],
      },
      at: "2026-09-01T10:07:00.000Z",
    } as const;
    await expect(
      reviewService.recordAutomated({
        ...reviewInput,
        expectedAttemptSetHash: hash("older-attempt-set"),
      }),
    ).rejects.toThrow("QA_AUTOMATION_ATTEMPT_SET_STALE");
    const recorded = await reviewService.recordAutomated(reviewInput);
    expect(recorded).toMatchObject({
      readiness: { reviewable: true, attemptSetHash },
      sessionResourceVersion: 5,
      result: { result: "PASS" },
    });
    const [item] = (await fixture!.source.query(
      "SELECT state,latest_result_revision_id FROM qa_plan_items WHERE plan_item_id=$1",
      [terminal.attempt.planItemId],
    )) as readonly Record<string, unknown>[];
    expect(item).toEqual({ state: "TERMINAL", latest_result_revision_id: recorded.result.id });

    const manifestId = "e6900000-0000-4000-8000-000000000007";
    const manifestRevisionId = "e6900000-0000-4000-8000-000000000008";
    const manifestContentHash = hash("review-manifest");
    await fixture!.source.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO qa_evidence_manifests(
        manifest_id,workspace_id,project_id,work_item_id,session_id,latest_revision_id,latest_adjudicative_revision_id,
        revision_count,resource_version,created_at,updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,$6,1,1,$7,$7)`,
        [
          manifestId,
          fixture!.workspaceId,
          fixture!.projectId,
          terminal.attempt.workItemId,
          terminal.attempt.testSessionId,
          manifestRevisionId,
          "2026-09-01T10:07:01.000Z",
        ],
      );
      await manager.query(
        `INSERT INTO qa_evidence_manifest_revisions(
        manifest_revision_id,manifest_id,workspace_id,project_id,work_item_id,session_id,version,kind,
        previous_revision_id,previous_version,previous_content_hash,correction_reason,manifest,content_hash,
        signature,evidence_policy_ref,published_at
      ) VALUES($1,$2,$3,$4,$5,$6,1,'INITIAL',NULL,NULL,NULL,NULL,$7,$8,$9,$10,$11)`,
        [
          manifestRevisionId,
          manifestId,
          fixture!.workspaceId,
          fixture!.projectId,
          terminal.attempt.workItemId,
          terminal.attempt.testSessionId,
          JSON.stringify({ resultRef: recorded.result.id }),
          manifestContentHash,
          JSON.stringify({ signer: us3Actor, contentHash: manifestContentHash }),
          JSON.stringify({ key: "qa.evidence", version: "1.0.0" }),
          "2026-09-01T10:07:01.000Z",
        ],
      );
    });
    const frozen = await new TypeOrmAutomationReviewFreezeService(fixture!.source).freeze({
      workspaceId: fixture!.workspaceId,
      projectId: fixture!.projectId,
      workItemId: terminal.attempt.workItemId,
      sessionId: terminal.attempt.testSessionId,
      planItemId: terminal.attempt.planItemId,
      expectedSessionVersion: 5,
      expectedAttemptSetHash: attemptSetHash,
      readiness: recorded.readiness,
      planItemResultRef: {
        id: recorded.result.id,
        version: recorded.result.version,
        contentHash: recorded.result.contentHash,
      },
      adjudicativeManifestRevisionRef: { id: manifestRevisionId, contentHash: manifestContentHash },
      artifactDescriptorSetHash: terminal.result.artifactDescriptorSetHash,
      observationSetHash: recorded.result.consideredObservationSetHash,
      findingSetHash: qaAggregateSnapshotHash([] as never),
      evidenceSetHash: qaAggregateSnapshotHash([] as never),
      riskPolicyRef: reviewInput.riskReviewerPolicy.policyRef,
      riskPolicyHash: reviewInput.riskReviewerPolicy.policyHash,
      actor: us3Actor,
      authorizationBasisHash: qaAggregateSnapshotHash(us2AutomationAuthorizationBasis as never),
      correlationId: "e6900000-0000-4000-8000-000000000009",
      causationId: "e6900000-0000-4000-8000-000000000010",
      at: "2026-09-01T10:07:02.000Z",
    });
    expect(frozen).toMatchObject({
      replayed: false,
      freeze: { attempt_set_hash: attemptSetHash, attempt_count: 1 },
    });
    await expect(
      launchService.currentConfirmation(scope(), us2AutomationSessionId),
    ).rejects.toThrow("QA_AUTOMATION_LAUNCH_STATE_INVALID");
  }, 120_000);
});
