import { describe, expect, it } from "vitest";

import {
  decideQaAutomationRetry,
  qaAutomationFlakySuspected,
} from "../../../packages/competency-qa/src/application/automation-retry-policy.ts";
import {
  appendAutomationAttemptStatus,
  createAutomationAttemptRecord,
  createAutomationLaunchCommitments,
  createAutomationLaunchConfirmation,
  createQaAutomationAttemptResult,
  type QaAutomationAttemptRecord,
} from "../../../packages/competency-qa/src/domain/automation-attempt.ts";

const hash = (character: string) => `sha256:${character.repeat(64).slice(0, 64)}` as const;
const exact = (id: string, character: string) =>
  Object.freeze({ id, version: 1, contentHash: hash(character) });
const pins = Object.freeze(
  (["SOURCE_CONTEXT", "TEST_EXECUTION", "ARTIFACT_SOURCE"] as const).map((logicalRole, index) =>
    Object.freeze({
      ordinal: index + 1,
      logicalRole,
      capabilityKey: (
        ["source-context.read", "test-executor.trigger-status", "artifact.ci-read"] as const
      )[index]!,
      exactContractVersion: "1.0.0" as const,
      projectIntegrationBindingRef: exact("binding-1", "1"),
      profileRef: exact(`profile-${index}`, "2"),
      connectionRef: exact("connection-1", "3"),
      validationReportRef: exact(`validation-${index}`, "4"),
      operationSetHash: hash("5"),
      externalScopeHash: hash("6"),
    }),
  ),
);

function terminalAttempt(
  input: Readonly<{
    id?: string;
    reason?: "INITIAL" | "AUTO_INFRA_RETRY";
    previous?: readonly QaAutomationAttemptRecord[];
  }> = {},
) {
  const id = input.id ?? "attempt-1";
  const previous = input.previous ?? [];
  const created = createAutomationAttemptRecord({
    automationAttemptId: id,
    workspaceId: "workspace-1",
    projectId: "project-1",
    workItemId: "work-1",
    testSessionId: "session-1",
    planItemId: "item-1",
    reason: input.reason ?? "INITIAL",
    ...(previous.length ? { predecessorAttemptId: previous.at(-1)!.automationAttemptId } : {}),
    launchRequestId: `launch-${id}`,
    requestKeyHash: hash("7"),
    requestHash: hash("8"),
    targetSnapshotRef: "target:1",
    targetSnapshotHash: hash("9"),
    scopeSnapshotHash: hash("a"),
    suiteBindingRef: { id: "suite-1", version: 1 },
    suiteBindingHash: hash("b"),
    parameterSetHash: hash("c"),
    configurationPins: pins,
    configurationPinSetHash: hash("d"),
    resultSchemaRef: { id: "urn:result", version: 1, digest: hash("e") },
    artifactPolicyRef: "artifact-policy",
    artifactPolicyHash: hash("f"),
    retryPolicyRef: "retry-policy",
    retryPolicyHash: hash("1"),
    quarantinePolicyRef: "quarantine-policy",
    quarantinePolicyHash: hash("2"),
    connectorCommandId: `command-${id}`,
    effectKeyHash: hash("3"),
    initiatingHumanId: "human-1",
    executingServiceId: "worker-1",
    authorizationBasisHash: hash("4"),
    externalAuthorityHash: hash("5"),
    createdAt: "2026-09-01T08:00:00.000Z",
    correlationId: `correlation-${id}`,
    causationId: `causation-${id}`,
    previousAttempts: previous,
  });
  const pending = appendAutomationAttemptStatus(created.attempt, created.initialStatus, {
    statusRevisionId: `${id}:status:2`,
    status: "TRIGGER_PENDING",
    providerStatus: "NOT_OBSERVED",
    providerRevisionToken: "pending:1",
    source: "COMMAND_RECEIPT",
    sourceReceiptRef: `command:${id}`,
    sourceReceiptHash: hash("6"),
    observedAt: "2026-09-01T08:00:01.000Z",
    recordedAt: "2026-09-01T08:00:01.000Z",
  });
  const resultId = `result-${id}`;
  return appendAutomationAttemptStatus(pending.attempt, pending.revision, {
    statusRevisionId: `${id}:status:3`,
    status: "TERMINAL",
    providerStatus: "FAILED",
    providerRevisionToken: "terminal:1",
    source: "POLL_READ",
    sourceReceiptRef: `pipeline:${id}`,
    sourceReceiptHash: hash("7"),
    terminalResultId: resultId,
    terminalResultHash: hash("8"),
    observedAt: "2026-09-01T08:05:00.000Z",
    recordedAt: "2026-09-01T08:05:01.000Z",
  }).attempt;
}

