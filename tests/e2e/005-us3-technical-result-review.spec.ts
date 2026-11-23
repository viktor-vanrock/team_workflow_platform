import "../../apps/mock-hub/node_modules/reflect-metadata/Reflect.js";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { QaAutomationAttemptsController } from "../../apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts";
import { NestFactory } from "../../apps/mock-hub/node_modules/@nestjs/core/index.js";
import {
  GitLabControlController,
  GitLabMockControlPolicy,
} from "../../apps/mock-hub/src/gitlab/control/gitlab-control.controller.ts";
import {
  gitLabMockMigrations,
  GitLabModule,
  gitLabScenarioCatalog,
  gitLabUs3ScenarioIds,
  seedGitLabRepository,
  TypeOrmGitLabRepository,
} from "../../apps/mock-hub/src/gitlab/gitlab.module.ts";
import { createMockHubDataSource } from "../../apps/mock-hub/src/persistence/data-source.ts";
import {
  qaAggregateSnapshotHash,
  TypeOrmAutomationExecutionRepository,
} from "../../packages/competency-qa/src/node.ts";
import {
  createGitLabDialect,
  createGitLabRestPipelineReadTransport,
  GitLabAuth,
  type GitLabConnectionConfiguration,
  GitLabPipelineReader,
  GitLabRestClient,
  type GitLabResultNormalizationRequest,
  GitLabResultNormalizer,
} from "../../packages/connector-gitlab/src/index.ts";
import type {
  PipelineReadRequest,
  TrustedConnectorOperationContext,
} from "../../packages/connector-sdk/src/index.ts";
import { sha256 } from "../../packages/platform-contracts/src/index.ts";
import { loadEnvironment } from "../../packages/runtime-composition/src/config/environment.ts";
import {
  createTypeOrmGitLabAutomationResultSyncConsumer,
  qaJiraGitLabLocalEntities,
  qaJiraGitLabLocalMigrations,
  TypeOrmGitLabAutomationAttemptQuery,
} from "../../packages/runtime-composition/src/index.ts";
import { localPersonaIds } from "../../packages/runtime-composition/src/seed/local-seed.ts";
import {
  buildQaJiraGitLabLocalSeedConfiguration,
  runQaJiraGitLabLocalSeed,
} from "../../packages/runtime-composition/src/seed/qa-jira-gitlab-local-seed.ts";
import { gitLabUs3ScenarioCatalog } from "../../tools/local/gitlab-scenario-catalog.mts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  type Us3DatabaseFixture,
} from "../support/002-us3-database.ts";
import {
  type PreparedUs2AutomationSession,
  prepareUs2AutomationSession,
  type Us2AutomationAuthorityPins,
  us2AutomationAuthorizationBasis,
  us2AutomationSessionId,
} from "../support/005-us2-automation.ts";
import { localQaTestRequest } from "../support/008-qa-request.ts";

const markerHash = sha256("mock-result-request-marker");
const commitSha = "a".repeat(40);
const buildRef = "build:qa-api:2026.09.01.1";
const suiteKey = "smoke";
const environmentRef = "environment:test:qa-1@17";
const now = new Date("2026-09-01T08:00:00.000Z");
const digest = (value: string) => qaAggregateSnapshotHash(value as never);
const worker = Object.freeze({
  kind: "SERVICE" as const,
  principalId: localPersonaIds["worker.local"],
  serviceKey: "gitlab-result-e2e",
});

interface ResponseCapture {
  statusCode: number;
  readonly headers: Map<string, string>;
  status(code: number): ResponseCapture;
  setHeader(name: string, value: string): void;
}

function response(): ResponseCapture {
  return {
    statusCode: 200,
    headers: new Map<string, string>(),
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers.set(name, value);
    },
  };
}

