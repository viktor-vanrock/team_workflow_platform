import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { QaAutomatedSessionsController } from "../../apps/api/src/extensions/gitlab-automation/qa-automated-sessions.controller.ts";
import { QaAutomationAvailabilityController } from "../../apps/api/src/extensions/gitlab-automation/qa-automation-availability.controller.ts";
import {
  TypeOrmQaAutomatedSessionsApi,
  TypeOrmQaAutomationAvailabilityApi,
  TypeOrmQaAutomationSuiteApi,
} from "../../apps/api/src/extensions/gitlab-automation/qa-automation-local.adapters.ts";
import { QaAutomationSuiteBindingsController } from "../../apps/api/src/extensions/gitlab-automation/qa-automation-suite-bindings.controller.ts";
import { QaSessionsController } from "../../apps/api/src/extensions/qa-sessions.controller.ts";
import { createLocalQaSessionRuntime } from "../../apps/api/src/local/local-qa-session-runtime.ts";
import {
  GitLabControlController,
  GitLabMockControlPolicy,
} from "../../apps/mock-hub/src/gitlab/control/gitlab-control.controller.ts";
import {
  gitLabMockMigrations,
  gitLabScenarioCatalog,
  gitLabUs1ScenarioIds,
  seedGitLabRepository,
  TypeOrmGitLabRepository,
} from "../../apps/mock-hub/src/gitlab/gitlab.module.ts";
import { createMockHubDataSource } from "../../apps/mock-hub/src/persistence/data-source.ts";
import {
  createAutomatedRequiredSession,
  createAutomationSuiteDraft,
  createAutomationSuiteHeader,
  publishAutomationSuiteVersion,
  qaAggregateSnapshotHash,
  type QaAutomationSuiteContent,
  qaAutomationSuiteValidationCheckOrder,
  type QaAutomationSuiteVersion,
  recordAutomationSuiteValidation,
  TypeOrmAutomationSuiteRepository,
} from "../../packages/competency-qa/src/node.ts";
import { createPlatformDataSource } from "../../packages/platform-persistence-typeorm/src/index.ts";
import { loadEnvironment } from "../../packages/runtime-composition/src/config/environment.ts";
import {
  qaJiraGitLabLocalEntities,
  qaJiraGitLabLocalMigrations,
} from "../../packages/runtime-composition/src/gitlab/composition.ts";
import { localPersonaIds } from "../../packages/runtime-composition/src/seed/local-seed.ts";
import {
  qaJiraGitLabLocalSeedIds,
  runQaJiraGitLabLocalSeed,
} from "../../packages/runtime-composition/src/seed/qa-jira-gitlab-local-seed.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
  type Us3DatabaseFixture,
} from "../support/002-us3-database.ts";
import { localQaTestRequest } from "../support/008-qa-request.ts";

const digest = (value: string) => qaAggregateSnapshotHash(value as never);
const suiteId = "b5100000-0000-4000-8000-000000000001";
const requirementId = "b5200000-0000-4000-8000-000000000001";
const at = "2026-09-01T12:00:00.000Z";

let fixture: Us3DatabaseFixture | undefined;
let source: ReturnType<typeof createPlatformDataSource>;
let mockSource: ReturnType<typeof createMockHubDataSource>;
let suite: QaAutomationSuiteVersion;
let mockControl: GitLabControlController;

const exact = (id: string, version: number, seed: string) =>
  Object.freeze({ id, version, contentHash: digest(seed) } as const);

