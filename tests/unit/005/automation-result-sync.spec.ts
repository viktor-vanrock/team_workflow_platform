import { describe, expect, it } from "vitest";

import {
  appendAutomationAttemptStatus,
  createAutomatedTargetSnapshot,
  createAutomationAttemptRecord,
  prepareQaAutomationResultSync,
  qaAggregateSnapshotHash,
  type QaAutomationArtifactDescriptorInput,
  type QaAutomationNormalizedResultInput,
} from "../../../packages/competency-qa/src/index.ts";
import { designContractRegistry } from "../../../packages/platform-contracts/src/index.ts";
import { defaultClassificationCatalog } from "../../../packages/platform-core/src/index.ts";

const hash = (value: string) => qaAggregateSnapshotHash(value as never);
const exact = (id: string, value: string) => ({ id, version: 1, contentHash: hash(value) });
const workspaceId = "550e8400-e29b-41d4-a716-446655440001";
const projectId = "550e8400-e29b-41d4-a716-446655440002";
const workItemId = "550e8400-e29b-41d4-a716-446655440003";
const sessionId = "550e8400-e29b-41d4-a716-446655440004";
const planItemId = "550e8400-e29b-41d4-a716-446655440005";
const attemptId = "550e8400-e29b-41d4-a716-446655440006";
const artifactReferenceId = "550e8400-e29b-41d4-a716-446655440007";
const schemaRef = Object.freeze({
  id: "urn:awp:schemas:005:gitlab-pipeline-result:v1",
  version: 1,
  digest: designContractRegistry.digest("urn:awp:schemas:005:gitlab-pipeline-result:v1"),
});

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
      projectIntegrationBindingRef: exact("550e8400-e29b-41d4-a716-446655440010", "binding"),
      profileRef: exact(`550e8400-e29b-41d4-a716-44665544001${index + 1}`, `profile-${index}`),
      connectionRef: exact(
        `550e8400-e29b-41d4-a716-44665544002${index + 1}`,
        `connection-${index}`,
      ),
      validationReportRef: exact(
        `550e8400-e29b-41d4-a716-44665544003${index + 1}`,
        `validation-${index}`,
      ),
      operationSetHash: hash(`operations-${index}`),
      externalScopeHash: hash("project-5001"),
    }),
  ),
);

const target = createAutomatedTargetSnapshot({
  workspaceId,
  projectId,
  workItemId,
  testSessionId: sessionId,
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
  suite: Object.freeze({
    suiteKey: "smoke",
    suiteBindingRef: { id: "550e8400-e29b-41d4-a716-446655440040", version: 1 },
    suiteBindingHash: hash("suite"),
    parameterSchemaRef: exact("550e8400-e29b-41d4-a716-446655440041", "parameters"),
    acceptedParameters: Object.freeze({ browser: "chromium" }),
  }),
  configurationPins: pins,
  executionPolicies: Object.freeze({
    resultSchemaRef: { ...schemaRef, contentHash: schemaRef.digest },
    artifactPolicyRef: exact("550e8400-e29b-41d4-a716-446655440042", "artifact-policy"),
    retryPolicyRef: exact("550e8400-e29b-41d4-a716-446655440043", "retry-policy"),
    quarantinePolicyRef: exact("550e8400-e29b-41d4-a716-446655440044", "quarantine-policy"),
  }),
  testDataRefs: Object.freeze([
    { kind: "TEST_DATA", id: "dataset", version: "1", contentHash: hash("dataset") },
  ]),
  accountLeaseRefs: Object.freeze([]),
  capturedAt: "2026-09-01T08:00:00.000Z",
});

