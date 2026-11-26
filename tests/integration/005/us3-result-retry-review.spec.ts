import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TypeOrmQaAutomationQuarantineApi } from "../../../apps/api/src/extensions/gitlab-automation/qa-automation-quarantines.controller.ts";
import {
  buildQaAutomationQuarantineChangedEvent,
  decideQaAutomationRetry,
  prepareQaAutomationResultSync,
  qaAggregateSnapshotHash,
  type QaAutomationAttemptRecord,
  type QaAutomationAttemptResult,
  TypeOrmAutomationExecutionRepository,
  TypeOrmAutomationResultEvidenceUnitOfWork,
} from "../../../packages/competency-qa/src/node.ts";
import { designContractRegistry } from "../../../packages/platform-contracts/src/index.ts";
import { TypeOrmGitLabAutomationAttemptQuery } from "../../../packages/runtime-composition/src/gitlab/automation-attempt-query.ts";
import { TypeOrmGitLabAutomationLaunchService } from "../../../packages/runtime-composition/src/gitlab/automation-launch-service.ts";
import { createCorporateGitLabResultState } from "../../../packages/runtime-composition/src/gitlab/corporate-result-state.ts";
import {
  authorizeGitLabResultExecutor,
  createTypeOrmGitLabAutomationResultSyncConsumer,
  type Feature005AutomationEventEnvelope,
  feature005AutomationEventTypes,
  Feature005InProcessEventPublisher,
  type GitLabAutomationTerminalFacts,
  TypeOrmFeature005AutomationEventOutboxWorker,
} from "../../../packages/runtime-composition/src/gitlab/result-sync.ts";
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
import { requiredFixture } from "../../support/fixture-value.ts";

const hash = (value: string) => qaAggregateSnapshotHash(value as never);
const worker = Object.freeze({
  kind: "SERVICE" as const,
  principalId: localPersonaIds["worker.local"],
  serviceKey: "qa-result-retry",
});
const resultArtifactId = "d6900000-0000-4000-8000-000000000001";
const correlationId = "d6900000-0000-4000-8000-000000000002";
const causationId = "d6900000-0000-4000-8000-000000000003";

let fixture: Us3DatabaseFixture | undefined;
let session: PreparedUs2AutomationSession;
let runningAttempt: QaAutomationAttemptRecord;
let terminalAttempt: QaAutomationAttemptRecord;
let terminalFacts: GitLabAutomationTerminalFacts;
let unitOfWork: TypeOrmAutomationResultEvidenceUnitOfWork;

const scope = () =>
  Object.freeze({ workspaceId: fixture!.workspaceId, projectId: fixture!.projectId });

beforeAll(async () => {
  fixture = await startUs3DatabaseFixture();
  session = await prepareUs2AutomationSession(fixture);
  const launchService = new TypeOrmGitLabAutomationLaunchService(fixture.source, {
    executingService: worker,
    async authorize() {},
  });
  const confirmation = await launchService.currentConfirmation(scope(), us2AutomationSessionId);
  const launched = await launchService.launch({
    scope: scope(),
    sessionId: us2AutomationSessionId,
    idempotencyKey: "us3-result-retry-initial-launch",
    ifMatch: 1,
    confirmation,
    actor: us3Actor,
    authorizationBasis: us2AutomationAuthorizationBasis,
    authorizationBasisHash: qaAggregateSnapshotHash(us2AutomationAuthorizationBasis as never),
    correlationId: "d6800000-0000-4000-8000-000000000001",
    causationId: "d6800000-0000-4000-8000-000000000002",
    launchedAt: "2026-09-01T09:00:00.000Z",
  });
  const execution = new TypeOrmAutomationExecutionRepository(fixture.source);
  runningAttempt = await fixture.source.transaction(
    async (manager) =>
      await execution.attachAutomationTriggerReceipt(
        manager,
        scope(),
        launched.attempt.automationAttemptId,
        {
          externalPipelineId: "201",
          observedState: "RUNNING",
          providerCreatedAt: "2026-09-01T09:00:01.000Z",
          observedAt: "2026-09-01T09:00:02.000Z",
          observationHash: hash("us3-running-observation"),
        },
        "2026-09-01T09:00:02.000Z",
      ),
  );
  unitOfWork = new TypeOrmAutomationResultEvidenceUnitOfWork(fixture.source);
}, 120_000);

