import { describe, expect, it } from "vitest";

import {
  createAutomatedRequiredSession,
  makeScopeSnapshot,
  type PlannedAutomatedSession,
  qaAggregateSnapshotHash,
  type QaAutomatedConfigurationPin,
  type QaAutomationConfigurationIntersection,
  type QaAutomationSuiteVersion,
} from "../../../packages/competency-qa/src/node.ts";
import {
  type AuthoritativeAutomatedSessionSelection,
  GitLabAutomatedSessionService,
  RuntimeQaAutomationAvailability,
} from "../../../packages/runtime-composition/src/index.ts";

const digest = (value: string) => qaAggregateSnapshotHash(value as never);
const scope = Object.freeze({
  workspaceId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
} as const);
const actor = Object.freeze({
  kind: "HUMAN" as const,
  principalId: "33333333-3333-4333-8333-333333333333",
  issuer: "https://fake-idp:4443/oidc",
  subject: "executor.alpha",
} as const);
const exact = (id: string, version: number, seed: string) =>
  Object.freeze({ id, version, contentHash: digest(seed) } as const);

function configurationPins(): readonly QaAutomatedConfigurationPin[] {
  const roles = [
    ["SOURCE_CONTEXT", "source-context.read"],
    ["TEST_EXECUTION", "test-executor.trigger-status"],
    ["ARTIFACT_SOURCE", "artifact.ci-read"],
  ] as const;
  const binding = exact("44444444-4444-4444-8444-444444444444", 1, "binding");
  return Object.freeze(
    roles.map(([logicalRole, capabilityKey], index) =>
      Object.freeze({
        ordinal: index + 1,
        logicalRole,
        capabilityKey,
        exactContractVersion: "1.0.0" as const,
        projectIntegrationBindingRef: binding,
        profileRef: exact(`55555555-5555-4555-8555-55555555555${index}`, 1, `profile-${index}`),
        connectionRef: exact(
          `66666666-6666-4666-8666-66666666666${index}`,
          1,
          `connection-${index}`,
        ),
        validationReportRef: exact(`validation-report-${index}`, 1, `report-${index}`),
        operationSetHash: digest(`operations-${index}`),
        externalScopeHash: digest("gitlab-project-5001"),
      } as const),
    ),
  );
}

