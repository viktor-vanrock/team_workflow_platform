import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createAutomatedRequiredSession,
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
import { localPersonaIds } from "../../../packages/runtime-composition/src/seed/local-seed.ts";
import { qaLocalSeedIds } from "../../../packages/runtime-composition/src/seed/qa-local-seed.ts";
import {
  startUs3DatabaseFixture,
  stopUs3DatabaseFixture,
  us3Actor,
  type Us3DatabaseFixture,
} from "../../support/002-us3-database.ts";

const digest = (value: string) => qaAggregateSnapshotHash(value as never);
const suiteId = "a6100000-0000-4000-8000-000000000001";
const requirementId = "a6200000-0000-4000-8000-000000000001";
const validSessionId = "automation-session-us1-valid";
const rollbackSessionId = "automation-session-us1-rollback";
const createdAt = "2026-09-01T10:00:00.000Z";

let fixture: Us3DatabaseFixture | undefined;
let suite: QaAutomationSuiteVersion;
let validationReportRef: Readonly<{ id: string; version: number; contentHash: `sha256:${string}` }>;
let planRef: Readonly<{ id: string; version: number; contentHash: `sha256:${string}` }>;

function exact(id: string, version: number, seed: string) {
  return Object.freeze({ id, version, contentHash: digest(seed) } as const);
}