function runningAttempt() {
  const created = createAutomationAttemptRecord({
    automationAttemptId: attemptId,
    workspaceId,
    projectId,
    workItemId,
    testSessionId: sessionId,
    planItemId,
    reason: "INITIAL",
    launchRequestId: "550e8400-e29b-41d4-a716-446655440050",
    requestKeyHash: hash("request-key"),
    requestHash: hash("request"),
    targetSnapshotRef: "qa-target:session-1",
    targetSnapshotHash: target.snapshotHash,
    scopeSnapshotHash: hash("scope"),
    suiteBindingRef: target.suite.suiteBindingRef,
    suiteBindingHash: target.suite.suiteBindingHash,
    parameterSetHash: target.suite.parametersHash,
    configurationPins: pins,
    configurationPinSetHash: target.configurationPinSetHash,
    resultSchemaRef: schemaRef,
    artifactPolicyRef: "policy:artifact:v1",
    artifactPolicyHash: hash("artifact-policy"),
    retryPolicyRef: "policy:retry:v1",
    retryPolicyHash: hash("retry-policy"),
    quarantinePolicyRef: "policy:quarantine:v1",
    quarantinePolicyHash: hash("quarantine-policy"),
    connectorCommandId: "550e8400-e29b-41d4-a716-446655440051",
    effectKeyHash: hash("effect"),
    initiatingHumanId: "550e8400-e29b-41d4-a716-446655440052",
    executingServiceId: "550e8400-e29b-41d4-a716-446655440053",
    authorizationBasisHash: hash("authorization"),
    externalAuthorityHash: hash("external-authority"),
    previousAttempts: [],
    createdAt: "2026-09-01T08:00:00.000Z",
    correlationId: "550e8400-e29b-41d4-a716-446655440054",
    causationId: "550e8400-e29b-41d4-a716-446655440055",
  });
  const pending = appendAutomationAttemptStatus(created.attempt, created.initialStatus, {
    statusRevisionId: "550e8400-e29b-41d4-a716-446655440056",
    status: "TRIGGER_PENDING",
    providerStatus: "NOT_OBSERVED",
    providerRevisionToken: "pending:1",
    source: "COMMAND_RECEIPT",
    sourceReceiptRef: "core-command:1",
    sourceReceiptHash: hash("pending"),
    observedAt: "2026-09-01T08:00:01.000Z",
    recordedAt: "2026-09-01T08:00:01.000Z",
  });
  return appendAutomationAttemptStatus(pending.attempt, pending.revision, {
    statusRevisionId: "550e8400-e29b-41d4-a716-446655440057",
    status: "RUNNING",
    externalPipelineId: "101",
    providerStatus: "RUNNING",
    providerRevisionToken: "running:1",
    source: "COMMAND_RECEIPT",
    sourceReceiptRef: "gitlab-pipeline:101",
    sourceReceiptHash: hash("running"),
    observedAt: "2026-09-01T08:00:02.000Z",
    recordedAt: "2026-09-01T08:00:02.000Z",
  });
}

const resultContentHash = hash("machine-result-bytes");

function normalization(
  overrides: Partial<QaAutomationNormalizedResultInput> = {},
): QaAutomationNormalizedResultInput {
  return {
    normalizationKind: "SCHEMA_VALIDATED",
    normalizationStatus: "VALID",
    issueCodes: [],
    outcome: "PASS",
    resultSchemaRef: schemaRef,
    sourceResultArtifactRef: "artifact-reference:machine-result",
    resultContentHash,
    externalPipelineId: "101",
    externalJobIds: ["1001"],
    target: target.target,
    suiteKey: target.suite.suiteKey,
    environmentRef: target.environment.environmentRef,
    durationMs: 180_000,
    terminalAt: "2026-09-01T08:05:00.000Z",
    ...overrides,
  };
}

