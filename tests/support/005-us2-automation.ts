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
  recordAutomationSuiteValidation,
  TypeOrmAutomatedSessionUnitOfWork,
  TypeOrmAutomationSuiteRepository,
} from "../../packages/competency-qa/src/node.ts";
import { localPersonaIds } from "../../packages/runtime-composition/src/seed/local-seed.ts";
import { qaLocalSeedIds } from "../../packages/runtime-composition/src/seed/qa-local-seed.ts";
import { us3Actor, type Us3DatabaseFixture } from "./002-us3-database.ts";

const digest = (value: string) => qaAggregateSnapshotHash(value as never);
const createdAt = "2026-09-01T08:00:00.000Z";
const suiteId = "d6100000-0000-4000-8000-000000000001";
const requirementId = "d6200000-0000-4000-8000-000000000001";
export const us2AutomationSessionId = "d6300000-0000-4000-8000-000000000001";

const exact = (id: string, version: number, seed: string) =>
  Object.freeze({ id, version, contentHash: digest(seed) });

export const us2AutomationAuthorizationBasis = Object.freeze({
  kind: "PROJECT" as const,
  policyVersion: "qa-automation-launch@1",
  membershipRef: Object.freeze({ id: "d6600000-0000-4000-8000-000000000001", version: 1 }),
  roleAssignmentRefs: Object.freeze([{ id: "d6600000-0000-4000-8000-000000000002", version: 1 }]),
  entitlementRefs: Object.freeze([{ id: "d6600000-0000-4000-8000-000000000003", version: 1 }]),
  skillContext: "NOT_APPLICABLE" as const,
});

function suiteContent(): QaAutomationSuiteContent {
  return Object.freeze({
    ownerPrincipalId: localPersonaIds["executor.alpha"],
    suiteDefinitionRef: exact("trigger-once-suite-definition", 1, "trigger-once-suite-definition"),
    logicalExecutionContract: Object.freeze({
      pipelineKey: "qa.validation",
      sourceRefPolicyRef: "policy:source-ref:qa-smoke:v1",
      resultJobKey: "machine-result",
      contractHash: digest("trigger-once-execution-contract"),
    }),
    allowedTargetTypes: Object.freeze(["MERGE_REQUEST"] as const),
    allowedEnvironmentRefs: Object.freeze(["environment:test:qa-1@17"] as const),
    parameterSchemaRef: exact("trigger-once-parameters", 1, "trigger-once-parameters"),
    resultSchemaRef: exact("trigger-once-result", 1, "trigger-once-result"),
    artifactPolicyRef: exact("trigger-once-artifact-policy", 1, "trigger-once-artifact-policy"),
    retryPolicyRef: exact("trigger-once-retry-policy", 1, "trigger-once-retry-policy"),
    quarantinePolicyRef: exact(
      "trigger-once-quarantine-policy",
      1,
      "trigger-once-quarantine-policy",
    ),
    capabilityRequirements: Object.freeze([
      "source-context.read@1.0.0",
      "test-executor.trigger-status@1.0.0",
      "artifact.ci-read@1.0.0",
    ] as const),
  });
}

export interface PreparedUs2AutomationSession {
  readonly planned: PlannedAutomatedSession;
  readonly testExecutionPin: QaAutomatedConfigurationPin;
  readonly planRef: Readonly<{ id: string; version: number; contentHash: `sha256:${string}` }>;
}

export interface Us2AutomationAuthorityPins {
  readonly bindingRef: Readonly<{ id: string; version: number; contentHash: `sha256:${string}` }>;
  readonly profileRef: Readonly<{ id: string; version: number; contentHash: `sha256:${string}` }>;
  readonly connectionRef: Readonly<{
    id: string;
    version: number;
    contentHash: `sha256:${string}`;
  }>;
}