function suiteContent(): QaAutomationSuiteContent {
  return Object.freeze({
    ownerPrincipalId: localPersonaIds["executor.alpha"],
    suiteDefinitionRef: exact("automated-session-suite-definition", 1, "definition"),
    logicalExecutionContract: Object.freeze({
      pipelineKey: "qa-validation",
      sourceRefPolicyRef: "qa-source-ref-policy@1",
      resultJobKey: "machine-result",
      contractHash: digest("execution-contract"),
    } as const),
    allowedTargetTypes: Object.freeze(["MERGE_REQUEST", "COMMIT", "BUILD"] as const),
    allowedEnvironmentRefs: Object.freeze(["environment:test:qa-1@17"] as const),
    parameterSchemaRef: exact("parameter-schema", 1, "parameters"),
    resultSchemaRef: exact("result-schema", 1, "result"),
    artifactPolicyRef: exact("artifact-policy", 1, "artifact"),
    retryPolicyRef: exact("retry-policy", 1, "retry"),
    quarantinePolicyRef: exact("quarantine-policy", 1, "quarantine"),
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
    suiteKey: "merge-request-smoke",
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
    id: "automated-session-suite-report",
    workspaceId: f.workspaceId,
    projectId: f.projectId,
    suiteBindingRef: Object.freeze({
      id: draft.id,
      version: 1,
      contentHash: draft.contentHash,
    } as const),
    status: "VALID",
    coreBindingRef: exact(qaLocalSeedIds.alphaBinding, 2, "binding"),
    profilePinSetHash: digest("profile-pins"),
    discoverySnapshotRef: "discovery:automated-session",
    discoverySnapshotHash: digest("discovery"),
    suiteProbeRef: "probe:automated-session",
    suiteProbeHash: digest("probe"),
    checks: Object.freeze(
      qaAutomationSuiteValidationCheckOrder.map((key) =>
        Object.freeze({ key, passed: true } as const),
      ),
    ),
    issues: Object.freeze([] as const),
    validatedBy: Object.freeze({
      kind: "SERVICE",
      principalId: "gitlab-suite-worker",
      serviceKey: "suite-validation",
    } as const),
    authorizationBasisHash: digest("suite-validation-authorization"),
    createdAt: "2026-09-01T10:00:01.000Z",
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
    publishedAt: "2026-09-01T10:00:02.000Z",
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

function pins(invalidProfileId = false): readonly QaAutomatedConfigurationPin[] {
  const roles = [
    ["SOURCE_CONTEXT", "source-context.read"],
    ["TEST_EXECUTION", "test-executor.trigger-status"],
    ["ARTIFACT_SOURCE", "artifact.ci-read"],
  ] as const;
  const bindingRef = exact(qaLocalSeedIds.alphaBinding, 2, "binding-pin");
  return Object.freeze(
    roles.map(([logicalRole, capabilityKey], index) =>
      Object.freeze({
        ordinal: index + 1,
        logicalRole,
        capabilityKey,
        exactContractVersion: "1.0.0" as const,
        projectIntegrationBindingRef: bindingRef,
        profileRef: exact(
          invalidProfileId && index === 1
            ? "not-a-uuid"
            : `a6300000-0000-4000-8000-00000000000${index + 1}`,
          1,
          `profile-${index}`,
        ),
        connectionRef: exact(
          `a6400000-0000-4000-8000-00000000000${index + 1}`,
          1,
          `connection-${index}`,
        ),
        validationReportRef,
        operationSetHash: digest(`operations-${index}`),
        externalScopeHash: digest("numeric-project-5001"),
      } as const),
    ),
  );
}

function planned(
  f: Us3DatabaseFixture,
  sessionId: string,
  configurationPins: readonly QaAutomatedConfigurationPin[],
  ordinals: readonly number[],
): PlannedAutomatedSession {
  const requirement = createAutomatedRequiredSession({
    workspaceId: f.workspaceId,
    projectId: f.projectId,
    workItemId: f.workItemId,
    requiredSessionPlanId: planRef.id,
    planVersion: planRef.version,
    requirementId,
    suiteBindingKey: suite.suiteKey,
    allowedTargetTypes: ["MERGE_REQUEST", "COMMIT", "BUILD"],
    allowedEnvironmentRefs: ["environment:test:qa-1@17"],
    createdAt,
  });
  return planAutomatedSession({
    sessionId,
    planRef,
    requirement,
    suite,
    configurationPins,
    existingSessionOrdinals: ordinals,
    ownerId: suite.content.ownerPrincipalId,
    sourceIssueKey: "QA-5001",
    target: Object.freeze({
      type: "MERGE_REQUEST",
      mergeRequestRef: "5001:17",
      commitSha: "a".repeat(40),
      buildRef: "gitlab-pipeline:5001:9001",
    } as const),
    environment: Object.freeze({
      environmentRef: "environment:test:qa-1@17",
      revision: 17,
      class: "TEST",
    } as const),
    acceptedParameters: Object.freeze({ browser: "chromium", shardCount: 2 } as const),
    parameterValidation: Object.freeze({
      valid: true,
      schemaRef: suite.content.parameterSchemaRef,
    } as const),
    browser: "chromium",
    testDataRefs: Object.freeze([
      {
        kind: "test-data",
        id: "qa-dataset",
        version: "2026-09-01",
        contentHash: digest("test-data"),
      },
    ] as const),
    accountLeaseRefs: Object.freeze([
      { kind: "account-lease", id: "lease-17", version: "1", contentHash: digest("account-lease") },
    ] as const),
    scopeSnapshot: makeScopeSnapshot({
      purpose: "Validate the merge request with the published automated Suite.",
      agreedScope: "Bounded GitLab merge request smoke validation.",
      acceptanceOutcome: "Machine result satisfies the exact result schema.",
      inclusions: ["merge-request", "machine-result"],
      exclusions: ["deployment", "production"],
      checklistDefinition: {
        kind: "checklist",
        id: "automated-smoke",
        version: "1",
        contentHash: digest("checklist"),
      },
    }),
    actor: us3Actor,
    createdAt,
  });
}

beforeAll(async () => {
  fixture = await startUs3DatabaseFixture();
  suite = await publishSuite(fixture);
  // This persistence test starts after capability evaluation; conformance belongs to 007.
  await fixture.source.query(
    "UPDATE project_onboarding_headers SET current_capability_mode='FULL_QA' WHERE workspace_id=$1 AND project_id=$2",
    [fixture.workspaceId, fixture.projectId],
  );
  const planRows = (await fixture.source.query(
    "SELECT plan_version_id,version,content_hash FROM qa_required_session_plan_versions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY version DESC LIMIT 1",
    [fixture.workspaceId, fixture.projectId, fixture.workItemId],
  )) as readonly { plan_version_id: string; version: number; content_hash: `sha256:${string}` }[];
  const row = planRows[0]!;
  planRef = Object.freeze({
    id: row.plan_version_id,
    version: row.version,
    contentHash: row.content_hash,
  } as const);
  const requirement = createAutomatedRequiredSession({
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    workItemId: fixture.workItemId,
    requiredSessionPlanId: planRef.id,
    planVersion: planRef.version,
    requirementId,
    suiteBindingKey: suite.suiteKey,
    allowedTargetTypes: ["MERGE_REQUEST", "COMMIT", "BUILD"],
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
}, 120_000);

afterAll(async () => {
  await stopUs3DatabaseFixture(fixture);
}, 120_000);

describe("US1 automated Session transaction", () => {
  it("denies a prepared automated Session when the current Core mode is MANUAL_ONLY", async () => {
    const f = fixture!,
      candidate = planned(f, validSessionId, pins(), [1]);
    const authorizationBasis = {
      kind: "PROJECT" as const,
      policyVersion: "qa-automation@1",
      membershipRef: { id: "a6700000-0000-4000-8000-000000000001", version: 1 },
      roleAssignmentRefs: [],
      entitlementRefs: [],
      skillContext: "NOT_APPLICABLE" as const,
    };
    await f.source.query(
      "UPDATE project_onboarding_headers SET current_capability_mode='MANUAL_ONLY' WHERE workspace_id=$1 AND project_id=$2",
      [f.workspaceId, f.projectId],
    );
    try {
      await expect(
        new TypeOrmAutomatedSessionUnitOfWork(f.source).persist(candidate, {
          authorizationBasis,
          authorizationBasisHash: qaAggregateSnapshotHash(authorizationBasis as never),
          correlationId: "a6800000-0000-4000-8000-000000000001",
          causationId: "a6800000-0000-4000-8000-000000000002",
        }),
      ).rejects.toThrow("AUTOMATION_REQUIRES_FULL_QA");
      expect(
        await f.source.query(
          "SELECT count(*)::int AS n FROM qa_test_sessions WHERE session_id=$1",
          [validSessionId],
        ),
      ).toEqual([{ n: 0 }]);
    } finally {
      await f.source.query(
        "UPDATE project_onboarding_headers SET current_capability_mode='FULL_QA' WHERE workspace_id=$1 AND project_id=$2",
        [f.workspaceId, f.projectId],
      );
    }
  });
  it("persists one READY Session, one Plan Item, three pins, complete snapshots, audit, and outbox without a GitLab command", async () => {
    const f = fixture!;
    const commandCountBefore = (await f.source.query(
      "SELECT count(*)::int AS count FROM connector_commands",
    )) as readonly { count: number }[];
    const candidate = planned(f, validSessionId, pins(), [1]);
    const authorizationBasis = Object.freeze({
      kind: "PROJECT" as const,
      policyVersion: "qa-automation@1",
      membershipRef: Object.freeze({
        id: "a6500000-0000-4000-8000-000000000001",
        version: 1,
      } as const),
      roleAssignmentRefs: Object.freeze([
        { id: "a6500000-0000-4000-8000-000000000002", version: 1 },
      ] as const),
      entitlementRefs: Object.freeze([
        { id: "a6500000-0000-4000-8000-000000000003", version: 1 },
      ] as const),
      skillContext: "NOT_APPLICABLE" as const,
    } as const);
    await new TypeOrmAutomatedSessionUnitOfWork(f.source).persist(candidate, {
      authorizationBasis,
      authorizationBasisHash: qaAggregateSnapshotHash(authorizationBasis as never),
      correlationId: "a6600000-0000-4000-8000-000000000001",
      causationId: "a6600000-0000-4000-8000-000000000002",
    });
    const rows = (await f.source.query(
      `SELECT session.mode,session.state,session.contract_schema_version,session.target_snapshot,session.automation_suite_binding_id,session.automation_suite_binding_version,session.automation_configuration_pin_set_hash,session.automation_parameter_set_hash,(SELECT count(*)::int FROM qa_plan_items item WHERE item.session_id=session.session_id) AS plan_items,(SELECT count(*)::int FROM qa_automation_session_configuration_pins pin WHERE pin.session_id=session.session_id) AS pins,(SELECT count(*)::int FROM event_outbox event WHERE event.event_type='qa.automated-session.ready' AND COALESCE(event.envelope->>'sessionId',event.envelope->'payload'->>'sessionId')=session.session_id) AS events,(SELECT count(*)::int FROM audit_events audit WHERE audit.attributes->'values'->>'sessionId'=session.session_id) AS audits FROM qa_test_sessions session WHERE session.session_id=$1`,
      [validSessionId],
    )) as readonly Record<string, unknown>[];
    expect(rows).toEqual([
      expect.objectContaining({
        mode: "AUTOMATED",
        state: "READY",
        contract_schema_version: 2,
        automation_suite_binding_id: suite.suiteBindingId,
        automation_suite_binding_version: 1,
        automation_configuration_pin_set_hash: candidate.targetSnapshot.configurationPinSetHash,
        automation_parameter_set_hash: candidate.targetSnapshot.suite.parametersHash,
        plan_items: 1,
        pins: 3,
        events: 1,
        audits: 1,
        target_snapshot: expect.objectContaining({
          target: expect.objectContaining({
            type: "MERGE_REQUEST",
            mergeRequestRef: "5001:17",
            commitSha: "a".repeat(40),
            buildRef: "gitlab-pipeline:5001:9001",
          }),
          environment: { environmentRef: "environment:test:qa-1@17", revision: 17, class: "TEST" },
          testDataRefs: [expect.objectContaining({ id: "qa-dataset" })],
          accountLeaseRefs: [expect.objectContaining({ id: "lease-17" })],
        }),
      }),
    ]);
    const persistedPins = (await f.source.query(
      "SELECT ordinal,logical_role,capability_key,project_integration_binding_id,profile_id,connection_id FROM qa_automation_session_configuration_pins WHERE session_id=$1 ORDER BY ordinal",
      [validSessionId],
    )) as readonly Record<string, unknown>[];
    expect(
      persistedPins.map(({ ordinal, logical_role, capability_key }) => ({
        ordinal,
        logical_role,
        capability_key,
      })),
    ).toEqual([
      { ordinal: 1, logical_role: "SOURCE_CONTEXT", capability_key: "source-context.read" },
      {
        ordinal: 2,
        logical_role: "TEST_EXECUTION",
        capability_key: "test-executor.trigger-status",
      },
      { ordinal: 3, logical_role: "ARTIFACT_SOURCE", capability_key: "artifact.ci-read" },
    ]);
    expect(
      new Set(
        persistedPins.map(({ project_integration_binding_id }) => project_integration_binding_id),
      ),
    ).toEqual(new Set([qaLocalSeedIds.alphaBinding]));
    expect(new Set(persistedPins.map(({ profile_id }) => profile_id)).size).toBe(3);
    expect(new Set(persistedPins.map(({ connection_id }) => connection_id)).size).toBe(3);
    const commandCountAfter = (await f.source.query(
      "SELECT count(*)::int AS count FROM connector_commands",
    )) as readonly { count: number }[];
    expect(commandCountAfter).toEqual(commandCountBefore);
    await expect(
      f.source.query("UPDATE qa_test_sessions SET target_snapshot='{}' WHERE session_id=$1", [
        validSessionId,
      ]),
    ).rejects.toThrow(/QA_SESSION_STRUCTURE_UOW_REQUIRED|SESSION_SNAPSHOT_LOCKED/iu);
    await expect(
      f.source.query(
        "UPDATE qa_automation_session_configuration_pins SET profile_version=2 WHERE session_id=$1 AND ordinal=1",
        [validSessionId],
      ),
    ).rejects.toThrow(/APPEND_ONLY/iu);
  });

  it("rolls back every row when a selector fails inside the transaction", async () => {
    const f = fixture!;
    const candidate = planned(f, rollbackSessionId, pins(true), [1, 2]);
    const authorizationBasis = Object.freeze({
      kind: "PROJECT" as const,
      policyVersion: "qa-automation@1",
      membershipRef: Object.freeze({
        id: "a6700000-0000-4000-8000-000000000001",
        version: 1,
      } as const),
      roleAssignmentRefs: Object.freeze([] as const),
      entitlementRefs: Object.freeze([] as const),
      skillContext: "NOT_APPLICABLE" as const,
    } as const);
    await expect(
      new TypeOrmAutomatedSessionUnitOfWork(f.source).persist(candidate, {
        authorizationBasis,
        authorizationBasisHash: qaAggregateSnapshotHash(authorizationBasis as never),
        correlationId: "a6800000-0000-4000-8000-000000000001",
        causationId: "a6800000-0000-4000-8000-000000000002",
      }),
    ).rejects.toThrow(/invalid input syntax for type uuid/iu);
    const counts = (await f.source.query(
      `SELECT (SELECT count(*)::int FROM qa_test_sessions WHERE session_id=$1) AS sessions,(SELECT count(*)::int FROM qa_plan_items WHERE session_id=$1) AS items,(SELECT count(*)::int FROM qa_automation_session_configuration_pins WHERE session_id=$1) AS pins,(SELECT count(*)::int FROM event_outbox WHERE event_type='qa.automated-session.ready' AND COALESCE(envelope->>'sessionId',envelope->'payload'->>'sessionId')=$1) AS events,(SELECT count(*)::int FROM audit_events WHERE attributes->'values'->>'sessionId'=$1) AS audits`,
      [rollbackSessionId],
    )) as readonly Record<string, number>[];
    expect(counts).toEqual([{ sessions: 0, items: 0, pins: 0, events: 0, audits: 0 }]);
  });
});