function descriptor(
  overrides: Partial<QaAutomationArtifactDescriptorInput> = {},
): QaAutomationArtifactDescriptorInput {
  const artifactPin = pins[2]!;
  return {
    artifactReferenceId,
    descriptorHash: hash("descriptor"),
    externalPipelineId: "101",
    externalJobId: "1001",
    logicalPath: "awp/results/result.json",
    checksum: resultContentHash,
    checksumSource: "CONNECTOR_CONTENT_SHA256",
    sizeBytes: 512,
    mediaType: "application/json",
    fileName: "result.json",
    artifactKind: "RESULT",
    classificationKey: "INTERNAL",
    sourceProfileRef: { id: artifactPin.profileRef.id, version: artifactPin.profileRef.version },
    sourceProfileContentHash: artifactPin.profileRef.contentHash,
    retentionPolicyRef: "policy:artifact:v1",
    availability: "AVAILABLE",
    opaqueLocatorHash: hash("locator"),
    expiresAt: "2026-09-08T08:05:00.000Z",
    registeredAt: "2026-09-01T08:05:00.000Z",
    ...overrides,
  };
}

function prepare(
  input: Readonly<{
    normalization?: QaAutomationNormalizedResultInput;
    descriptor?: QaAutomationArtifactDescriptorInput;
    noArtifacts?: boolean;
    sessionState?: "RUNNING" | "REVIEW_REQUIRED";
    previousLineageResults?: readonly Readonly<{
      attemptNo: number;
      outcome: "ASSERTION_FAILED" | "PASS";
    }>[];
  }> = {},
) {
  const running = runningAttempt();
  return prepareQaAutomationResultSync({
    context: {
      actor: {
        kind: "SERVICE",
        principalId: "550e8400-e29b-41d4-a716-446655440053",
        serviceKey: "qa-result-sync",
      },
      scope: { kind: "PROJECT", workspaceId, projectId },
      correlationId: "550e8400-e29b-41d4-a716-446655440054",
      causationId: "550e8400-e29b-41d4-a716-446655440055",
    },
    attempt: running.attempt,
    previousStatus: running.revision,
    targetSnapshot: target,
    observation: {
      externalPipelineId: "101",
      externalJobIds: ["1001"],
      providerStatus: "SUCCESS",
      providerRevisionToken: "success:1",
      providerUpdatedAt: "2026-09-01T08:05:00.000Z",
      terminal: true,
      observedAt: "2026-09-01T08:05:00.000Z",
      observationHash: hash("terminal-observation"),
      source: "POLL_READ",
      sourceReceiptRef: "gitlab-observation:101:success:1",
    },
    normalization: input.normalization ?? normalization(),
    artifactDescriptors: input.noArtifacts ? [] : [input.descriptor ?? descriptor()],
    machineArtifactManifest: [],
    previousLineageResults: input.previousLineageResults ?? [],
    session: { state: input.sessionState ?? "RUNNING", resourceVersion: 3 },
    recordedAt: "2026-09-01T08:05:01.000Z",
  });
}

