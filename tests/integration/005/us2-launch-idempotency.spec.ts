import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createAutomatedRequiredSession,
  createAutomationLaunchConfirmation,
  createAutomationSuiteDraft,
  createAutomationSuiteHeader,
  makeScopeSnapshot,
  planAutomatedSession,
  type PlannedAutomatedSession,
  publishAutomationSuiteVersion,
  qaAggregateSnapshotHash,
  type QaAutomatedConfigurationPin,
  type QaAutomationSuiteContent,
  qaAutomationSuiteValidationCheckOrder,
  type QaAutomationSuiteVersion,
  recordAutomationSuiteValidation,
  TypeOrmAutomatedSessionUnitOfWork,
  TypeOrmAutomationSuiteRepository,
} from "../../../packages/competency-qa/src/node.ts";
import { TypeOrmGitLabAutomationLaunchService } from "../../../packages/runtime-composition/src/gitlab/automation-launch-service.ts";
import { localPersonaIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { qaLocalSeedIds } from "../../../packages/runtime-composition/src/seed/qa-local-seed.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
  type Us3DatabaseFixture,
} from "../../support/002-us3-database.ts";

const digest = (value: string) => qaAggregateSnapshotHash(value as never);
const suiteId = "b6100000-0000-4000-8000-000000000001";
const requirementId = "b6200000-0000-4000-8000-000000000001";
const sessionId = "b6300000-0000-4000-8000-000000000001";
const createdAt = "2026-09-01T13:00:00.000Z";
const scope = () =>
  Object.freeze({ workspaceId: fixture!.workspaceId, projectId: fixture!.projectId } as const);

let fixture: Us3DatabaseFixture | undefined;
let suite: QaAutomationSuiteVersion;
let validationReportRef: Readonly<{ id: string; version: number; contentHash: `sha256:${string}` }>;
let planRef: Readonly<{ id: string; version: number; contentHash: `sha256:${string}` }>;
let planned: PlannedAutomatedSession;

const exact = (id: string, version: number, seed: string) =>
  Object.freeze({ id, version, contentHash: digest(seed) } as const);

function suiteContent(): QaAutomationSuiteContent {
  return Object.freeze({
    ownerPrincipalId: localPersonaIds["executor.alpha"],
    suiteDefinitionRef: exact("launch-suite-definition", 1, "launch-suite-definition"),
    logicalExecutionContract: Object.freeze({
      pipelineKey: "qa.validation",
      sourceRefPolicyRef: "policy:source-ref:qa-smoke:v1",
      resultJobKey: "machine-result",
      contractHash: digest("launch-execution-contract"),
    } as const),
    allowedTargetTypes: Object.freeze(["MERGE_REQUEST"] as const),
    allowedEnvironmentRefs: Object.freeze(["environment:test:qa-1@17"] as const),
    parameterSchemaRef: exact("launch-parameters", 1, "launch-parameters"),
    resultSchemaRef: exact("launch-result", 1, "launch-result"),
    artifactPolicyRef: exact("launch-artifact-policy", 1, "launch-artifact-policy"),
    retryPolicyRef: exact("launch-retry-policy", 1, "launch-retry-policy"),
    quarantinePolicyRef: exact("launch-quarantine-policy", 1, "launch-quarantine-policy"),
    capabilityRequirements: Object.freeze([
      "source-context.read@1.0.0",
      "test-executor.trigger-status@1.0.0",
      "artifact.ci-read@1.0.0",
    ] as const),
  } as const);
}