function connection(): GitLabConnectionConfiguration {
  const exact = (character: string) => `sha256:${character.repeat(64)}` as const;
  const common = {
    ownerRef: "team:qa",
    rotationPolicyRef: "policy:rotate",
    revocationRunbookRef: "runbook:revoke",
  };
  return {
    schemaVersion: "gitlab-connection-configuration@1.0.0",
    identityReferences: {
      read: {
        ...common,
        identityKind: "NON_HUMAN_PROJECT",
        scope: "read_api",
        nonHumanIdentityEvidenceRef: "evidence:read",
        reference: "secretref://gitlab/read",
        referenceFingerprint: exact("1"),
      },
      trigger: {
        ...common,
        identityKind: "NON_HUMAN_PROJECT",
        scope: "pipeline_trigger",
        nonHumanIdentityEvidenceRef: "evidence:trigger",
        reference: "secretref://gitlab/trigger",
        referenceFingerprint: exact("2"),
      },
      webhook: {
        ...common,
        identityMaterialKind: "STANDARD_WEBHOOK_HMAC_KEY",
        keyVersionRef: "key:webhook:v1",
        reference: "secretref://gitlab/webhook",
        referenceFingerprint: exact("3"),
      },
    },
    operationIdentityRouting: {
      mergeRequestRead: "READ",
      commitRead: "READ",
      buildRead: "READ",
      pipelineTrigger: "TRIGGER",
      pipelineRead: "READ",
      pipelineLookup: "READ",
      artifactMetadata: "READ",
      artifactStream: "READ",
      webhookVerify: "WEBHOOK",
    },
    identitySeparationEvidenceHash: exact("4"),
  };
}

function context(role: "TEST_EXECUTION" | "ARTIFACT_SOURCE"): TrustedConnectorOperationContext {
  const exact = (id: string, value: string) => ({ id, version: 1, contentHash: digest(value) });
  const profileRef = exact("profile-1", "profile");
  const bindingRef = exact("binding-1", "binding");
  const pins = [
    ["SOURCE_CONTEXT", "source-context.read"],
    ["TEST_EXECUTION", "test-executor.trigger-status"],
    ["ARTIFACT_SOURCE", "artifact.ci-read"],
  ].map(([logicalRole, capabilityKey]) => ({
    logicalRole: logicalRole!,
    capabilityKey: capabilityKey!,
    exactContractVersion: "1.0.0",
    bindingRef,
    profileRef,
    connectionRef: exact("connection-1", "connection"),
    validationReportRef: exact(`validation-${logicalRole}`, `validation-${logicalRole}`),
    operationSetHash: digest(`operations-${logicalRole}`),
  }));
  return {
    scope: { kind: "PROJECT", workspaceId: "workspace-1", projectId: "project-1" },
    actor: { kind: "SERVICE", principalId: "worker-1", serviceKey: "qa-worker" },
    correlationId: "correlation-1",
    causationId: "causation-1",
    effectIdempotencyKey: "qa:automation:result-e2e",
    profileRef: { id: profileRef.id, version: profileRef.version },
    classification: { key: "INTERNAL", rank: 20 },
    signal: new AbortController().signal,
    authorizationBasisHash: digest("authorization"),
    configurationPins: pins,
    deadlineAt: "2026-09-01T09:00:00.000Z",
    telemetry: {
      correlationId: "correlation-1",
      causationId: "causation-1",
      operation: role === "TEST_EXECUTION" ? "pipeline.read" : "artifact.result-read",
    },
  };
}

let fixture: Us3DatabaseFixture | undefined;
let mockSource: ReturnType<typeof createMockHubDataSource> | undefined;
let mockApp: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
let mockControl: GitLabControlController;
let mockRepository: TypeOrmGitLabRepository;
let normalizer: GitLabResultNormalizer;
let reader: GitLabPipelineReader;
let prepared: PreparedUs2AutomationSession;
let baseUrl: string;

