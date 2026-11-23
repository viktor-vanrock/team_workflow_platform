import { describe, expect, it } from "vitest";

import {
  appendAutomationAttemptStatus,
  createAutomatedTargetSnapshot,
  createAutomationAttemptRecord,
  createAutomationLaunchConfirmation,
  prepareHumanAutomationLaunch,
  qaAggregateSnapshotHash,
} from "../../../packages/competency-qa/src/index.ts";

const hash = (value: string) => qaAggregateSnapshotHash(value as never);
const exact = (id: string, seed: string) =>
  Object.freeze({ id, version: 1, contentHash: hash(seed) });
const workspaceId = "550e8400-e29b-41d4-a716-446655440301";
const projectId = "550e8400-e29b-41d4-a716-446655440302";
const workItemId = "550e8400-e29b-41d4-a716-446655440303";
const sessionId = "550e8400-e29b-41d4-a716-446655440304";
const planItemId = "550e8400-e29b-41d4-a716-446655440305";
const actor = Object.freeze({
  kind: "HUMAN" as const,
  principalId: "550e8400-e29b-41d4-a716-446655440306",
  issuer: "local",
  subject: "executor.alpha",
});
const service = Object.freeze({
  kind: "SERVICE" as const,
  principalId: "550e8400-e29b-41d4-a716-446655440307",
  serviceKey: "qa-automation",
});
const authorizationBasis = Object.freeze({
  kind: "PROJECT" as const,
  policyVersion: "qa-automation-launch@1",
  membershipRef: { id: "550e8400-e29b-41d4-a716-446655440308", version: 1 },
  roleAssignmentRefs: [{ id: "550e8400-e29b-41d4-a716-446655440309", version: 1 }],
  entitlementRefs: [{ id: "550e8400-e29b-41d4-a716-446655440310", version: 1 }],
  skillContext: "NOT_APPLICABLE" as const,
});
const authorizationBasisHash = qaAggregateSnapshotHash(authorizationBasis as never);
const pins = Object.freeze(
  (
    [
      ["SOURCE_CONTEXT", "source-context.read"],
      ["TEST_EXECUTION", "test-executor.trigger-status"],
      ["ARTIFACT_SOURCE", "artifact.ci-read"],
    ] as const
  ).map(([logicalRole, capabilityKey], index) =>
    Object.freeze({
      ordinal: index + 1,
      logicalRole,
      capabilityKey,
      exactContractVersion: "1.0.0" as const,
      projectIntegrationBindingRef: exact("550e8400-e29b-41d4-a716-446655440311", "binding"),
      profileRef: exact(`550e8400-e29b-41d4-a716-44665544031${index + 2}`, `profile-${index}`),
      connectionRef: exact(
        `550e8400-e29b-41d4-a716-44665544032${index + 2}`,
        `connection-${index}`,
      ),
      validationReportRef: exact(
        `550e8400-e29b-41d4-a716-44665544033${index + 2}`,
        `validation-${index}`,
      ),
      operationSetHash: hash(`operations-${index}`),
      externalScopeHash: hash("project-5001"),
    }),
  ),
);
const resultSchemaRef = exact("urn:awp:schemas:005:gitlab-pipeline-result:v1", "result-schema");
const target = createAutomatedTargetSnapshot({
  workspaceId,
  projectId,
  workItemId,
  testSessionId: sessionId,
  sourceIssueKey: "QA-5001",
  target: { type: "MERGE_REQUEST", mergeRequestRef: "5001:17", commitSha: "a".repeat(40) },
  environment: { environmentRef: "environment:test:qa-1@17", revision: 17, class: "TEST" },
  suite: {
    suiteKey: "smoke",
    suiteBindingRef: { id: "550e8400-e29b-41d4-a716-446655440341", version: 1 },
    suiteBindingHash: hash("suite"),
    parameterSchemaRef: exact("550e8400-e29b-41d4-a716-446655440342", "parameters"),
    acceptedParameters: { browser: "chromium" },
  },
  configurationPins: pins,
  executionPolicies: {
    resultSchemaRef,
    artifactPolicyRef: exact("550e8400-e29b-41d4-a716-446655440343", "artifact-policy"),
    retryPolicyRef: exact("550e8400-e29b-41d4-a716-446655440344", "retry-policy"),
    quarantinePolicyRef: exact("550e8400-e29b-41d4-a716-446655440345", "quarantine-policy"),
  },
  testDataRefs: [
    { kind: "TEST_DATA", id: "rerun-dataset", version: "1", contentHash: hash("rerun-dataset") },
  ],
  accountLeaseRefs: [],
  capturedAt: "2026-09-01T08:00:00.000Z",
});