function result(
  attempt: QaAutomationAttemptRecord,
  outcome: "PASS" | "ASSERTION_FAILED" | "INFRA_FAILED" | "TIMEOUT" | "CANCELLED" | "INCOMPLETE",
  infrastructureCode?: string,
) {
  if (outcome === "INCOMPLETE")
    return createQaAutomationAttemptResult({
      automationAttemptResultId: attempt.terminalResultId!,
      workspaceId: attempt.workspaceId,
      projectId: attempt.projectId,
      automationAttemptId: attempt.automationAttemptId,
      normalizationKind: "SYNTHETIC_INCOMPLETE",
      outcome,
      resultSchemaRef: attempt.resultSchemaRef,
      normalizationStatus: "MISSING",
      normalizationIssueCodes: ["RESULT_MISSING"],
      syntheticReasonCode: "RESULT_MISSING",
      suiteKey: "smoke",
      environmentRef: "environment:test:qa-1@17",
      artifactDescriptorSetHash: hash("9"),
      artifactSyncState: "UNAVAILABLE",
      terminalAt: "2026-09-01T08:05:00.000Z",
      recordedAt: "2026-09-01T08:05:01.000Z",
    });
  return createQaAutomationAttemptResult({
    automationAttemptResultId: attempt.terminalResultId!,
    workspaceId: attempt.workspaceId,
    projectId: attempt.projectId,
    automationAttemptId: attempt.automationAttemptId,
    normalizationKind: "SCHEMA_VALIDATED",
    outcome,
    resultSchemaRef: attempt.resultSchemaRef,
    normalizationStatus: "VALID",
    normalizationIssueCodes: [],
    sourceResultArtifactRef: "artifact:result",
    externalPipelineId: "201",
    externalJobIds: ["1001"],
    target: { type: "COMMIT", commitSha: "a".repeat(40) },
    suiteKey: "smoke",
    environmentRef: "environment:test:qa-1@17",
    durationMs: 300_000,
    ...(infrastructureCode ? { infrastructureCode } : {}),
    ...(outcome === "CANCELLED" ? { cancellationReasonCode: "HUMAN_CANCELLED" } : {}),
    artifactDescriptorSetHash: hash("9"),
    artifactSyncState: "COMPLETE",
    terminalAt: "2026-09-01T08:05:00.000Z",
    recordedAt: "2026-09-01T08:05:01.000Z",
  });
}

const policy = Object.freeze({
  policyRef: "policy:retry:v1",
  policyHash: hash("a"),
  automaticRetryBudget: 1 as const,
  allowedInfrastructureCodes: Object.freeze(["RUNNER_UNAVAILABLE", "SERVICE_DEPENDENCY_TIMEOUT"]),
});
const authority = Object.freeze({
  authorizationAllowed: true,
  policyAllowed: true,
  quarantineActive: false,
  configurationPinsCurrent: true,
  targetCurrent: true,
  authorizationRecheckHash: hash("b"),
});
const service = Object.freeze({
  kind: "SERVICE" as const,
  principalId: "worker-1",
  serviceKey: "qa-automation-retry",
});
const evaluate = (
  attempt: QaAutomationAttemptRecord,
  technicalResult: ReturnType<typeof result>,
  overrides: Partial<Parameters<typeof decideQaAutomationRetry>[0]["authority"]> = {},
  lineage: readonly QaAutomationAttemptRecord[] = [attempt],
) =>
  decideQaAutomationRetry({
    attempt,
    result: technicalResult,
    lineage,
    policy,
    authority: { ...authority, ...overrides },
    decidedBy: service,
    decidedAt: "2026-09-01T08:05:02.000Z",
    correlationId: "correlation-1",
    causationId: "causation-1",
  });