describe("QA authoritative automation result synchronization", () => {
  it("preserves a schema-validated INCOMPLETE result with its artifact evidence", () => {
    const synced = prepare({ normalization: normalization({ outcome: "INCOMPLETE" }) });
    expect(synced.result).toMatchObject({
      outcome: "INCOMPLETE",
      normalizationKind: "SCHEMA_VALIDATED",
      normalizationReport: { status: "VALID", issueCodes: [] },
      artifactSyncState: "COMPLETE",
    });
    expect(synced.result.syntheticReasonCode).toBeUndefined();
    expect(synced.artifactMemberships).toHaveLength(1);
    expect(() =>
      designContractRegistry.validateById(
        "urn:awp:schemas:005:automation-attempt-result:v1",
        synced.result as never,
      ),
    ).not.toThrow();
    for (const event of synced.events)
      expect(() =>
        designContractRegistry.validate({
          schemaRef: event.payloadSchemaRef,
          value: event.payload as never,
        }),
      ).not.toThrow();
  });
  it("marks a missing result without artifacts as unavailable", () => {
    const synced = prepare({
      noArtifacts: true,
      normalization: normalization({
        normalizationKind: "SYNTHETIC_INCOMPLETE",
        normalizationStatus: "MISSING",
        issueCodes: ["RESULT_MISSING"],
        syntheticReasonCode: "RESULT_MISSING",
        outcome: "INCOMPLETE",
      }),
    });
    expect(synced.result).toMatchObject({
      outcome: "INCOMPLETE",
      artifactSyncState: "UNAVAILABLE",
    });
  });
  it.each(["PUBLIC", "INTERNAL", "RESTRICTED", "CONFIDENTIAL"] as const)(
    "registers %s artifacts with the canonical Core classification",
    (classificationKey) => {
      const synced = prepare({ descriptor: descriptor({ classificationKey }) });
      const classification = synced.artifactReferences[0]!.classification;
      expect(classification).toEqual(defaultClassificationCatalog.reference(classificationKey));
      expect(
        defaultClassificationCatalog.permits(
          defaultClassificationCatalog.reference("CONFIDENTIAL"),
          classification,
        ),
      ).toBe(true);
    },
  );
  it("rejects an unrecognized runtime artifact classification", () => {
    expect(() =>
      prepare({ descriptor: descriptor({ classificationKey: "UNKNOWN" as never }) }),
    ).toThrow();
  });
  it("prepares one terminal result, same-scope artifact membership, sticky review transition and exact events", () => {
    const synced = prepare();
    expect(synced.result).toMatchObject({
      outcome: "PASS",
      normalizationKind: "SCHEMA_VALIDATED",
      artifactSyncState: "COMPLETE",
    });
    expect(synced.attempt).toMatchObject({
      currentStatus: "TERMINAL",
      terminalResultId: synced.result.automationAttemptResultId,
    });
    expect(synced.session).toEqual({
      previousState: "RUNNING",
      state: "REVIEW_REQUIRED",
      resourceVersion: 4,
      changed: true,
    });
    expect(synced.artifactMemberships).toHaveLength(1);
    expect(synced.artifactReferences[0]).toMatchObject({
      workspaceId,
      projectId,
      owner: { entityType: "AUTOMATION_ATTEMPT", entityId: attemptId },
      availability: "AVAILABLE",
    });
    expect(synced.artifactReferences[0]!.storage.opaqueLocator).not.toContain("awp/results");
    expect(synced.events.map(({ eventType }) => eventType)).toEqual([
      "qa.automation-attempt.status-observed",
      "qa.automation-artifact.registered",
      "qa.automation-attempt.completed",
    ]);
    for (const event of synced.events)
      designContractRegistry.validate({
        schemaRef: event.payloadSchemaRef,
        value: event.payload as never,
      });
  });

  it("keeps REVIEW_REQUIRED sticky and derives only assertion-to-PASS as FLAKY_SUSPECTED", () => {
    const synced = prepare({
      sessionState: "REVIEW_REQUIRED",
      previousLineageResults: [{ attemptNo: 1, outcome: "ASSERTION_FAILED" }],
    });
    expect(synced.session).toEqual({
      previousState: "REVIEW_REQUIRED",
      state: "REVIEW_REQUIRED",
      resourceVersion: 3,
      changed: false,
    });
    expect(synced.reviewFlags).toEqual(["FLAKY_SUSPECTED"]);
  });

  it("fails closed to INCOMPLETE on target and checksum mismatches", () => {
    const targetMismatch = prepare({
      normalization: normalization({ target: { ...target.target, commitSha: "f".repeat(40) } }),
    });
    const checksumMismatch = prepare({ descriptor: descriptor({ checksum: hash("wrong") }) });
    expect(targetMismatch.result).toMatchObject({
      outcome: "INCOMPLETE",
      syntheticReasonCode: "RESULT_TARGET_MISMATCH",
      normalizationReport: { status: "INVALID" },
    });
    expect(checksumMismatch.result).toMatchObject({
      outcome: "INCOMPLETE",
      syntheticReasonCode: "ARTIFACT_CHECKSUM_MISMATCH",
      normalizationReport: { status: "INVALID" },
    });
    expect(checksumMismatch.artifactReferences[0]?.availability).toBe("AVAILABLE");
  });
});