function previousAttempt() {
  const created = createAutomationAttemptRecord({
    automationAttemptId: "550e8400-e29b-41d4-a716-446655440350",
    workspaceId,
    projectId,
    workItemId,
    testSessionId: sessionId,
    planItemId,
    reason: "INITIAL",
    launchRequestId: "550e8400-e29b-41d4-a716-446655440351",
    requestKeyHash: hash("reused-request-key"),
    requestHash: hash("initial-request"),
    targetSnapshotRef: "qa-target:session-1",
    targetSnapshotHash: target.snapshotHash,
    scopeSnapshotHash: hash("scope"),
    suiteBindingRef: target.suite.suiteBindingRef,
    suiteBindingHash: target.suite.suiteBindingHash,
    parameterSetHash: target.suite.parametersHash,
    configurationPins: pins,
    configurationPinSetHash: target.configurationPinSetHash,
    resultSchemaRef: {
      id: resultSchemaRef.id,
      version: resultSchemaRef.version,
      digest: resultSchemaRef.contentHash,
    },
    artifactPolicyRef: "artifact-policy@1",
    artifactPolicyHash: hash("artifact-policy"),
    retryPolicyRef: "retry-policy@1",
    retryPolicyHash: hash("retry-policy"),
    quarantinePolicyRef: "quarantine-policy@1",
    quarantinePolicyHash: hash("quarantine-policy"),
    connectorCommandId: "550e8400-e29b-41d4-a716-446655440352",
    effectKeyHash: hash("effect"),
    initiatingHumanId: actor.principalId,
    executingServiceId: service.principalId,
    authorizationBasisHash,
    externalAuthorityHash: hash("authority"),
    previousAttempts: [],
    createdAt: "2026-09-01T08:00:00.000Z",
    correlationId: "550e8400-e29b-41d4-a716-446655440353",
    causationId: "550e8400-e29b-41d4-a716-446655440354",
  });
  const pending = appendAutomationAttemptStatus(created.attempt, created.initialStatus, {
    statusRevisionId: "550e8400-e29b-41d4-a716-446655440355",
    status: "TRIGGER_PENDING",
    providerStatus: "NOT_OBSERVED",
    providerRevisionToken: "pending:1",
    source: "COMMAND_RECEIPT",
    sourceReceiptRef: "core-command:initial",
    sourceReceiptHash: hash("pending"),
    observedAt: "2026-09-01T08:00:01.000Z",
    recordedAt: "2026-09-01T08:00:01.000Z",
  });
  return appendAutomationAttemptStatus(pending.attempt, pending.revision, {
    statusRevisionId: "550e8400-e29b-41d4-a716-446655440356",
    status: "TERMINAL",
    providerStatus: "SUCCESS",
    providerRevisionToken: "success:1",
    source: "POLL_READ",
    sourceReceiptRef: "gitlab-pipeline:101",
    sourceReceiptHash: hash("terminal"),
    terminalResultId: "550e8400-e29b-41d4-a716-446655440357",
    terminalResultHash: hash("result"),
    observedAt: "2026-09-01T08:05:00.000Z",
    recordedAt: "2026-09-01T08:05:01.000Z",
  }).attempt;
}

function rerun(idempotencyKey: string, ifMatch = 4) {
  const previous = previousAttempt();
  const subject = Object.freeze({
    workspaceId,
    projectId,
    workItemId,
    testSessionId: sessionId,
    planItemId,
    sessionState: "REVIEW_REQUIRED" as const,
    planItemState: "PLANNED",
    sessionResourceVersion: 4,
    targetSnapshotRef: "qa-target:session-1",
    targetSnapshotHash: target.snapshotHash,
    scopeSnapshotHash: previous.scopeSnapshotHash,
    suiteBindingRef: {
      ...target.suite.suiteBindingRef,
      contentHash: target.suite.suiteBindingHash,
    },
    parameterSetHash: target.suite.parametersHash,
    configurationPinSetHash: target.configurationPinSetHash,
    targetSnapshot: target,
  });
  return prepareHumanAutomationLaunch({
    subject,
    idempotencyKey,
    ifMatch,
    confirmation: createAutomationLaunchConfirmation({
      reason: "HUMAN_RERUN",
      targetSnapshotHash: target.snapshotHash,
      suiteBindingHash: target.suite.suiteBindingHash,
      configurationPinSetHash: target.configurationPinSetHash,
      sessionResourceVersion: 4,
    }),
    actor,
    executingService: service,
    authorizationBasis,
    authorizationBasisHash,
    previousAttempts: [previous],
    launchRequestId: "550e8400-e29b-41d4-a716-446655440360",
    automationAttemptId: "550e8400-e29b-41d4-a716-446655440361",
    connectorCommandId: "550e8400-e29b-41d4-a716-446655440362",
    correlationId: "550e8400-e29b-41d4-a716-446655440363",
    causationId: "550e8400-e29b-41d4-a716-446655440364",
    launchedAt: "2026-09-01T08:06:00.000Z",
  });
}

describe("explicit HUMAN automation rerun", () => {
  it("requires REVIEW_REQUIRED, a fresh request key/version, and creates a new immutable Attempt", () => {
    expect(rerun("fresh-human-rerun-key")).toMatchObject({
      attempt: { attemptNo: 2, reason: "HUMAN_RERUN", currentStatus: "TRIGGER_PENDING" },
      launchRequest: { origin: "HUMAN_RERUN", initiatorKind: "HUMAN" },
    });
    expect(() => rerun("reused-request-key")).toThrow(
      "QA_AUTOMATION_HUMAN_RERUN_FRESH_REQUEST_KEY_REQUIRED",
    );
    expect(() => rerun("fresh-human-rerun-key", 3)).toThrow("QA_AUTOMATION_LAUNCH_STALE_VERSION");
  });
});