function suiteContent(): QaAutomationSuiteContent {
  return Object.freeze({
    ownerPrincipalId: localPersonaIds["executor.alpha"],
    suiteDefinitionRef: exact("smoke-suite-definition", 1, "suite-definition"),
    logicalExecutionContract: Object.freeze({
      pipelineKey: "qa.validation",
      sourceRefPolicyRef: "policy:source-ref:qa-smoke:v1",
      resultJobKey: "machine-result",
      contractHash: digest("suite-logical-contract"),
    } as const),
    allowedTargetTypes: Object.freeze(["MERGE_REQUEST", "COMMIT", "BUILD"] as const),
    allowedEnvironmentRefs: Object.freeze(["environment:test:qa-1@17"] as const),
    parameterSchemaRef: exact("accepted-parameters", 1, "parameter-schema"),
    resultSchemaRef: exact("machine-result", 1, "result-schema"),
    artifactPolicyRef: exact("artifact-policy", 1, "artifact-policy"),
    retryPolicyRef: exact("retry-policy", 1, "retry-policy"),
    quarantinePolicyRef: exact("quarantine-policy", 1, "quarantine-policy"),
    capabilityRequirements: Object.freeze([
      "source-context.read@1.0.0",
      "test-executor.trigger-status@1.0.0",
      "artifact.ci-read@1.0.0",
    ] as const),
  } as const);
}

async function publishSuite(): Promise<QaAutomationSuiteVersion> {
  const bindingRows = (await source.query(
    "SELECT header_id,version,content_hash FROM project_integration_binding_revisions WHERE header_id=$1 AND status='PUBLISHED'",
    [qaJiraGitLabLocalSeedIds.binding],
  )) as readonly Readonly<{
    header_id: string;
    version: number;
    content_hash: `sha256:${string}`;
  }>[];
  const binding = bindingRows[0]!;
  const header = createAutomationSuiteHeader({
    id: suiteId,
    workspaceId: fixture!.workspaceId,
    projectId: fixture!.projectId,
    suiteKey: "smoke",
    createdBy: us3Actor,
    createdAt: at,
  });
  const draft = createAutomationSuiteDraft({
    header,
    previousVersions: [],
    content: suiteContent(),
    createdBy: us3Actor,
    createdAt: at,
  });
  const validation = recordAutomationSuiteValidation(draft, {
    id: "us1-e2e-suite-validation",
    workspaceId: fixture!.workspaceId,
    projectId: fixture!.projectId,
    suiteBindingRef: Object.freeze({
      id: draft.id,
      version: draft.version,
      contentHash: draft.contentHash,
    } as const),
    status: "VALID",
    coreBindingRef: Object.freeze({
      id: binding.header_id,
      version: binding.version,
      contentHash: binding.content_hash,
    } as const),
    profilePinSetHash: digest("profile-pin-set"),
    discoverySnapshotRef: `discovery:${qaJiraGitLabLocalSeedIds.discovery}`,
    discoverySnapshotHash: digest("discovery-evidence"),
    suiteProbeRef: `suite-probe:${qaJiraGitLabLocalSeedIds.suiteProbe}`,
    suiteProbeHash: digest("suite-probe-evidence"),
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
    authorizationBasisHash: digest("suite-validation-authorization"),
    createdAt: "2026-09-01T12:00:01.000Z",
  });
  const published = publishAutomationSuiteVersion({
    header,
    versions: [validation.version],
    reports: [validation.report],
    versionId: validation.version.id,
    expectedResourceVersion: 1,
    evidence: Object.freeze({
      coreBindingRef: validation.report.coreBindingRef,
      profilePinSetHash: validation.report.profilePinSetHash,
      discoverySnapshotHash: validation.report.discoverySnapshotHash,
      suiteProbeHash: validation.report.suiteProbeHash,
      discoveryCurrent: true,
      nonProduction: true,
      noDeploySurface: true,
    } as const),
    publishedAt: "2026-09-01T12:00:02.000Z",
  });
  await source.transaction(async (manager) => {
    const repository = new TypeOrmAutomationSuiteRepository(manager);
    await repository.insertHeader(header);
    await repository.insertVersion(draft);
    await repository.persistValidation({
      scope: fixture!,
      previousVersion: draft,
      nextVersion: validation.version,
      report: validation.report,
    });
    await repository.persistPublication({
      scope: fixture!,
      previousHeader: header,
      nextHeader: published.header,
      previousVersions: [validation.version],
      nextVersions: published.versions,
    });
  });
  return published.versions[0]!;
}