async function authorityPins(): Promise<Us2AutomationAuthorityPins> {
  const [row] = (await fixture!.source.query(
    `
SELECT binding.header_id AS binding_id,binding.version AS binding_version,binding.content_hash AS binding_hash,
       profile.header_id AS profile_id,profile.version AS profile_version,profile.content_hash AS profile_hash,
       connection.header_id AS connection_id,connection.version AS connection_version,connection.content_hash AS connection_hash
FROM project_integration_binding_revisions binding
CROSS JOIN LATERAL jsonb_array_elements(binding.content->'entries') entry
JOIN connector_profile_revisions profile ON profile.workspace_id=binding.workspace_id
  AND profile.header_id::text=entry->'profileRef'->>'id' AND profile.version=(entry->'profileRef'->>'version')::int
  AND profile.content_hash=entry->'profileRef'->>'contentHash' AND profile.status='PUBLISHED'
JOIN connection_revisions connection ON connection.workspace_id=binding.workspace_id
  AND connection.header_id::text=entry->'connectionRef'->>'id' AND connection.version=(entry->'connectionRef'->>'version')::int
  AND connection.content_hash=entry->'connectionRef'->>'contentHash' AND connection.status='PUBLISHED'
WHERE binding.workspace_id=$1 AND binding.project_id=$2 AND binding.status='PUBLISHED'
  AND binding.content->>'schemaVersion'='gitlab-project-binding@1.0.0'
  AND entry->>'logicalRole'='TEST_EXECUTION'
ORDER BY binding.version DESC LIMIT 1`,
    [fixture!.workspaceId, fixture!.projectId],
  )) as readonly Readonly<Record<string, unknown>>[];
  if (!row) throw new Error("US3_E2E_GITLAB_AUTHORITY_MISSING");
  return Object.freeze({
    bindingRef: Object.freeze({
      id: String(row.binding_id),
      version: Number(row.binding_version),
      contentHash: String(row.binding_hash) as `sha256:${string}`,
    }),
    profileRef: Object.freeze({
      id: String(row.profile_id),
      version: Number(row.profile_version),
      contentHash: String(row.profile_hash) as `sha256:${string}`,
    }),
    connectionRef: Object.freeze({
      id: String(row.connection_id),
      version: Number(row.connection_version),
      contentHash: String(row.connection_hash) as `sha256:${string}`,
    }),
  });
}

function normalizationRequest(
  pipelineId: number,
  jobId: number,
  expectedResultChecksum?: `sha256:${string}`,
): GitLabResultNormalizationRequest {
  return {
    automationAttemptId: `attempt-${pipelineId}`,
    externalPipelineId: String(pipelineId),
    externalJobId: String(jobId),
    sourceResultArtifactRef: `connector-artifact:result:${pipelineId}:${jobId}`,
    authority: {
      requestMarkerHash: markerHash,
      sourceCommitSha: commitSha,
      buildRef,
      suiteKey,
      environmentRef,
      ...(expectedResultChecksum === undefined ? {} : { expectedResultChecksum }),
    },
  };
}

function readRequest(pipelineId: number): PipelineReadRequest {
  return {
    schemaVersion: "test-executor.trigger-status@1.0.0",
    messageType: "REQUEST",
    operation: "pipeline.read",
    automationAttemptId: `attempt-${pipelineId}`,
    externalPipelineId: String(pipelineId),
    targetSnapshotHash: digest("target"),
    configurationPinSetHash: digest("configuration"),
  };
}

beforeAll(async () => {
  fixture = await startUs3DatabaseFixture({
    entities: qaJiraGitLabLocalEntities,
    migrations: qaJiraGitLabLocalMigrations,
  });
  mockSource = createMockHubDataSource(fixture.postgres.url, gitLabMockMigrations);
  await mockSource.initialize();
  await mockSource.runMigrations({ transaction: "all" });
  await seedGitLabRepository(mockSource);
  mockApp = await NestFactory.create(GitLabModule.configured(mockSource), { logger: false });
  await mockApp.listen(0, "127.0.0.1");
  const server = mockApp.getHttpServer() as Readonly<{ address(): Readonly<{ port: number }> }>;
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  await runQaJiraGitLabLocalSeed(
    fixture.source,
    loadEnvironment({
      AWP_ENVIRONMENT: "LOCAL",
      AWP_COMPOSITION: "qa-jira-gitlab-local",
      AWP_EXTERNAL_NETWORK_MODE: "deny",
      AWP_DATABASE_URL: fixture.postgres.url,
      AWP_MOCK_HUB_URL: baseUrl,
      AWP_IDENTITY_ISSUER: "https://fake-idp:4443/oidc",
    }),
  );
  prepared = await prepareUs2AutomationSession(fixture, await authorityPins());
  mockRepository = new TypeOrmGitLabRepository(mockSource);
  mockControl = new GitLabControlController(
    mockRepository,
    new GitLabMockControlPolicy("local-gitlab-control", [5001]),
  );
  const profile = buildQaJiraGitLabLocalSeedConfiguration(baseUrl).profile;
  const auth = new GitLabAuth(connection(), {
    async resolve() {
      return {
        metadata: {},
        async use(_observedAt, consumer) {
          return await consumer(new TextEncoder().encode("mock-gitlab-read"));
        },
      };
    },
  });
  const client = new GitLabRestClient({
    baseUrl,
    numericProjectId: 5001,
    environmentClass: "LOCAL",
    allowedOrigins: [baseUrl],
    auth,
  });
  const dialect = createGitLabDialect({
    adapterFamily: "gitlab-rest-v4",
    apiFamily: "v4",
    edition: "EE",
    exactVersion: "18.1.0-mock.1",
    exactBuild: "mock-build-1",
    triggerDialect: "TYPED_INPUTS",
    webhookDialect: "STANDARD_WEBHOOKS_HMAC_SHA256",
  });
  normalizer = new GitLabResultNormalizer({ profile, client, dialect, clock: { now: () => now } });
  reader = new GitLabPipelineReader({
    profile,
    authority: () => ({
      sourceCommitSha: commitSha,
      suiteKey,
      environmentRef,
      targetSnapshotHash: digest("target"),
      configurationPinSetHash: digest("configuration"),
    }),
    clock: { now: () => now },
    transport: createGitLabRestPipelineReadTransport(client, dialect),
  });
}, 180_000);