async function publishSuite(f: Us3DatabaseFixture): Promise<QaAutomationSuiteVersion> {
  const header = createAutomationSuiteHeader({
    id: suiteId,
    workspaceId: f.workspaceId,
    projectId: f.projectId,
    suiteKey: "launch-smoke",
    createdBy: us3Actor,
    createdAt,
  });
  const draft = createAutomationSuiteDraft({
    header,
    previousVersions: [],
    content: suiteContent(),
    createdBy: us3Actor,
    createdAt,
  });
  const validated = recordAutomationSuiteValidation(draft, {
    id: "us2-launch-suite-report",
    workspaceId: f.workspaceId,
    projectId: f.projectId,
    suiteBindingRef: Object.freeze({
      id: draft.id,
      version: 1,
      contentHash: draft.contentHash,
    } as const),
    status: "VALID",
    coreBindingRef: exact(qaLocalSeedIds.alphaBinding, 2, "launch-binding"),
    profilePinSetHash: digest("launch-profile-pins"),
    discoverySnapshotRef: "discovery:us2-launch",
    discoverySnapshotHash: digest("launch-discovery"),
    suiteProbeRef: "probe:us2-launch",
    suiteProbeHash: digest("launch-probe"),
    checks: Object.freeze(
      qaAutomationSuiteValidationCheckOrder.map((key) =>
        Object.freeze({ key, passed: true } as const),
      ),
    ),
    issues: Object.freeze([] as const),
    validatedBy: Object.freeze({
      kind: "SERVICE",
      principalId: localPersonaIds["worker.local"],
      serviceKey: "suite-validation",
    } as const),
    authorizationBasisHash: digest("launch-suite-authorization"),
    createdAt: "2026-09-01T13:00:01.000Z",
  });
  const published = publishAutomationSuiteVersion({
    header,
    versions: [validated.version],
    reports: [validated.report],
    versionId: validated.version.id,
    expectedResourceVersion: 1,
    evidence: Object.freeze({
      coreBindingRef: validated.report.coreBindingRef,
      profilePinSetHash: validated.report.profilePinSetHash,
      discoverySnapshotHash: validated.report.discoverySnapshotHash,
      suiteProbeHash: validated.report.suiteProbeHash,
      discoveryCurrent: true,
      nonProduction: true,
      noDeploySurface: true,
    } as const),
    publishedAt: "2026-09-01T13:00:02.000Z",
  });
  await f.source.transaction(async (manager) => {
    const repository = new TypeOrmAutomationSuiteRepository(manager);
    await repository.insertHeader(header);
    await repository.insertVersion(draft);
    await repository.persistValidation({
      scope: f,
      previousVersion: draft,
      nextVersion: validated.version,
      report: validated.report,
    });
    await repository.persistPublication({
      scope: f,
      previousHeader: header,
      nextHeader: published.header,
      previousVersions: [validated.version],
      nextVersions: published.versions,
    });
  });
  validationReportRef = Object.freeze({
    id: validated.report.id,
    version: 1,
    contentHash: validated.report.contentHash,
  } as const);
  return published.versions[0]!;
}

function configurationPins(): readonly QaAutomatedConfigurationPin[] {
  const roles = [
    ["SOURCE_CONTEXT", "source-context.read"],
    ["TEST_EXECUTION", "test-executor.trigger-status"],
    ["ARTIFACT_SOURCE", "artifact.ci-read"],
  ] as const;
  const bindingRef = exact(qaLocalSeedIds.alphaBinding, 2, "launch-binding-pin");
  return Object.freeze(
    roles.map(([logicalRole, capabilityKey], index) =>
      Object.freeze({
        ordinal: index + 1,
        logicalRole,
        capabilityKey,
        exactContractVersion: "1.0.0" as const,
        projectIntegrationBindingRef: bindingRef,
        profileRef: exact(
          `b6400000-0000-4000-8000-00000000000${index + 1}`,
          1,
          `launch-profile-${index}`,
        ),
        connectionRef: exact(
          `b6500000-0000-4000-8000-00000000000${index + 1}`,
          1,
          `launch-connection-${index}`,
        ),
        validationReportRef,
        operationSetHash: digest(`launch-operations-${index}`),
        externalScopeHash: digest("launch-project-5001"),
      } as const),
    ),
  );
}