async function addAutomatedRequirement(): Promise<void> {
  const planRows = (await source.query(
    "SELECT plan_version_id,version,content_hash FROM qa_required_session_plan_versions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY version DESC LIMIT 1",
    [fixture!.workspaceId, fixture!.projectId, fixture!.workItemId],
  )) as readonly Readonly<{
    plan_version_id: string;
    version: number;
    content_hash: `sha256:${string}`;
  }>[];
  const plan = planRows[0]!;
  const requirement = createAutomatedRequiredSession({
    workspaceId: fixture!.workspaceId,
    projectId: fixture!.projectId,
    workItemId: fixture!.workItemId,
    requiredSessionPlanId: plan.plan_version_id,
    planVersion: plan.version,
    requirementId,
    suiteBindingKey: suite.suiteKey,
    allowedTargetTypes: ["MERGE_REQUEST", "COMMIT", "BUILD"],
    allowedEnvironmentRefs: ["environment:test:qa-1@17"],
    createdAt: at,
  });
  await source.query(
    `
INSERT INTO qa_required_session_plan_requirements(
  requirement_id,workspace_id,project_id,work_item_id,plan_version_id,requirement_key,ordinal,
  mode,minimum_session_count,resolution,content_hash,content,contract_schema_version,
  automation_suite_binding_key,automation_suite_selection_policy
) VALUES($1,$2,$3,$4,$5,$6,2,'AUTOMATED',1,'REQUIRED',$7,$8,2,$6,$9)`,
    [
      requirementId,
      fixture!.workspaceId,
      fixture!.projectId,
      fixture!.workItemId,
      plan.plan_version_id,
      suite.suiteKey,
      requirement.contentHash,
      JSON.stringify(requirement),
      JSON.stringify({ kind: "CURRENT_PUBLISHED_AT_SESSION_CREATION" }),
    ],
  );
}

beforeAll(async () => {
  fixture = await startUs3DatabaseFixture();
  source = createPlatformDataSource({
    url: fixture.postgres.url,
    entities: qaJiraGitLabLocalEntities,
    migrations: qaJiraGitLabLocalMigrations,
  });
  await source.initialize();
  await source.runMigrations({ transaction: "all" });
  await runQaJiraGitLabLocalSeed(
    source,
    loadEnvironment({
      AWP_ENVIRONMENT: "LOCAL",
      AWP_COMPOSITION: "qa-jira-gitlab-local",
      AWP_EXTERNAL_NETWORK_MODE: "deny",
      AWP_MOCK_HUB_URL: "http://mock-hub:4010",
    }),
  );
  mockSource = createMockHubDataSource(fixture.postgres.url, gitLabMockMigrations);
  await mockSource.initialize();
  await mockSource.runMigrations({ transaction: "all" });
  await seedGitLabRepository(mockSource);
  mockControl = new GitLabControlController(
    new TypeOrmGitLabRepository(mockSource),
    new GitLabMockControlPolicy("local-gitlab-control", [5001]),
  );
  await mockControl.scenario("local-gitlab-control", {
    projectId: 5001,
    scenarioId: "us1-automated-session",
  });
  suite = await publishSuite();
  await addAutomatedRequirement();
}, 180_000);

afterAll(async () => {
  if (mockSource?.isInitialized) await mockSource.destroy();
  if (source?.isInitialized) await source.destroy();
  await stopUs3DatabaseFixture(fixture);
}, 180_000);