describe("QA-owned automation retry policy", () => {
  it.each(["PASS", "ASSERTION_FAILED", "TIMEOUT", "CANCELLED", "INCOMPLETE"] as const)(
    "never auto-retries %s",
    (outcome) => {
      const attempt = terminalAttempt();
      expect(evaluate(attempt, result(attempt, outcome)).decision).toMatchObject({
        decision: "NOT_APPLICABLE",
        reasonCode: "OUTCOME_INELIGIBLE",
      });
    },
  );

  it("distinguishes missing/unknown infra codes and schedules one deterministic allowlisted successor", () => {
    const attempt = terminalAttempt();
    expect(evaluate(attempt, result(attempt, "INFRA_FAILED")).decision.reasonCode).toBe(
      "INFRA_CODE_MISSING",
    );
    expect(
      evaluate(attempt, result(attempt, "INFRA_FAILED", "UNKNOWN_INFRA")).decision.reasonCode,
    ).toBe("INFRA_CODE_NOT_ALLOWLISTED");
    const scheduled = evaluate(attempt, result(attempt, "INFRA_FAILED", "RUNNER_UNAVAILABLE"));
    expect(scheduled.decision).toMatchObject({
      decision: "SCHEDULED",
      reasonCode: "SCHEDULED_ALLOWLISTED_INFRA",
      automaticRetryOrdinal: 1,
    });
    expect(scheduled.successor).toMatchObject({
      reason: "AUTO_INFRA_RETRY",
      predecessorAttemptId: attempt.automationAttemptId,
      attemptNo: 2,
      causalHumanId: attempt.initiatingHumanId,
    });
    expect(evaluate(attempt, result(attempt, "INFRA_FAILED", "RUNNER_UNAVAILABLE"))).toEqual(
      scheduled,
    );
  });

  it.each([
    [{ authorizationAllowed: false }, "AUTHORIZATION_DENIED"],
    [{ quarantineActive: true }, "QUARANTINE_ACTIVE"],
    [{ policyAllowed: false }, "POLICY_DENIED"],
    [{ configurationPinsCurrent: false }, "CONFIGURATION_PIN_CHANGED"],
    [{ targetCurrent: false }, "TARGET_CHANGED"],
  ] as const)("settles eligible infra as DENIED for %s", (overrides, reasonCode) => {
    const attempt = terminalAttempt();
    expect(
      evaluate(attempt, result(attempt, "INFRA_FAILED", "RUNNER_UNAVAILABLE"), overrides).decision,
    ).toMatchObject({ decision: "DENIED", reasonCode });
  });

  it("denies a second automatic retry in one contiguous lineage", () => {
    const first = terminalAttempt();
    const second = terminalAttempt({
      id: "attempt-2",
      reason: "AUTO_INFRA_RETRY",
      previous: [first],
    });
    expect(
      evaluate(second, result(second, "INFRA_FAILED", "RUNNER_UNAVAILABLE"), {}, [first, second])
        .decision,
    ).toMatchObject({ decision: "NOT_APPLICABLE", reasonCode: "RETRY_BUDGET_EXHAUSTED" });
  });

  it("derives flaky suspicion only from assertion failure followed by PASS", () => {
    expect(
      qaAutomationFlakySuspected([
        { attemptNo: 1, outcome: "ASSERTION_FAILED" },
        { attemptNo: 2, outcome: "PASS" },
      ]),
    ).toBe(true);
    expect(
      qaAutomationFlakySuspected([
        { attemptNo: 1, outcome: "INFRA_FAILED" },
        { attemptNo: 2, outcome: "PASS" },
      ]),
    ).toBe(false);
    expect(qaAutomationFlakySuspected([{ attemptNo: 1, outcome: "PASS" }])).toBe(false);
  });

  it("requires a fresh server confirmation/resource version for an explicit HUMAN rerun", () => {
    const issued = createAutomationLaunchConfirmation({
      reason: "HUMAN_RERUN",
      targetSnapshotHash: hash("1"),
      suiteBindingHash: hash("2"),
      configurationPinSetHash: hash("3"),
      sessionResourceVersion: 4,
    });
    expect(
      createAutomationLaunchCommitments({
        workspaceId: "workspace-1",
        projectId: "project-1",
        testSessionId: "session-1",
        planItemId: "item-1",
        parameterSetHash: hash("4"),
        idempotencyKey: "human-rerun-key",
        confirmation: issued,
      }).confirmationHash,
    ).toBe(issued.confirmationHash);
    expect(() =>
      createAutomationLaunchCommitments({
        workspaceId: "workspace-1",
        projectId: "project-1",
        testSessionId: "session-1",
        planItemId: "item-1",
        parameterSetHash: hash("4"),
        idempotencyKey: "human-rerun-key",
        confirmation: { ...issued, sessionResourceVersion: 5 },
      }),
    ).toThrow("QA_AUTOMATION_LAUNCH_CONFIRMATION_MISMATCH");
  });
});