function planSession(f: Us3DatabaseFixture): PlannedAutomatedSession {
  const requirement = createAutomatedRequiredSession({
    workspaceId: f.workspaceId,
    projectId: f.projectId,
    workItemId: f.workItemId,
    requiredSessionPlanId: planRef.id,
    planVersion: planRef.version,
    requirementId,
    suiteBindingKey: suite.suiteKey,
    allowedTargetTypes: ["MERGE_REQUEST"],
    allowedEnvironmentRefs: ["environment:test:qa-1@17"],
    createdAt,
  });
  return planAutomatedSession({
    sessionId,
    planRef,
    requirement,
    suite,
    configurationPins: configurationPins(),
    existingSessionOrdinals: [1],
    ownerId: suite.content.ownerPrincipalId,
    sourceIssueKey: "QA-5001",
    target: Object.freeze({
      type: "MERGE_REQUEST",
      mergeRequestRef: "5001:17",
      commitSha: "a".repeat(40),
    } as const),
    environment: Object.freeze({
      environmentRef: "environment:test:qa-1@17",
      revision: 17,
      class: "TEST",
    } as const),
    acceptedParameters: Object.freeze({ shard: 2, locale: "en-US" } as const),
    parameterValidation: Object.freeze({
      valid: true,
      schemaRef: suite.content.parameterSchemaRef,
    } as const),
    testDataRefs: Object.freeze([
      {
        kind: "test-data",
        id: "launch-dataset",
        version: "1",
        contentHash: digest("launch-test-data"),
      },
    ] as const),
    accountLeaseRefs: Object.freeze([] as const),
    scopeSnapshot: makeScopeSnapshot({
      purpose: "Launch exact automated smoke validation.",
      agreedScope: "One non-production GitLab pipeline.",
      acceptanceOutcome: "A schema-bound technical result is recorded.",
      inclusions: ["smoke"],
      exclusions: ["deployment", "production"],
      checklistDefinition: {
        kind: "checklist",
        id: "launch-smoke",
        version: "1",
        contentHash: digest("launch-checklist"),
      },
    }),
    actor: us3Actor,
    createdAt,
  });
}

const authorizationBasis = Object.freeze({
  kind: "PROJECT" as const,
  policyVersion: "qa-automation-launch@1",
  membershipRef: Object.freeze({ id: "b6600000-0000-4000-8000-000000000001", version: 1 } as const),
  roleAssignmentRefs: Object.freeze([
    { id: "b6600000-0000-4000-8000-000000000002", version: 1 },
  ] as const),
  entitlementRefs: Object.freeze([
    { id: "b6600000-0000-4000-8000-000000000003", version: 1 },
  ] as const),
  skillContext: "NOT_APPLICABLE" as const,
} as const);

beforeAll(async () => {
  fixture = await startUs3DatabaseFixture();
  suite = await publishSuite(fixture);
  const [row] = (await fixture.source.query(
    "SELECT plan_version_id,version,content_hash FROM qa_required_session_plan_versions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY version DESC LIMIT 1",
    [fixture.workspaceId, fixture.projectId, fixture.workItemId],
  )) as readonly { plan_version_id: string; version: number; content_hash: `sha256:${string}` }[];
  planRef = Object.freeze({
    id: row!.plan_version_id,
    version: row!.version,
    contentHash: row!.content_hash,
  } as const);
  const requirement = createAutomatedRequiredSession({
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    workItemId: fixture.workItemId,
    requiredSessionPlanId: planRef.id,
    planVersion: planRef.version,
    requirementId,
    suiteBindingKey: suite.suiteKey,
    allowedTargetTypes: ["MERGE_REQUEST"],
    allowedEnvironmentRefs: ["environment:test:qa-1@17"],
    createdAt,
  });
  await fixture.source.query(
    `INSERT INTO qa_required_session_plan_requirements(requirement_id,workspace_id,project_id,work_item_id,plan_version_id,requirement_key,ordinal,mode,minimum_session_count,resolution,content_hash,content,contract_schema_version,automation_suite_binding_key,automation_suite_selection_policy) VALUES($1,$2,$3,$4,$5,$6,2,'AUTOMATED',1,'REQUIRED',$7,$8,2,$6,$9)`,
    [
      requirementId,
      fixture.workspaceId,
      fixture.projectId,
      fixture.workItemId,
      planRef.id,
      suite.suiteKey,
      requirement.contentHash,
      JSON.stringify(requirement),
      JSON.stringify({ kind: "CURRENT_PUBLISHED_AT_SESSION_CREATION" }),
    ],
  );
  // Launch idempotency begins after FULL_QA admission, covered independently by feature 007.
  await fixture.source.query(
    "UPDATE project_onboarding_headers SET current_capability_mode='FULL_QA' WHERE workspace_id=$1 AND project_id=$2",
    [fixture.workspaceId, fixture.projectId],
  );
  planned = planSession(fixture);
  await new TypeOrmAutomatedSessionUnitOfWork(fixture.source).persist(planned, {
    authorizationBasis,
    authorizationBasisHash: qaAggregateSnapshotHash(authorizationBasis as never),
    correlationId: "b6700000-0000-4000-8000-000000000001",
    causationId: "b6700000-0000-4000-8000-000000000002",
  });
}, 120_000);

afterAll(async () => {
  await stopUs3DatabaseFixture(fixture);
}, 120_000);