describe("Feature 005 US1 API/PostgreSQL/Mock Hub journey", () => {
  it("creates one READY automated Session from FULL_QA while negative allowlists have no partial rows and manual QA remains usable", async () => {
    const executorRequest = await localQaTestRequest(source, "executor.alpha");
    const sessions = new QaAutomatedSessionsController(
      source,
      new TypeOrmQaAutomatedSessionsApi(source),
    );
    const validBody = Object.freeze({
      workItemId: fixture!.workItemId,
      suiteBindingRef: Object.freeze({ id: suite.suiteBindingId, version: suite.version } as const),
      target: Object.freeze({
        type: "MERGE_REQUEST",
        mergeRequestRef: "!17",
        commitSha: "a".repeat(40),
      } as const),
      environmentRef: "environment:test:qa-1@17",
      parameters: Object.freeze({ shard: 2, locale: "en-US" } as const),
      browser: "chromium",
    } as const);
    // Historical bootstrap is MANUAL_ONLY; this journey must explicitly enter FULL_QA.
    await expect(
      sessions.create(
        executorRequest,
        fixture!.workspaceId,
        fixture!.projectId,
        "us1-mode-denied-request",
        validBody,
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: "AUTOMATION_REQUIRES_FULL_QA" },
    });
    expect(
      await source.query(
        "SELECT count(*)::int AS count FROM qa_test_sessions WHERE mode='AUTOMATED' AND workspace_id=$1 AND project_id=$2",
        [fixture!.workspaceId, fixture!.projectId],
      ),
    ).toEqual([{ count: 0 }]);
    // Capability admission itself is exercised by feature 007's onboarding journeys.
    await source.query(
      "UPDATE project_onboarding_headers SET current_capability_mode='FULL_QA' WHERE workspace_id=$1 AND project_id=$2",
      [fixture!.workspaceId, fixture!.projectId],
    );

    const availabilityController = new QaAutomationAvailabilityController(
      source,
      new TypeOrmQaAutomationAvailabilityApi(source),
    );
    const availability = (await availabilityController.current(
      executorRequest,
      fixture!.workspaceId,
      fixture!.projectId,
    )) as Readonly<{ capabilityMode: string; liveAvailability: string; launchPermitted: boolean }>;
    expect(availability).toMatchObject({
      capabilityMode: "FULL_QA",
      liveAvailability: "AVAILABLE",
      launchPermitted: true,
    });

    const suiteController = new QaAutomationSuiteBindingsController(
      source,
      new TypeOrmQaAutomationSuiteApi(source),
    );
    const suites = (await suiteController.list(
      executorRequest,
      fixture!.workspaceId,
      fixture!.projectId,
    )) as readonly Readonly<{ versions: readonly Readonly<{ state: string }>[] }>[];
    expect(suites).toEqual([
      expect.objectContaining({ versions: [expect.objectContaining({ state: "PUBLISHED" })] }),
    ]);

    const manualController = new QaSessionsController(source, createLocalQaSessionRuntime());
    const manualBefore = await manualController.list(
      executorRequest,
      fixture!.workspaceId,
      fixture!.projectId,
      fixture!.workItemId,
    );
    expect(manualBefore).toEqual([
      expect.objectContaining({ sessionId: fixture!.sessionId, mode: "MANUAL", state: "RUNNING" }),
    ]);

    await expect(
      sessions.create(
        executorRequest,
        fixture!.workspaceId,
        fixture!.projectId,
        "us1-suite-denied-request",
        {
          ...validBody,
          suiteBindingRef: { id: "b5900000-0000-4000-8000-000000000001", version: 1 },
        },
      ),
    ).rejects.toThrow("QA_AUTOMATED_SESSION_SUITE_NOT_PUBLISHED");
    await expect(
      sessions.create(
        executorRequest,
        fixture!.workspaceId,
        fixture!.projectId,
        "us1-environment-denied-request",
        { ...validBody, environmentRef: "environment:test:foreign@1" },
      ),
    ).rejects.toThrow("QA_AUTOMATED_SESSION_ENVIRONMENT_FORBIDDEN");
    const before = (await source.query(
      "SELECT count(*)::int AS count FROM qa_test_sessions WHERE mode='AUTOMATED' AND workspace_id=$1 AND project_id=$2",
      [fixture!.workspaceId, fixture!.projectId],
    )) as readonly Readonly<{ count: number }>[];
    expect(before).toEqual([{ count: 0 }]);

    const created = (await sessions.create(
      executorRequest,
      fixture!.workspaceId,
      fixture!.projectId,
      "us1-automated-session-request",
      validBody,
    )) as Readonly<{
      session: Readonly<{ id: string; mode: string; state: string }>;
      planItem: Readonly<{ mode: string }>;
      configurationPins: readonly unknown[];
      targetSnapshot: Readonly<{
        target: Readonly<{ type: string; commitSha: string }>;
        environment: Readonly<{ environmentRef: string }>;
      }>;
    }>;
    expect(created.session).toMatchObject({ mode: "AUTOMATED", state: "READY" });
    expect(created.planItem).toMatchObject({ mode: "AUTOMATED" });
    expect(created.configurationPins).toHaveLength(3);
    expect(created.targetSnapshot).toMatchObject({
      target: { type: "MERGE_REQUEST", commitSha: "a".repeat(40) },
      environment: { environmentRef: "environment:test:qa-1@17" },
    });

    const persisted = (await source.query(
      `
SELECT session.mode,session.state,
       (SELECT count(*)::int FROM qa_plan_items item WHERE item.session_id=session.session_id) AS plan_items,
       (SELECT count(*)::int FROM qa_automation_session_configuration_pins pin WHERE pin.session_id=session.session_id) AS pins
FROM qa_test_sessions session WHERE session.session_id=$1`,
      [created.session.id],
    )) as readonly Record<string, unknown>[];
    expect(persisted).toEqual([{ mode: "AUTOMATED", state: "READY", plan_items: 1, pins: 3 }]);

    const manualAfter = await manualController.list(
      executorRequest,
      fixture!.workspaceId,
      fixture!.projectId,
      fixture!.workItemId,
    );
    expect(manualAfter).toEqual(manualBefore);
    const mockState = await new TypeOrmGitLabRepository(mockSource).snapshot(5001);
    expect(mockState.project).toEqual(
      expect.objectContaining({
        capabilities: expect.objectContaining({ "scenario:us1-automated-session": true }),
      }),
    );
    expect(
      (mockState.calls as readonly Readonly<{ operation: string }>[]).filter(
        ({ operation }) => operation === "PIPELINE_TRIGGER",
      ),
    ).toHaveLength(0);
    const triggerCommands = (await source.query(
      "SELECT count(*)::int AS count FROM connector_commands WHERE operation='pipeline.trigger'",
    )) as readonly Readonly<{ count: number }>[];
    expect(triggerCommands).toEqual([{ count: 0 }]);
  }, 180_000);

  it.each(gitLabUs1ScenarioIds)(
    "persists exact Mock Hub state for %s with zero pipeline triggers",
    async (scenarioId) => {
      const expected = gitLabScenarioCatalog[scenarioId];
      await mockControl.scenario("local-gitlab-control", { projectId: 5001, scenarioId });
      const restartedRepository = new TypeOrmGitLabRepository(mockSource);
      const snapshot = await restartedRepository.snapshot(5001);
      expect(snapshot.project).toEqual(
        expect.objectContaining({
          project_id: String(expected.discovery.numericProjectId),
          path_with_namespace: expected.discovery.projectPath,
          exact_ref: expected.discovery.exactRef,
          exact_version: expected.discovery.exactVersion,
          capabilities: expect.objectContaining({ [`scenario:${scenarioId}`]: true }),
        }),
      );
      expect(snapshot.mergeRequests).toEqual([
        expect.objectContaining({
          iid: String(expected.mergeRequest.iid),
          head_commit_sha: expected.mergeRequest.headCommitSha,
          target_ref: expected.mergeRequest.targetRef,
        }),
      ]);
      expect(snapshot.commits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            commit_sha: expected.commit.sha,
            parent_commit_shas: [expected.commit.parentSha],
          }),
        ]),
      );
      expect(snapshot.pipelines).toEqual([
        expect.objectContaining({
          pipeline_id: String(expected.build.pipelineId),
          commit_sha: expected.commit.sha,
          ref: expected.discovery.exactRef,
        }),
      ]);
      expect(snapshot.jobs).toEqual([
        expect.objectContaining({
          job_id: String(expected.build.jobId),
          name: expected.build.resultJobKey,
          environment_name: expected.build.environmentName,
          stage: expected.ciLint.deploySurface ? "deploy" : "test",
        }),
      ]);
      expect(
        (snapshot.calls as readonly Readonly<{ operation: string }>[]).filter(
          ({ operation }) => operation === "PIPELINE_TRIGGER",
        ),
      ).toHaveLength(expected.expectedTriggerCalls);
    },
    180_000,
  );
});