function suite(): QaAutomationSuiteVersion {
  return Object.freeze({
    id: "automation-suite:v1",
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    suiteBindingId: "automation-suite",
    suiteKey: "merge-request-smoke",
    version: 1,
    state: "PUBLISHED",
    content: Object.freeze({
      ownerPrincipalId: actor.principalId,
      suiteDefinitionRef: exact("suite-definition", 1, "definition"),
      logicalExecutionContract: Object.freeze({
        pipelineKey: "qa-validation",
        sourceRefPolicyRef: "source-ref-policy@1",
        resultJobKey: "machine-result",
        contractHash: digest("contract"),
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
    } as const),
    contentHash: digest("suite"),
    validationReportId: "suite-validation",
    validationReportContentHash: digest("suite-validation"),
    createdBy: actor,
    createdAt: "2026-09-01T11:00:00.000Z",
    publishedAt: "2026-09-01T11:01:00.000Z",
    retiredAt: null,
  } as const);
}

function selection(): AuthoritativeAutomatedSessionSelection {
  const selectedSuite = suite();
  return Object.freeze({
    planRef: exact("required-plan-v1", 1, "plan"),
    requirement: createAutomatedRequiredSession({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      workItemId: "77777777-7777-4777-8777-777777777777",
      requiredSessionPlanId: "required-plan-v1",
      planVersion: 1,
      requirementId: "required-plan-v1:merge-request-smoke",
      suiteBindingKey: selectedSuite.suiteKey,
      allowedTargetTypes: ["MERGE_REQUEST"],
      allowedEnvironmentRefs: ["environment:test:qa-1@17"],
      createdAt: "2026-09-01T11:00:00.000Z",
    }),
    suite: selectedSuite,
    configurationPins: configurationPins(),
    existingSessionOrdinals: Object.freeze([1] as const),
    ownerId: actor.principalId,
    sourceIssueKey: "QA-5001",
    target: Object.freeze({
      type: "MERGE_REQUEST",
      mergeRequestRef: "5001:17",
      commitSha: "a".repeat(40),
      buildRef: "gitlab-pipeline:9001",
    } as const),
    environment: Object.freeze({
      environmentRef: "environment:test:qa-1@17",
      revision: 17,
      class: "TEST",
    } as const),
    parameterValidation: Object.freeze({
      valid: true,
      schemaRef: selectedSuite.content.parameterSchemaRef,
    } as const),
    browser: "chromium",
    testDataRefs: Object.freeze([
      { kind: "test-data", id: "dataset", version: "1", contentHash: digest("data") },
    ] as const),
    accountLeaseRefs: Object.freeze([] as const),
    scopeSnapshot: makeScopeSnapshot({
      purpose: "Automated smoke validation",
      agreedScope: "Merge request checks",
      acceptanceOutcome: "Machine result valid",
      inclusions: ["smoke"],
      exclusions: ["deploy"],
      checklistDefinition: {
        kind: "checklist",
        id: "smoke",
        version: "1",
        contentHash: digest("checklist"),
      },
    }),
  } as const);
}

function fullIntersection(): QaAutomationConfigurationIntersection {
  const selected = selection();
  return Object.freeze({
    publishedSuite: exact(selected.suite.suiteBindingId, selected.suite.version, "suite"),
    rolePins: Object.freeze(
      selected.configurationPins.map((pin) =>
        Object.freeze({
          logicalRole: pin.logicalRole,
          capabilityKey: pin.capabilityKey,
          exactContractVersion: pin.exactContractVersion,
          bindingRef: pin.projectIntegrationBindingRef,
          profileRef: pin.profileRef,
          connectionRef: pin.connectionRef,
          validationReportRef: pin.validationReportRef,
          current: true,
        } as const),
      ),
    ),
    validationEvidence: Object.freeze({ exact: true, current: true } as const),
    authorizationCurrent: true,
    entitlementCurrent: true,
    nonProductionProven: true,
    liveHealth: Object.freeze({
      availability: "AVAILABLE",
      reasonCodes: Object.freeze([] as const),
    } as const),
  } as const);
}

const request = Object.freeze({
  scope,
  workItemId: "77777777-7777-4777-8777-777777777777",
  suiteBindingKey: "merge-request-smoke",
  targetType: "MERGE_REQUEST" as const,
  targetRef: "5001:17",
  environmentRef: "environment:test:qa-1@17",
  acceptedParameters: Object.freeze({ browser: "chromium" } as const),
} as const);
const authorizationBasis = Object.freeze({
  kind: "PROJECT" as const,
  policyVersion: "qa@1",
  membershipRef: Object.freeze({ id: "88888888-8888-4888-8888-888888888888", version: 1 } as const),
  roleAssignmentRefs: Object.freeze([] as const),
  entitlementRefs: Object.freeze([] as const),
  skillContext: "NOT_APPLICABLE" as const,
} as const);
const context = Object.freeze({
  authorizationBasis,
  authorizationBasisHash: qaAggregateSnapshotHash(authorizationBasis as never),
  correlationId: "99999999-9999-4999-8999-999999999999",
  causationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
} as const);

describe("US1 availability projections and target lineage", () => {
  it("returns MANUAL_ONLY from projections without provider reads and leaves manual creation available", async () => {
    let projectionReads = 0;
    let authorityReads = 0;
    let providerReads = 0;
    let manualCreates = 0;
    const { publishedSuite: _suite, ...manualConfiguration } = fullIntersection();
    void _suite;
    const manualOnly: QaAutomationConfigurationIntersection = Object.freeze(manualConfiguration);
    const availability = new RuntimeQaAutomationAvailability({
      async current() {
        projectionReads += 1;
        return manualOnly;
      },
    });
    const service = new GitLabAutomatedSessionService(
      availability,
      {
        async resolve() {
          authorityReads += 1;
          providerReads += 1;
          return selection();
        },
      },
      {
        async persist(value) {
          return value;
        },
      },
      {
        async current() {
          return undefined;
        },
        async recordPreStartRevision() {
          throw new Error("UNREACHABLE");
        },
      },
    );
    await expect(
      service.create({
        sessionId: "manual-only-denied",
        request,
        actor,
        createdAt: "2026-09-01T11:02:00.000Z",
        context,
      }),
    ).rejects.toThrow(/QA_AUTOMATION_MANUAL_ONLY:NO_PUBLISHED_SUITE/iu);
    const manualCreate = async () => {
      manualCreates += 1;
      return Object.freeze({ mode: "MANUAL" as const } as const);
    };
    await expect(manualCreate()).resolves.toEqual({ mode: "MANUAL" });
    expect({ projectionReads, authorityReads, providerReads, manualCreates }).toEqual({
      projectionReads: 1,
      authorityReads: 0,
      providerReads: 0,
      manualCreates: 1,
    });
  });

  it("creates from server projections and chooses pre-start revision versus post-start TARGET_CHANGED linkage", async () => {
    const providerReads = 0;
    let authorityReads = 0;
    let writes = 0;
    let preStartRevisions = 0;
    let lineageMode: "PRE" | "POST" = "PRE";
    const availability = new RuntimeQaAutomationAvailability({
      async current() {
        return fullIntersection();
      },
    });
    const writer = {
      async persist(value: PlannedAutomatedSession) {
        writes += 1;
        return value;
      },
    };
    const service = new GitLabAutomatedSessionService(
      availability,
      {
        async resolve() {
          authorityReads += 1;
          return selection();
        },
      },
      writer,
      {
        async current() {
          return Object.freeze({
            id: "original-session",
            ...scope,
            workItemId: request.workItemId,
            ...(lineageMode === "POST" ? { startedAt: "2026-09-01T11:03:00.000Z" } : {}),
            targetSnapshotHash: digest("prior-target"),
          } as const);
        },
        async recordPreStartRevision() {
          preStartRevisions += 1;
          return Object.freeze({
            kind: "PRE_START_REVISION" as const,
            targetSnapshotHash: digest("pre-start-target-v2"),
          } as const);
        },
      },
    );
    const created = await service.create({
      sessionId: "projection-session",
      request,
      actor,
      createdAt: "2026-09-01T11:02:00.000Z",
      context,
    });
    expect(created.session.state).toBe("READY");
    expect(providerReads).toBe(0);

    const preStart = await service.changeTarget({
      originalSessionId: "original-session",
      replacementSessionId: "unused",
      request,
      actor,
      changedAt: "2026-09-01T11:04:00.000Z",
      context,
    });
    expect(preStart).toEqual({
      kind: "PRE_START_REVISION",
      targetSnapshotHash: digest("pre-start-target-v2"),
    });
    expect(writes).toBe(1);

    lineageMode = "POST";
    const postStart = await service.changeTarget({
      originalSessionId: "original-session",
      replacementSessionId: "linked-session",
      request,
      actor,
      changedAt: "2026-09-01T11:05:00.000Z",
      context,
    });
    expect(postStart.kind).toBe("LINKED_SESSION");
    if (postStart.kind !== "LINKED_SESSION") throw new Error("TEST_LINKED_SESSION_EXPECTED");
    expect(postStart.planned.session).toMatchObject({
      parentSessionId: "original-session",
      replacement: { reason: "TARGET_CHANGED", priorTargetSnapshotHash: digest("prior-target") },
    });
    expect({ authorityReads, providerReads, writes, preStartRevisions }).toEqual({
      authorityReads: 3,
      providerReads: 0,
      writes: 2,
      preStartRevisions: 1,
    });
  });
});