describe("US2 automation launch idempotency", () => {
  it("uses exact HUMAN confirmation without approval and actor-independently replays one atomic launch", async () => {
    let authorizationChecks = 0;
    const service = new TypeOrmGitLabAutomationLaunchService(fixture!.source, {
      executingService: Object.freeze({
        kind: "SERVICE",
        principalId: localPersonaIds["worker.local"],
        serviceKey: "gitlab-automation",
      } as const),
      async authorize(_manager, input) {
        authorizationChecks += 1;
        if (input.actor.kind !== "HUMAN") throw new Error("QA_AUTOMATION_VERIFIED_HUMAN_REQUIRED");
      },
    });
    const confirmation = await service.currentConfirmation(scope(), sessionId);
    expect(confirmation).toEqual(
      createAutomationLaunchConfirmation({
        reason: "INITIAL",
        targetSnapshotHash: planned.session.targetSnapshotHash,
        suiteBindingHash: planned.session.suiteBindingRef.contentHash,
        configurationPinSetHash: planned.session.configurationPinSetHash,
        sessionResourceVersion: 1,
      }),
    );
    const launchInput = Object.freeze({
      scope: scope(),
      sessionId,
      idempotencyKey: "us2-actor-independent-launch",
      ifMatch: 1,
      confirmation,
      actor: us3Actor,
      authorizationBasis,
      authorizationBasisHash: qaAggregateSnapshotHash(authorizationBasis as never),
      correlationId: "b6800000-0000-4000-8000-000000000001",
      causationId: "b6800000-0000-4000-8000-000000000002",
      launchedAt: "2026-09-01T13:01:00.000Z",
    } as const);
    const created = await service.launch(launchInput);
    expect(created).toMatchObject({
      replayed: false,
      attempt: { attemptNo: 1, reason: "INITIAL", currentStatus: "TRIGGER_PENDING" },
    });

    const secondHuman = Object.freeze({
      kind: "HUMAN" as const,
      principalId: localPersonaIds["owner.local"],
      issuer: "https://fake-idp:4443/oidc",
      subject: "owner.local",
    } as const);
    const replayed = await service.launch(
      Object.freeze({
        ...launchInput,
        actor: secondHuman,
        correlationId: "b6800000-0000-4000-8000-000000000003",
        causationId: "b6800000-0000-4000-8000-000000000004",
      } as const),
    );
    expect(replayed).toEqual(expect.objectContaining({ replayed: true, attempt: created.attempt }));
    expect(authorizationChecks).toBe(2);

    const changedConfirmation = createAutomationLaunchConfirmation({
      ...confirmation,
      sessionResourceVersion: 2,
    });
    await expect(
      service.launch(
        Object.freeze({ ...launchInput, confirmation: changedConfirmation, ifMatch: 2 } as const),
      ),
    ).rejects.toThrow("QA_AUTOMATION_LAUNCH_IDEMPOTENCY_CONFLICT");

    const counts = (await fixture!.source.query(
      `SELECT
      (SELECT count(*)::int FROM qa_automation_launch_requests WHERE session_id=$1) AS claims,
      (SELECT count(*)::int FROM qa_automation_attempts WHERE session_id=$1) AS attempts,
      (SELECT count(*)::int FROM connector_commands WHERE operation='pipeline.trigger') AS commands,
      (SELECT count(*)::int FROM command_outbox outbox JOIN connector_commands command ON command.id=outbox.command_id WHERE command.operation='pipeline.trigger') AS command_outbox,
      (SELECT count(*)::int FROM event_outbox WHERE event_type='qa.automation-attempt.created' AND envelope->'payload'->>'testSessionId'=$1) AS attempt_events,
      (SELECT count(*)::int FROM approvals WHERE action_kind='qa.automation.launch') AS approvals`,
      [sessionId],
    )) as readonly Record<string, number>[];
    expect(counts).toEqual([
      { claims: 1, attempts: 1, commands: 1, command_outbox: 1, attempt_events: 1, approvals: 0 },
    ]);
    const [session] = (await fixture!.source.query(
      "SELECT state,resource_version,started_at FROM qa_test_sessions WHERE session_id=$1",
      [sessionId],
    )) as readonly Record<string, unknown>[];
    expect(session).toEqual(
      expect.objectContaining({
        state: "RUNNING",
        resource_version: "2",
        started_at: new Date("2026-09-01T13:01:00.000Z"),
      }),
    );
  }, 120_000);
});