export async function prepareUs2AutomationSession(
  fixture: Us3DatabaseFixture,
  authorityPins?: Us2AutomationAuthorityPins,
): Promise<PreparedUs2AutomationSession> {
  const header = createAutomationSuiteHeader({
    id: suiteId,
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    suiteKey: "smoke",
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
    id: "us2-trigger-once-suite-report",
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    suiteBindingRef: Object.freeze({ id: draft.id, version: 1, contentHash: draft.contentHash }),
    status: "VALID",
    coreBindingRef: exact(qaLocalSeedIds.alphaBinding, 2, "trigger-once-binding"),
    profilePinSetHash: digest("trigger-once-profile-pins"),
    discoverySnapshotRef: "discovery:us2-trigger-once",
    discoverySnapshotHash: digest("trigger-once-discovery"),
    suiteProbeRef: "probe:us2-trigger-once",
    suiteProbeHash: digest("trigger-once-probe"),
    checks: Object.freeze(
      qaAutomationSuiteValidationCheckOrder.map((key) => Object.freeze({ key, passed: true })),
    ),
    issues: Object.freeze([]),
    validatedBy: Object.freeze({
      kind: "SERVICE",
      principalId: localPersonaIds["worker.local"],
      serviceKey: "suite-validation",
    }),
    authorizationBasisHash: digest("trigger-once-suite-authorization"),
    createdAt: "2026-09-01T08:00:01.000Z",
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
    }),
    publishedAt: "2026-09-01T08:00:02.000Z",
  });
  await fixture.source.transaction(async (manager) => {
    const repository = new TypeOrmAutomationSuiteRepository(manager);
    await repository.insertHeader(header);
    await repository.insertVersion(draft);
    await repository.persistValidation({
      scope: fixture,
      previousVersion: draft,
      nextVersion: validated.version,
      report: validated.report,
    });
    await repository.persistPublication({
      scope: fixture,
      previousHeader: header,
      nextHeader: published.header,
      previousVersions: [validated.version],
      nextVersions: published.versions,
    });
  });

  const [plan] = (await fixture.source.query(
    "SELECT plan_version_id,version,content_hash FROM qa_required_session_plan_versions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY version DESC LIMIT 1",
    [fixture.workspaceId, fixture.projectId, fixture.workItemId],
  )) as readonly Readonly<{
    plan_version_id: string;
    version: number;
    content_hash: `sha256:${string}`;
  }>[];
  if (!plan) throw new Error("US2_REQUIRED_SESSION_PLAN_MISSING");
  const planRef = Object.freeze({
    id: plan.plan_version_id,
    version: plan.version,
    contentHash: plan.content_hash,
  });
  const suite = published.versions[0]!;
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
    `INSERT INTO qa_required_session_plan_requirements(requirement_id,workspace_id,project_id,work_item_id,plan_version_id,requirement_key,ordinal,mode,minimum_session_count,resolution,content_hash,content,contract_schema_version,automation_suite_binding_key,automation_suite_selection_policy)
     VALUES($1,$2,$3,$4,$5,$6,2,'AUTOMATED',1,'REQUIRED',$7,$8,2,$6,$9)`,
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

  const validationReportRef = Object.freeze({
    id: validated.report.id,
    version: 1,
    contentHash: validated.report.contentHash,
  });
  const bindingRef =
    authorityPins?.bindingRef ?? exact(qaLocalSeedIds.alphaBinding, 2, "trigger-once-binding-pin");
  const roles = [
    ["SOURCE_CONTEXT", "source-context.read"],
    ["TEST_EXECUTION", "test-executor.trigger-status"],
    ["ARTIFACT_SOURCE", "artifact.ci-read"],
  ] as const;
  const pins = Object.freeze(
    roles.map(([logicalRole, capabilityKey], index) =>
      Object.freeze({
        ordinal: index + 1,
        logicalRole,
        capabilityKey,
        exactContractVersion: "1.0.0" as const,
        projectIntegrationBindingRef: bindingRef,
        profileRef:
          authorityPins?.profileRef ??
          exact(
            `d6400000-0000-4000-8000-00000000000${index + 1}`,
            1,
            `trigger-once-profile-${index}`,
          ),
        connectionRef:
          authorityPins?.connectionRef ??
          exact(
            `d6500000-0000-4000-8000-00000000000${index + 1}`,
            1,
            `trigger-once-connection-${index}`,
          ),
        validationReportRef,
        operationSetHash: digest(`trigger-once-operations-${index}`),
        externalScopeHash: digest("trigger-once-project-5001"),
      }),
    ),
  );
  const planned = planAutomatedSession({
    sessionId: us2AutomationSessionId,
    planRef,
    requirement,
    suite,
    configurationPins: pins,
    existingSessionOrdinals: [1],
    ownerId: suite.content.ownerPrincipalId,
    sourceIssueKey: "QA-5001",
    target: Object.freeze({
      type: "MERGE_REQUEST",
      mergeRequestRef: "5001:17",
      commitSha: "a".repeat(40),
    }),
    environment: Object.freeze({
      environmentRef: "environment:test:qa-1@17",
      revision: 17,
      class: "TEST",
    }),
    acceptedParameters: Object.freeze({ shard: 2, locale: "en-US" }),
    parameterValidation: Object.freeze({
      valid: true,
      schemaRef: suite.content.parameterSchemaRef,
    }),
    testDataRefs: Object.freeze([
      {
        kind: "test-data",
        id: "trigger-once-dataset",
        version: "1",
        contentHash: digest("trigger-once-test-data"),
      },
    ]),
    accountLeaseRefs: Object.freeze([]),
    scopeSnapshot: makeScopeSnapshot({
      purpose: "Prove trigger once.",
      agreedScope: "One non-production GitLab pipeline.",
      acceptanceOutcome: "One exact receipt is attached.",
      inclusions: ["smoke"],
      exclusions: ["deployment", "production"],
      checklistDefinition: {
        kind: "checklist",
        id: "trigger-once-smoke",
        version: "1",
        contentHash: digest("trigger-once-checklist"),
      },
    }),
    actor: us3Actor,
    createdAt,
  });
  // These downstream dispatch/recovery fixtures start after successful FULL_QA admission.
  // Capability promotion itself is verified by the independent 007 HTTP/probe suite.
  await fixture.source.query(
    "UPDATE project_onboarding_headers SET current_capability_mode='FULL_QA' WHERE workspace_id=$1 AND project_id=$2",
    [fixture.workspaceId, fixture.projectId],
  );
  await new TypeOrmAutomatedSessionUnitOfWork(fixture.source).persist(planned, {
    authorizationBasis: us2AutomationAuthorizationBasis,
    authorizationBasisHash: qaAggregateSnapshotHash(us2AutomationAuthorizationBasis as never),
    correlationId: "d6700000-0000-4000-8000-000000000001",
    causationId: "d6700000-0000-4000-8000-000000000002",
  });
  const testExecutionPin = pins.find(({ logicalRole }) => logicalRole === "TEST_EXECUTION");
  if (!testExecutionPin) throw new Error("US2_TEST_EXECUTION_PIN_MISSING");
  return Object.freeze({ planned, testExecutionPin, planRef });
}