afterAll(async () => {
  await mockApp?.close();
  if (mockSource?.isInitialized) await mockSource.destroy();
  await stopUs3DatabaseFixture(fixture);
}, 180_000);

describe("Feature 005 US3 real API/adapter/worker/Mock Hub journey", () => {
  it.each(gitLabUs3ScenarioIds)(
    "materializes and normalizes documented scenario %s through real HTTP",
    async (scenarioId) => {
      await mockControl.scenario("local-gitlab-control", { projectId: 5001, scenarioId });
      const scenario = gitLabScenarioCatalog[scenarioId];
      const expected = gitLabUs3ScenarioCatalog[scenarioId];
      const snapshot = await mockRepository.snapshot(5001);
      expect(snapshot.project).toEqual(
        expect.objectContaining({
          capabilities: expect.objectContaining({ [`scenario:${scenarioId}`]: true }),
        }),
      );
      expect(snapshot.pipelines).toHaveLength(scenario.attemptResults.length);
      expect(snapshot.machineResults).toHaveLength(scenario.attemptResults.length);

      for (const [index, resultFixture] of scenario.attemptResults.entries()) {
        const pipelineId = 101 + index;
        const jobId = 1001 + index;
        const observation = await reader.read(context("TEST_EXECUTION"), readRequest(pipelineId));
        expect(observation).toMatchObject({
          externalPipelineId: String(pipelineId),
          terminal: true,
        });
        const artifact = (
          snapshot.artifacts as readonly Readonly<{
            pipeline_id: string;
            checksum: `sha256:${string}`;
          }>[]
        ).find(({ pipeline_id }) => Number(pipeline_id) === pipelineId)!;
        const normalized = await normalizer.downloadAndNormalize(
          context("ARTIFACT_SOURCE"),
          normalizationRequest(
            pipelineId,
            jobId,
            resultFixture.artifactAvailability === "CHECKSUM_MISMATCH"
              ? artifact.checksum
              : undefined,
          ),
        );
        const expectedNormalizedOutcome =
          resultFixture.resultSchema === "DRIFTED" ||
          resultFixture.artifactAvailability === "CHECKSUM_MISMATCH"
            ? "INCOMPLETE"
            : resultFixture.outcome;
        expect(normalized.outcome).toBe(expectedNormalizedOutcome);
        if (resultFixture.resultSchema === "DRIFTED")
          expect(normalized).toMatchObject({ syntheticReasonCode: "RESULT_SCHEMA_DRIFT" });
        if (resultFixture.artifactAvailability === "CHECKSUM_MISMATCH")
          expect(normalized).toMatchObject({ syntheticReasonCode: "ARTIFACT_CHECKSUM_MISMATCH" });
      }
      expect(expected.expectedSignedVerdicts).toBe(0);
      expect(expected.expectedJiraTransitions).toBe(0);
    },
    180_000,
  );

  it("persists technical PASS through the API-facing query and QA result worker without Verdict or Jira effects", async () => {
    await mockControl.scenario("local-gitlab-control", {
      projectId: 5001,
      scenarioId: "us3-pass-review-required",
    });
    const query = new TypeOrmGitLabAutomationAttemptQuery(fixture!.source, {
      executingService: worker,
      async authorize() {},
    });
    const controller = new QaAutomationAttemptsController(fixture!.source, query);
    const actorRequest = await localQaTestRequest(fixture!.source, "executor.alpha");
    const confirmationResponse = response();
    const confirmation = await controller.launchConfirmation(
      actorRequest,
      fixture!.workspaceId,
      fixture!.projectId,
      us2AutomationSessionId,
      confirmationResponse,
    );
    const launchResponse = response();
    const launched = await controller.launch(
      actorRequest,
      fixture!.workspaceId,
      fixture!.projectId,
      us2AutomationSessionId,
      "us3-e2e-pass-launch",
      confirmationResponse.headers.get("ETag")!,
      Object.freeze({ confirmation }),
      launchResponse,
    );
    expect(launchResponse.statusCode).toBe(201);

    const attempts = new TypeOrmAutomationExecutionRepository(fixture!.source);
    const running = await fixture!.source.transaction(
      async (manager) =>
        await attempts.attachAutomationTriggerReceipt(
          manager,
          { workspaceId: fixture!.workspaceId, projectId: fixture!.projectId },
          launched.automationAttemptId,
          {
            externalPipelineId: "101",
            observedState: "RUNNING",
            providerCreatedAt: "2026-09-01T07:30:00.000Z",
            observedAt: "2026-09-01T07:31:00.000Z",
            observationHash: digest("us3-e2e-running"),
          },
          "2026-09-01T07:31:00.000Z",
        ),
    );
    const previousStatus = (
      await attempts.automationStatusHistory(
        { workspaceId: fixture!.workspaceId, projectId: fixture!.projectId },
        running.automationAttemptId,
      )
    ).at(-1)!;
    const normalized = await normalizer.downloadAndNormalize(
      context("ARTIFACT_SOURCE"),
      normalizationRequest(101, 1001),
    );
    expect(normalized).toMatchObject({ normalizationKind: "SCHEMA_VALIDATED", outcome: "PASS" });
    if (normalized.normalizationKind !== "SCHEMA_VALIDATED")
      throw new Error("US3_E2E_PASS_NORMALIZATION_INVALID");

    const [before] = (await fixture!.source.query(`SELECT
      (SELECT count(*)::int FROM qa_verdicts) AS verdicts,
      (SELECT count(*)::int FROM qa_verdict_signatures) AS signatures,
      (SELECT count(*)::int FROM connector_commands WHERE operation<>'pipeline.trigger') AS non_gitlab_commands`)) as readonly Record<
      string,
      number
    >[];
    const [launchAudit] = (await fixture!.source.query(
      `
SELECT authorization_basis FROM audit_events
WHERE action='qa.automation.launch' AND attributes->>'attemptId'=$1
ORDER BY occurred_at DESC LIMIT 1`,
      [running.automationAttemptId],
    )) as readonly Readonly<{ authorization_basis: unknown }>[];
    if (!launchAudit) throw new Error("US3_E2E_LAUNCH_AUTHORIZATION_BASIS_MISSING");
    const causalAuthorizationBasis = (
      typeof launchAudit.authorization_basis === "string"
        ? JSON.parse(launchAudit.authorization_basis)
        : launchAudit.authorization_basis
    ) as typeof us2AutomationAuthorizationBasis;
    const consumer = createTypeOrmGitLabAutomationResultSyncConsumer(fixture!.source);
    const artifactPin = running.configurationPins.find(
      ({ logicalRole }) => logicalRole === "ARTIFACT_SOURCE",
    )!;
    const receipt = await consumer.consume({
      facts: {
        context: {
          actor: worker,
          scope: {
            kind: "PROJECT",
            workspaceId: fixture!.workspaceId,
            projectId: fixture!.projectId,
          },
          correlationId: "f6900000-0000-4000-8000-000000000001",
          causationId: "f6900000-0000-4000-8000-000000000002",
        },
        attempt: running,
        previousStatus,
        targetSnapshot: prepared.planned.targetSnapshot,
        observation: {
          externalPipelineId: "101",
          externalJobIds: ["1001"],
          providerStatus: "SUCCESS",
          providerRevisionToken: "success:1",
          providerUpdatedAt: normalized.result.finishedAt,
          terminal: true,
          observedAt: normalized.result.finishedAt,
          observationHash: digest("us3-e2e-terminal"),
          source: "POLL_READ",
          sourceReceiptRef: "gitlab-observation:101:success:1",
        },
        normalization: {
          normalizationKind: normalized.normalizationKind,
          normalizationStatus: normalized.normalizationStatus,
          issueCodes: normalized.issueCodes,
          outcome: normalized.outcome,
          resultSchemaRef: running.resultSchemaRef,
          sourceResultArtifactRef: normalized.sourceResultArtifactRef,
          resultContentHash: normalized.resultContentHash!,
          externalPipelineId: "101",
          externalJobIds: ["1001"],
          target: prepared.planned.targetSnapshot.target,
          suiteKey: prepared.planned.targetSnapshot.suite.suiteKey,
          environmentRef: prepared.planned.targetSnapshot.environment.environmentRef,
          durationMs: normalized.result.durationMs,
          terminalAt: normalized.result.finishedAt,
        },
        artifactDescriptors: [
          {
            artifactReferenceId: "f6900000-0000-4000-8000-000000000003",
            descriptorHash: digest("us3-e2e-result-descriptor"),
            externalPipelineId: "101",
            externalJobId: "1001",
            logicalPath: "awp/results/result.json",
            checksum: normalized.resultContentHash!,
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
            retentionPolicyRef: running.artifactPolicyRef,
            availability: "AVAILABLE",
            opaqueLocatorHash: digest("us3-e2e-result-locator"),
            expiresAt: "2026-09-08T07:34:00.000Z",
            registeredAt: "2026-09-01T07:34:00.000Z",
          },
        ],
        machineArtifactManifest: [],
        previousLineageResults: [],
        session: { state: "RUNNING", resourceVersion: 2 },
        recordedAt: "2026-09-01T07:34:01.000Z",
      },
      lineage: [running],
      retry: {
        policy: {
          policyRef: running.retryPolicyRef,
          policyHash: running.retryPolicyHash,
          automaticRetryBudget: 1,
          allowedInfrastructureCodes: ["RUNNER_UNAVAILABLE"],
        },
        authority: {
          authorizationAllowed: true,
          policyAllowed: true,
          quarantineActive: false,
          configurationPinsCurrent: true,
          targetCurrent: true,
          authorizationRecheckHash: digest("us3-e2e-retry-auth"),
        },
        executingService: worker,
        causalAuthorizationBasis,
        decidedAt: "2026-09-01T07:34:02.000Z",
      },
    });
    expect(receipt).toMatchObject({
      prepared: { result: { outcome: "PASS" } },
      result: { sessionState: "REVIEW_REQUIRED" },
      retry: { replayed: false },
    });
    const apiResult = await controller.result(
      actorRequest,
      fixture!.workspaceId,
      fixture!.projectId,
      us2AutomationSessionId,
      running.automationAttemptId,
    );
    expect(apiResult).toMatchObject({
      outcome: "PASS",
      automationAttemptId: running.automationAttemptId,
    });
    const apiRetry = await controller.retryDecision(
      actorRequest,
      fixture!.workspaceId,
      fixture!.projectId,
      us2AutomationSessionId,
      running.automationAttemptId,
    );
    expect(apiRetry).toMatchObject({
      decision: "NOT_APPLICABLE",
      automationAttemptId: running.automationAttemptId,
    });

    const [after] = (await fixture!.source.query(
      `SELECT
      (SELECT count(*)::int FROM qa_verdicts) AS verdicts,
      (SELECT count(*)::int FROM qa_verdict_signatures) AS signatures,
      (SELECT count(*)::int FROM connector_commands WHERE operation<>'pipeline.trigger') AS non_gitlab_commands,
      (SELECT state FROM qa_test_sessions WHERE session_id=$1) AS session_state`,
      [us2AutomationSessionId],
    )) as readonly Record<string, unknown>[];
    expect(after).toEqual({ ...before, session_state: "REVIEW_REQUIRED" });
  }, 180_000);
});