afterAll(async () => {
  await stopUs3DatabaseFixture(fixture);
}, 120_000);

describe("US3 terminal result, evidence, and atomic retry persistence", () => {
  it("loads the running result context only inside the selected corporate project", async () => {
    const state = createCorporateGitLabResultState(fixture!.source, {
      profile: "non-local",
      environmentScope: "NON_PROD",
      deployment: { workspaceId: fixture!.workspaceId, projectIds: [fixture!.projectId] },
    } as never);
    const selected = await state.load(
      { ...scope(), attemptId: runningAttempt.automationAttemptId },
      "RUNNING",
    );
    expect(selected.attempt.automationAttemptId).toBe(runningAttempt.automationAttemptId);
    expect(selected.targetSnapshot.snapshotHash).toBe(runningAttempt.targetSnapshotHash);
    expect(selected.previousStatus.status).toBe("RUNNING");
    await expect(
      state.load(
        {
          ...scope(),
          projectId: "d6900000-0000-4000-8000-000000000099",
          attemptId: runningAttempt.automationAttemptId,
        },
        "RUNNING",
      ),
    ).rejects.toThrow("CORPORATE_GITLAB_RESULT_SCOPE_DENIED");
  });
  it("authorizes only the stored result executor in the same project", async () => {
    const input = {
      ...scope(),
      attemptId: runningAttempt.automationAttemptId,
      principalId: worker.principalId,
    };
    expect(await authorizeGitLabResultExecutor(fixture!.source.manager, input)).toBe(true);
    expect(
      await authorizeGitLabResultExecutor(fixture!.source.manager, {
        ...input,
        principalId: "other-service",
      }),
    ).toBe(false);
    expect(
      await authorizeGitLabResultExecutor(fixture!.source.manager, {
        ...input,
        projectId: "d6900000-0000-4000-8000-000000000099",
      }),
    ).toBe(false);
  });
  it("commits immutable result/status/artifact facts and sticky REVIEW_REQUIRED state exactly once", async () => {
    const repository = new TypeOrmAutomationExecutionRepository(fixture!.source);
    const previousStatus = (
      await repository.automationStatusHistory(scope(), runningAttempt.automationAttemptId)
    ).at(-1)!;
    const artifactPin = runningAttempt.configurationPins.find(
      ({ logicalRole }) => logicalRole === "ARTIFACT_SOURCE",
    )!;
    const resultContentHash = hash("us3-machine-result-bytes");
    terminalFacts = {
      context: {
        actor: worker,
        scope: { kind: "PROJECT", ...scope() },
        correlationId,
        causationId,
      },
      attempt: runningAttempt,
      previousStatus,
      targetSnapshot: session.planned.targetSnapshot,
      observation: {
        externalPipelineId: "201",
        externalJobIds: ["2001"],
        providerStatus: "FAILED",
        providerRevisionToken: "failed:1",
        providerUpdatedAt: "2026-09-01T09:05:00.000Z",
        terminal: true,
        observedAt: "2026-09-01T09:05:00.000Z",
        observationHash: hash("us3-terminal-observation"),
        source: "POLL_READ",
        sourceReceiptRef: "gitlab-observation:201:failed:1",
      },
      normalization: {
        normalizationKind: "SCHEMA_VALIDATED",
        normalizationStatus: "VALID",
        issueCodes: [],
        outcome: "INFRA_FAILED",
        resultSchemaRef: runningAttempt.resultSchemaRef,
        sourceResultArtifactRef: "gitlab-result:201:2001:awp/results/result.json",
        resultContentHash,
        externalPipelineId: "201",
        externalJobIds: ["2001"],
        target: session.planned.targetSnapshot.target,
        suiteKey: session.planned.targetSnapshot.suite.suiteKey,
        environmentRef: session.planned.targetSnapshot.environment.environmentRef,
        durationMs: 300_000,
        infrastructureCode: "RUNNER_UNAVAILABLE",
        terminalAt: "2026-09-01T09:05:00.000Z",
      },
      artifactDescriptors: [
        {
          artifactReferenceId: resultArtifactId,
          descriptorHash: hash("us3-result-descriptor"),
          externalPipelineId: "201",
          externalJobId: "2001",
          logicalPath: "awp/results/result.json",
          checksum: resultContentHash,
          checksumSource: "CONNECTOR_CONTENT_SHA256",
          sizeBytes: 1_024,
          mediaType: "application/json",
          fileName: "result.json",
          artifactKind: "RESULT",
          classificationKey: "INTERNAL",
          sourceProfileRef: {
            id: artifactPin.profileRef.id,
            version: artifactPin.profileRef.version,
          },
          sourceProfileContentHash: artifactPin.profileRef.contentHash,
          retentionPolicyRef: runningAttempt.artifactPolicyRef,
          availability: "AVAILABLE",
          opaqueLocatorHash: hash("us3-result-locator"),
          expiresAt: "2026-09-08T09:05:00.000Z",
          registeredAt: "2026-09-01T09:05:00.000Z",
        },
      ],
      machineArtifactManifest: [],
      previousLineageResults: [],
      session: { state: "RUNNING", resourceVersion: 2 },
      recordedAt: "2026-09-01T09:05:01.000Z",
    };
    const prepared = prepareQaAutomationResultSync(terminalFacts);
    const persisted = await unitOfWork.persistTerminalResult(prepared);
    expect(persisted).toMatchObject({
      replayed: false,
      sessionState: "REVIEW_REQUIRED",
      sessionResourceVersion: 3,
    });
    await expect(unitOfWork.persistTerminalResult(prepared)).resolves.toMatchObject({
      replayed: true,
      resultId: prepared.result.automationAttemptResultId,
    });
    terminalAttempt = prepared.attempt;

    const resultState = createCorporateGitLabResultState(fixture!.source, {
      profile: "non-local",
      environmentScope: "NON_PROD",
      deployment: { workspaceId: fixture!.workspaceId, projectIds: [fixture!.projectId] },
    } as never);
    const recovered = await resultState.load(
      { ...scope(), attemptId: terminalAttempt.automationAttemptId },
      "TERMINAL",
    );
    expect(recovered.terminalResult?.contentHash).toBe(prepared.result.contentHash);
    expect(recovered.session.state).toBe("REVIEW_REQUIRED");

    const [counts] = (await fixture!.source.query(
      `SELECT
      (SELECT count(*)::int FROM qa_automation_attempt_results WHERE attempt_id=$1) AS results,
      (SELECT count(*)::int FROM qa_automation_artifact_memberships WHERE attempt_id=$1) AS memberships,
      (SELECT count(*)::int FROM artifact_references WHERE id=$2) AS artifacts,
      (SELECT count(*)::int FROM event_outbox WHERE event_type='qa.automation-attempt.completed' AND envelope->'payload'->>'automationAttemptId'=$1) AS completed_events`,
      [terminalAttempt.automationAttemptId, resultArtifactId],
    )) as readonly Record<string, number>[];
    expect(counts).toEqual({ results: 1, memberships: 1, artifacts: 1, completed_events: 1 });
    const [storedSession] = (await fixture!.source.query(
      "SELECT state,resource_version FROM qa_test_sessions WHERE session_id=$1",
      [us2AutomationSessionId],
    )) as readonly Record<string, unknown>[];
    expect(storedSession).toEqual({ state: "REVIEW_REQUIRED", resource_version: "3" });
    await expect(
      fixture!.source.query(
        "UPDATE qa_automation_attempt_results SET technical_outcome='PASS' WHERE attempt_id=$1",
        [terminalAttempt.automationAttemptId],
      ),
    ).rejects.toThrow("APPEND_ONLY");
  }, 120_000);

  it("atomically records the allowlisted retry, successor, command, fresh effect, outbox, and causal HUMAN basis", async () => {
    const repository = new TypeOrmAutomationExecutionRepository(fixture!.source);
    const result = await repository.terminalResult(scope(), terminalAttempt.automationAttemptId);
    expect(result).toBeDefined();
    const typedResult = result!.content as QaAutomationAttemptResult;
    const evaluation = decideQaAutomationRetry({
      attempt: terminalAttempt,
      result: typedResult,
      lineage: [terminalAttempt],
      policy: {
        policyRef: terminalAttempt.retryPolicyRef,
        policyHash: terminalAttempt.retryPolicyHash,
        automaticRetryBudget: 1,
        allowedInfrastructureCodes: ["RUNNER_UNAVAILABLE"],
      },
      authority: {
        authorizationAllowed: true,
        policyAllowed: true,
        quarantineActive: false,
        configurationPinsCurrent: true,
        targetCurrent: true,
        authorizationRecheckHash: hash("us3-retry-authorization-recheck"),
      },
      decidedBy: worker,
      decidedAt: "2026-09-01T09:05:02.000Z",
      correlationId,
      causationId,
    });
    const input = {
      context: {
        actor: worker,
        scope: { kind: "PROJECT" as const, ...scope() },
        correlationId,
        causationId,
        authorizationBasis: us2AutomationAuthorizationBasis,
      },
      evaluation,
      predecessor: terminalAttempt,
      previousAttempts: [terminalAttempt],
      targetSnapshot: session.planned.targetSnapshot,
      executingService: worker,
      causalAuthorizationBasis: us2AutomationAuthorizationBasis,
    } as const;
    const deniedAdmission = new TypeOrmAutomationResultEvidenceUnitOfWork(
      fixture!.source,
      undefined,
      {
        persist: async () => {
          throw new Error("RETRY_ADMISSION_DENIED");
        },
        assertReplay: async () => undefined,
      },
    );
    await expect(deniedAdmission.persistRetryEvaluation(input)).rejects.toThrow(
      "RETRY_ADMISSION_DENIED",
    );
    const [afterDeniedAdmission] = (await fixture!.source.query(
      "SELECT count(*)::int AS count FROM qa_automation_attempts WHERE attempt_id=$1",
      [evaluation.successor!.automationAttemptId],
    )) as readonly { count: number }[];
    expect(afterDeniedAdmission!.count).toBe(0);
    const persisted = await unitOfWork.persistRetryEvaluation(input);
    expect(persisted).toMatchObject({
      replayed: false,
      retryDecisionId: evaluation.decision.retryDecisionId,
      successorAttemptId: evaluation.successor!.automationAttemptId,
    });
    await expect(unitOfWork.persistRetryEvaluation(input)).resolves.toMatchObject({
      replayed: true,
      successorAttemptId: evaluation.successor!.automationAttemptId,
    });
    const resume = createTypeOrmGitLabAutomationResultSyncConsumer(fixture!.source);
    const recovery = {
      context: input.context,
      attempt: terminalAttempt,
      result: typedResult,
      lineage: [terminalAttempt],
      targetSnapshot: session.planned.targetSnapshot,
      retry: {
        policy: {
          policyRef: terminalAttempt.retryPolicyRef,
          policyHash: terminalAttempt.retryPolicyHash,
          automaticRetryBudget: 1,
          allowedInfrastructureCodes: ["RUNNER_UNAVAILABLE"],
        },
        authority: {
          authorizationAllowed: true,
          policyAllowed: true,
          quarantineActive: false,
          configurationPinsCurrent: true,
          targetCurrent: true,
          authorizationRecheckHash: hash("us3-retry-authorization-recheck"),
        },
        executingService: worker,
        causalAuthorizationBasis: us2AutomationAuthorizationBasis,
        decidedAt: "2026-09-01T09:05:02.000Z",
      },
    } as const;
    await expect(resume.resumeRetry(recovery)).resolves.toMatchObject({
      replayed: true,
      successorAttemptId: evaluation.successor!.automationAttemptId,
    });
    await expect(
      resume.resumeRetry({ ...recovery, result: { ...typedResult, outcome: "PASS" } }),
    ).rejects.toThrow("GITLAB_RESULT_RETRY_RECOVERY_INVALID");
    const { contentHash: _originalHash, ...resultBody } = typedResult;
    void _originalHash;
    const forgedBody = { ...resultBody, outcome: "PASS" as const };
    await expect(
      resume.resumeRetry({
        ...recovery,
        result: { ...forgedBody, contentHash: qaAggregateSnapshotHash(forgedBody as never) },
      }),
    ).rejects.toThrow("GITLAB_RESULT_RETRY_RECOVERY_STALE");
    const deniedReplay = new TypeOrmAutomationResultEvidenceUnitOfWork(fixture!.source, undefined, {
      persist: async () => undefined,
      assertReplay: async () => {
        throw new Error("RETRY_ADMISSION_REVOKED");
      },
    });
    await expect(deniedReplay.persistRetryEvaluation(input)).rejects.toThrow(
      "RETRY_ADMISSION_REVOKED",
    );

    const successor = await repository.automationAttempt(
      scope(),
      evaluation.successor!.automationAttemptId,
    );
    expect(successor).toMatchObject({
      reason: "AUTO_INFRA_RETRY",
      attemptNo: 2,
      predecessorAttemptId: terminalAttempt.automationAttemptId,
      rootAttemptId: terminalAttempt.rootAttemptId,
      currentStatus: "TRIGGER_PENDING",
      initiatingHumanId: terminalAttempt.initiatingHumanId,
      authorizationBasisHash: terminalAttempt.authorizationBasisHash,
    });
    expect(successor!.connectorCommandId).not.toBe(terminalAttempt.connectorCommandId);
    const [facts] = (await fixture!.source.query(
      `SELECT
      (SELECT count(*)::int FROM qa_automation_retry_decisions WHERE attempt_id=$1) AS decisions,
      (SELECT count(*)::int FROM qa_automation_attempts WHERE session_id=$2) AS attempts,
      (SELECT count(*)::int FROM connector_commands WHERE id=$3 AND effect_idempotency_key=$4) AS commands,
      (SELECT count(*)::int FROM command_outbox WHERE command_id=$3 AND state='READY') AS command_outbox,
      (SELECT count(*)::int FROM event_outbox WHERE event_type='qa.automation-retry.decided' AND envelope->'payload'->>'automationAttemptId'=$1) AS retry_events`,
      [
        terminalAttempt.automationAttemptId,
        us2AutomationSessionId,
        successor!.connectorCommandId,
        evaluation.successor!.effectIdempotencyKey,
      ],
    )) as readonly Record<string, number>[];
    expect(facts).toEqual({
      decisions: 1,
      attempts: 2,
      commands: 1,
      command_outbox: 1,
      retry_events: 1,
    });
    const [storedSession] = (await fixture!.source.query(
      "SELECT state,resource_version FROM qa_test_sessions WHERE session_id=$1",
      [us2AutomationSessionId],
    )) as readonly Record<string, unknown>[];
    expect(storedSession).toEqual({ state: "REVIEW_REQUIRED", resource_version: "3" });
  }, 120_000);

  it("returns exact scoped Attempt, status, result, retry, and classification-filtered Session artifact contracts", async () => {
    const query = new TypeOrmGitLabAutomationAttemptQuery(fixture!.source, {
      executingService: worker,
      async authorize() {},
    });
    const attempt = await query.detail(
      scope(),
      us2AutomationSessionId,
      terminalAttempt.automationAttemptId,
    );
    const statuses = await query.statusHistory(
      scope(),
      us2AutomationSessionId,
      terminalAttempt.automationAttemptId,
    );
    const result = await query.result(
      scope(),
      us2AutomationSessionId,
      terminalAttempt.automationAttemptId,
    );
    const retry = await query.retryDecision(
      scope(),
      us2AutomationSessionId,
      terminalAttempt.automationAttemptId,
    );
    const artifacts = await query.sessionArtifacts(scope(), us2AutomationSessionId, "INTERNAL");

    expect(attempt).toMatchObject({
      schemaVersion: "automation-attempt@1.0.0",
      currentStatus: "TERMINAL",
      terminalResultId: result?.automationAttemptResultId,
    });
    expect(statuses?.at(-1)).toMatchObject({
      schemaVersion: "automation-attempt-status-revision@1.0.0",
      status: "TERMINAL",
      terminalResultId: result?.automationAttemptResultId,
    });
    expect(result).toMatchObject({
      schemaVersion: "automation-attempt-result@1.0.0",
      automationAttemptId: terminalAttempt.automationAttemptId,
      outcome: "INFRA_FAILED",
    });
    expect(retry).toMatchObject({
      schemaVersion: "automation-retry-decision@1.0.0",
      automationAttemptId: terminalAttempt.automationAttemptId,
      decision: "SCHEDULED",
      automaticRetryOrdinal: 1,
    });
    expect(artifacts).toEqual([
      expect.objectContaining({
        schemaVersion: "automation-artifact-descriptor@1.0.0",
        artifactReferenceId: resultArtifactId,
        automationAttemptId: terminalAttempt.automationAttemptId,
        classification: "INTERNAL",
      }),
    ]);
    expect(await query.sessionArtifacts(scope(), us2AutomationSessionId, "PUBLIC")).toEqual([]);

    designContractRegistry.validateById("urn:awp:schemas:005:automation-attempt:v1", attempt);
    for (const status of statuses ?? [])
      designContractRegistry.validateById(
        "urn:awp:schemas:005:automation-attempt-status-revision:v1",
        status,
      );
    designContractRegistry.validateById("urn:awp:schemas:005:automation-attempt-result:v1", result);
    designContractRegistry.validateById("urn:awp:schemas:005:automation-retry-decision:v1", retry);
    for (const artifact of artifacts ?? [])
      designContractRegistry.validateById(
        "urn:awp:schemas:005:automation-artifact-descriptor:v1",
        artifact,
      );

    const foreignSession = "d6900000-0000-4000-8000-000000000099";
    await expect(
      query.detail(scope(), foreignSession, terminalAttempt.automationAttemptId),
    ).resolves.toBeUndefined();
    await expect(
      query.result(scope(), foreignSession, terminalAttempt.automationAttemptId),
    ).resolves.toBeUndefined();
    await expect(
      query.retryDecision(scope(), foreignSession, terminalAttempt.automationAttemptId),
    ).resolves.toBeUndefined();
    await expect(
      query.sessionArtifacts(scope(), foreignSession, "RESTRICTED"),
    ).resolves.toBeUndefined();
  }, 120_000);

  it("persists scoped HUMAN quarantine activation/lift revisions with idempotency, CAS, and exact projections", async () => {
    const context = Object.freeze({
      actor: us3Actor,
      scope: Object.freeze({ kind: "PROJECT" as const, ...scope() }),
      correlationId: "d6900000-0000-4000-8000-000000000020",
      causationId: "d6900000-0000-4000-8000-000000000021",
      authorizationBasis: us2AutomationAuthorizationBasis,
    });
    const activation = {
      context,
      idempotencyKey: "us3-quarantine-activation-0001",
      subject: Object.freeze({
        kind: "INFRASTRUCTURE_CODE" as const,
        infrastructureCode: "RUNNER_UNAVAILABLE",
      }),
      ownerPrincipalId: localPersonaIds["lead.alpha"],
      reason: "Runner capacity is under accountable quarantine.",
      evidenceRefs: Object.freeze([
        `automation-result:${terminalAttempt.terminalResultId}`,
        "incident:runner-capacity",
      ]),
      policyRef: terminalAttempt.quarantinePolicyRef,
      policyHash: terminalAttempt.quarantinePolicyHash,
      expiresAt: "2026-09-03T09:05:00.000Z",
      authorizationBasisHash: qaAggregateSnapshotHash(us2AutomationAuthorizationBasis as never),
    } as const;
    const activationApi = new TypeOrmQaAutomationQuarantineApi(
      fixture!.source,
      () => new Date("2026-09-01T09:06:00.000Z"),
    );
    const created = await activationApi.activate(activation);
    expect(created).toMatchObject({
      created: true,
      value: { effectiveState: "ACTIVE", resourceVersion: 1 },
    });
    await expect(activationApi.activate(activation)).resolves.toMatchObject({
      created: false,
      value: { quarantineId: created.value.quarantineId },
    });
    await expect(
      activationApi.activate({ ...activation, reason: "Changed under the same request key." }),
    ).rejects.toThrow("QA_AUTOMATION_QUARANTINE_IDEMPOTENCY_CONFLICT");

    const listed = await activationApi.list(scope());
    const detail = await activationApi.get(scope(), created.value.quarantineId);
    const initialRevisions = await activationApi.revisions(scope(), created.value.quarantineId);
    expect(listed).toContainEqual(detail);
    expect(initialRevisions).toHaveLength(1);
    designContractRegistry.validateById("urn:awp:schemas:005:automation-quarantine:v1", detail);
    designContractRegistry.validateById(
      "urn:awp:schemas:005:automation-quarantine-revision:v1",
      initialRevisions![0],
    );

    const liftApi = new TypeOrmQaAutomationQuarantineApi(
      fixture!.source,
      () => new Date("2026-09-01T10:06:00.000Z"),
    );
    const lift = {
      context: Object.freeze({
        ...context,
        correlationId: "d6900000-0000-4000-8000-000000000022",
        causationId: "d6900000-0000-4000-8000-000000000023",
      }),
      quarantineId: created.value.quarantineId,
      idempotencyKey: "us3-quarantine-lift-00000001",
      expectedResourceVersion: 1,
      reason: "Runner capacity recovered; preserve original failure evidence.",
      evidenceRefs: Object.freeze([
        ...activation.evidenceRefs,
        "incident:runner-capacity:resolved",
      ]),
      authorizationBasisHash: activation.authorizationBasisHash,
    } as const;
    const lifted = await liftApi.lift(lift);
    expect(lifted).toMatchObject({ effectiveState: "INACTIVE", resourceVersion: 2 });
    await expect(liftApi.lift(lift)).resolves.toEqual(lifted);
    await expect(
      liftApi.lift({ ...lift, idempotencyKey: "us3-quarantine-stale-0000001" }),
    ).rejects.toThrow("QA_AUTOMATION_QUARANTINE_CAS_CONFLICT");
    const revisions = await liftApi.revisions(scope(), created.value.quarantineId);
    expect(revisions).toHaveLength(2);
    expect(revisions?.[1]).toMatchObject({
      action: "LIFT",
      revisionNo: 2,
      previousRevisionId: requiredFixture(revisions)[0]?.quarantineRevisionId,
    });
    for (const value of revisions ?? [])
      designContractRegistry.validateById(
        "urn:awp:schemas:005:automation-quarantine-revision:v1",
        value,
      );
    await expect(
      liftApi.get(
        { workspaceId: fixture!.workspaceId, projectId: "d6900000-0000-4000-8000-000000000099" },
        created.value.quarantineId,
      ),
    ).resolves.toBeUndefined();
    const [events] = (await fixture!.source.query(
      "SELECT count(*)::int AS count FROM event_outbox WHERE event_type='qa.automation-quarantine.changed' AND envelope->'payload'->>'quarantineId'=$1",
      [created.value.quarantineId],
    )) as readonly Record<string, number>[];
    expect(events).toEqual({ count: 2 });
  }, 120_000);

  it("replays the closed runtime consumer without duplicating result, retry, successor, or outbox facts", async () => {
    const consumer = createTypeOrmGitLabAutomationResultSyncConsumer(fixture!.source);
    const receipt = await consumer.consume({
      facts: terminalFacts,
      lineage: [runningAttempt],
      retry: {
        policy: {
          policyRef: runningAttempt.retryPolicyRef,
          policyHash: runningAttempt.retryPolicyHash,
          automaticRetryBudget: 1,
          allowedInfrastructureCodes: ["RUNNER_UNAVAILABLE"],
        },
        authority: {
          authorizationAllowed: true,
          policyAllowed: true,
          quarantineActive: false,
          configurationPinsCurrent: true,
          targetCurrent: true,
          authorizationRecheckHash: hash("us3-retry-authorization-recheck"),
        },
        executingService: worker,
        causalAuthorizationBasis: us2AutomationAuthorizationBasis,
        decidedAt: "2026-09-01T09:05:02.000Z",
      },
    });
    expect(receipt.result.replayed).toBe(true);
    expect(receipt.retry.replayed).toBe(true);
  }, 120_000);

  it("publishes exact Feature 005 envelopes only from durable outbox rows and acknowledges after delivery", async () => {
    expect(feature005AutomationEventTypes).toHaveLength(6);
    const quarantineEvent = buildQaAutomationQuarantineChangedEvent({
      context: {
        actor: worker,
        scope: { kind: "PROJECT", ...scope() },
        correlationId,
        causationId,
      },
      eventId: "d6900000-0000-4000-8000-000000000010",
      quarantineId: "d6900000-0000-4000-8000-000000000011",
      quarantineRevisionId: "d6900000-0000-4000-8000-000000000012",
      revisionNo: 1,
      subject: { kind: "INFRASTRUCTURE_CODE", infrastructureCode: "RUNNER_UNAVAILABLE" },
      action: "ACTIVATE",
      effectiveState: "ACTIVE",
      ownerPrincipalId: localPersonaIds["lead.alpha"],
      reason: "Bounded US3 event publication fixture",
      evidenceRefs: ["evidence:us3:quarantine-event"],
      evidenceSetHash: hash("us3-quarantine-event-evidence"),
      policyRef: "policy:quarantine:us3:v1",
      policyHash: hash("us3-quarantine-event-policy"),
      actorPrincipalId: localPersonaIds["lead.alpha"],
      authorizationBasisHash: hash("us3-quarantine-event-authorization"),
      expiresAt: "2026-09-08T09:05:00.000Z",
      effectiveAt: "2026-09-01T09:05:03.000Z",
      contentHash: hash("us3-quarantine-event"),
    });
    await fixture!.source.query(
      `INSERT INTO event_outbox(
      id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at
    ) VALUES($1,$2,$3,$4,$5,$6,'READY',$7)`,
      [
        quarantineEvent.eventId,
        quarantineEvent.workspaceId,
        quarantineEvent.projectId,
        quarantineEvent.eventType,
        JSON.stringify(quarantineEvent),
        qaAggregateSnapshotHash(quarantineEvent as never),
        quarantineEvent.recordedAt,
      ],
    );
    const [firstReady] = (await fixture!.source.query(
      `SELECT id,envelope_hash FROM event_outbox WHERE state='READY' AND event_type=ANY($1::text[])
       ORDER BY created_at,id LIMIT 1`,
      [[...feature005AutomationEventTypes]],
    )) as readonly { id: string; envelope_hash: string }[];
    expect(firstReady).toBeDefined();
    await fixture!.source.query("UPDATE event_outbox SET envelope_hash=$2 WHERE id=$1", [
      firstReady!.id,
      `sha256:${"0".repeat(64)}`,
    ]);
    const corruptPublisher = new Feature005InProcessEventPublisher();
    const corruptDeliveries: Feature005AutomationEventEnvelope[] = [];
    corruptPublisher.subscribe((event) => {
      corruptDeliveries.push(event);
    });
    await expect(
      new TypeOrmFeature005AutomationEventOutboxWorker(fixture!.source, corruptPublisher).runOne(),
    ).rejects.toThrow("FEATURE_005_EVENT_ENVELOPE_INVALID");
    expect(corruptDeliveries).toHaveLength(0);
    await fixture!.source.query("UPDATE event_outbox SET envelope_hash=$2 WHERE id=$1", [
      firstReady!.id,
      firstReady!.envelope_hash,
    ]);
    // A failed delivery must leave the durable event available for a later attempt.
    const failedEventWorker = new TypeOrmFeature005AutomationEventOutboxWorker(fixture!.source, {
      publish: async () => {
        throw new Error("DELIVERY_UNAVAILABLE");
      },
    });
    const [beforeFailure] = (await fixture!.source.query(
      `SELECT count(*)::int AS ready FROM event_outbox
       WHERE state='READY' AND event_type=ANY($1::text[])`,
      [[...feature005AutomationEventTypes]],
    )) as readonly { ready: number }[];
    expect(beforeFailure!.ready).toBeGreaterThan(0);
    await expect(failedEventWorker.runOne()).rejects.toThrow("DELIVERY_UNAVAILABLE");
    const [afterFailure] = (await fixture!.source.query(
      `SELECT count(*)::int AS ready FROM event_outbox
       WHERE state='READY' AND event_type=ANY($1::text[])`,
      [[...feature005AutomationEventTypes]],
    )) as readonly { ready: number }[];
    expect(afterFailure!.ready).toBe(beforeFailure!.ready);

    const published: Feature005AutomationEventEnvelope[] = [];
    const publisher = new Feature005InProcessEventPublisher();
    publisher.subscribe((event) => {
      published.push(event);
    });
    const eventWorker = new TypeOrmFeature005AutomationEventOutboxWorker(
      fixture!.source,
      publisher,
    );
    while ((await eventWorker.runOne()) === "PUBLISHED") {
      /* drain the closed Feature 005 lane */
    }

    expect(new Set(published.map(({ eventType }) => eventType))).toEqual(
      new Set([
        "qa.automation-attempt.created",
        "qa.automation-attempt.status-observed",
        "qa.automation-attempt.completed",
        "qa.automation-retry.decided",
        "qa.automation-artifact.registered",
        "qa.automation-quarantine.changed",
      ]),
    );
    expect(
      published.filter(({ eventType }) => eventType === "qa.automation-attempt.created"),
    ).toHaveLength(2);
    expect(
      published.every(
        ({ producer, payloadSchemaRef }) =>
          producer === "competency-qa" &&
          payloadSchemaRef.id.startsWith("urn:awp:schemas:005:events:"),
      ),
    ).toBe(true);
    const [outbox] = (await fixture!.source.query(
      `SELECT
      count(*) FILTER (WHERE state='READY')::int AS ready,
      count(*) FILTER (WHERE state='ACKNOWLEDGED')::int AS acknowledged
      FROM event_outbox WHERE event_type=ANY($1::text[])`,
      [[...feature005AutomationEventTypes]],
    )) as readonly Record<string, number>[];
    expect(outbox).toEqual({ ready: 0, acknowledged: published.length });
  }, 120_000);
});
