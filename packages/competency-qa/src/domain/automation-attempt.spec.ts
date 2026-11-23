import { describe, expect, it } from "vitest";

import {
  appendAutomationAttemptStatus,
  createAutomationAttemptRecord,
  createAutomationLaunchCommitments,
  createAutomationLaunchConfirmation,
} from "./automation-attempt.ts";

const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const;
const exact = (id: string, digit: string) => ({ id, version: 1, contentHash: hash(digit) });

const pins = [
  ["SOURCE_CONTEXT", "source-context.read"],
  ["TEST_EXECUTION", "test-executor.trigger-status"],
  ["ARTIFACT_SOURCE", "artifact.ci-read"],
].map(([logicalRole, capabilityKey], index) => ({
  ordinal: index + 1,
  logicalRole: logicalRole as "SOURCE_CONTEXT" | "TEST_EXECUTION" | "ARTIFACT_SOURCE",
  capabilityKey: capabilityKey as
    "source-context.read" | "test-executor.trigger-status" | "artifact.ci-read",
  exactContractVersion: "1.0.0" as const,
  projectIntegrationBindingRef: exact("binding-1", "1"),
  profileRef: exact(`profile-${index + 1}`, "2"),
  connectionRef: exact("connection-1", "3"),
  validationReportRef: exact(`validation-${index + 1}`, "4"),
  operationSetHash: hash("5"),
  externalScopeHash: hash("6"),
}));

const confirmation = () =>
  createAutomationLaunchConfirmation({
    reason: "INITIAL",
    targetSnapshotHash: hash("a"),
    suiteBindingHash: hash("b"),
    configurationPinSetHash: hash("c"),
    sessionResourceVersion: 1,
  });

const commitments = () =>
  createAutomationLaunchCommitments({
    workspaceId: "workspace-1",
    projectId: "project-1",
    testSessionId: "session-1",
    planItemId: "item-1",
    parameterSetHash: hash("d"),
    idempotencyKey: "launch-key-1",
    confirmation: confirmation(),
  });

function attemptInput(id = "attempt-1") {
  const launch = commitments();
  return {
    automationAttemptId: id,
    workspaceId: "workspace-1",
    projectId: "project-1",
    workItemId: "work-1",
    testSessionId: "session-1",
    planItemId: "item-1",
    reason: "INITIAL" as const,
    launchRequestId: "launch-1",
    requestKeyHash: launch.requestKeyHash,
    requestHash: launch.requestHash,
    targetSnapshotRef: "qa-target:session-1",
    targetSnapshotHash: hash("a"),
    scopeSnapshotHash: hash("e"),
    suiteBindingRef: { id: "suite-1", version: 1 },
    suiteBindingHash: hash("b"),
    parameterSetHash: hash("d"),
    configurationPins: pins,
    configurationPinSetHash: hash("c"),
    resultSchemaRef: { id: "urn:test:result", version: 1, digest: hash("f") },
    artifactPolicyRef: "qa-policy:artifact:v1",
    artifactPolicyHash: hash("1"),
    retryPolicyRef: "qa-policy:retry:v1",
    retryPolicyHash: hash("2"),
    quarantinePolicyRef: "qa-policy:quarantine:v1",
    quarantinePolicyHash: hash("3"),
    connectorCommandId: "command-1",
    effectKeyHash: launch.effectKeyHash,
    initiatingHumanId: "human-1",
    executingServiceId: "worker-1",
    authorizationBasisHash: hash("4"),
    externalAuthorityHash: hash("5"),
    createdAt: "2026-09-01T08:00:00.000Z",
    correlationId: "correlation-1",
    causationId: "causation-1",
  };
}

describe("AutomationAttempt launch domain", () => {
  it("creates a server-verifiable launch confirmation and rejects a changed echo", () => {
    const issued = confirmation();
    expect(issued.actionHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(issued.confirmationHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(issued)).toBe(true);

    expect(() =>
      createAutomationLaunchCommitments({
        workspaceId: "workspace-1",
        projectId: "project-1",
        testSessionId: "session-1",
        planItemId: "item-1",
        parameterSetHash: hash("d"),
        idempotencyKey: "launch-key-1",
        confirmation: { ...issued, sessionResourceVersion: 2 },
      }),
    ).toThrow("QA_AUTOMATION_LAUNCH_CONFIRMATION_MISMATCH");
  });

  it("keeps the semantic request hash actor-independent and derives one deterministic effect key", () => {
    const first = commitments();
    const sameSemanticsOtherKey = createAutomationLaunchCommitments({
      workspaceId: "workspace-1",
      projectId: "project-1",
      testSessionId: "session-1",
      planItemId: "item-1",
      parameterSetHash: hash("d"),
      idempotencyKey: "launch-key-2",
      confirmation: confirmation(),
    });
    expect(sameSemanticsOtherKey.requestHash).toBe(first.requestHash);
    expect(sameSemanticsOtherKey.requestKeyHash).not.toBe(first.requestKeyHash);
    expect(sameSemanticsOtherKey.effectKeyHash).not.toBe(first.effectKeyHash);
    expect(commitments()).toEqual(first);
    expect(Object.keys(first)).not.toContain("actorId");
  });

  it("creates a deeply immutable initial identity with a CREATED revision", () => {
    const created = createAutomationAttemptRecord({ ...attemptInput(), previousAttempts: [] });
    expect(created.attempt).toMatchObject({
      schemaVersion: "automation-attempt@1.0.0",
      automationAttemptId: "attempt-1",
      attemptNo: 1,
      reason: "INITIAL",
      rootAttemptId: "attempt-1",
      currentStatus: "CREATED",
      currentStatusRevisionNo: 1,
    });
    expect(created.initialStatus).toMatchObject({
      revisionNo: 1,
      status: "CREATED",
      providerStatus: "NOT_OBSERVED",
    });
    expect(created.attempt.identityContentHash).toMatch(/^sha256:/u);
    expect(Object.isFrozen(created.attempt.configurationPins[0])).toBe(true);
    expect(
      () => ((created.attempt.configurationPins[0] as { ordinal: number }).ordinal = 9),
    ).toThrow();
  });

  it("allocates contiguous lineage and rejects gaps or a foreign predecessor", () => {
    const first = createAutomationAttemptRecord({
      ...attemptInput(),
      previousAttempts: [],
    }).attempt;
    const secondInput = {
      ...attemptInput("attempt-2"),
      reason: "HUMAN_RERUN" as const,
      launchRequestId: "launch-2",
      connectorCommandId: "command-2",
      predecessorAttemptId: first.automationAttemptId,
      previousAttempts: [first],
    };
    const second = createAutomationAttemptRecord(secondInput).attempt;
    expect(second).toMatchObject({
      attemptNo: 2,
      rootAttemptId: "attempt-1",
      predecessorAttemptId: "attempt-1",
      reason: "HUMAN_RERUN",
    });

    expect(() =>
      createAutomationAttemptRecord({
        ...secondInput,
        automationAttemptId: "attempt-3",
        previousAttempts: [second],
      }),
    ).toThrow("QA_AUTOMATION_ATTEMPT_SEQUENCE_NOT_CONTIGUOUS");
    expect(() =>
      createAutomationAttemptRecord({
        ...secondInput,
        automationAttemptId: "attempt-3",
        predecessorAttemptId: "foreign",
        previousAttempts: [first, second],
      }),
    ).toThrow("QA_AUTOMATION_ATTEMPT_PREDECESSOR_INVALID");
  });

  it("appends only a contiguous CREATED to TRIGGER_PENDING launch transition", () => {
    const created = createAutomationAttemptRecord({ ...attemptInput(), previousAttempts: [] });
    const advanced = appendAutomationAttemptStatus(created.attempt, created.initialStatus, {
      statusRevisionId: "status-attempt-1-2",
      status: "TRIGGER_PENDING",
      providerStatus: "NOT_OBSERVED",
      providerRevisionToken: "trigger-pending:1",
      source: "COMMAND_RECEIPT",
      sourceReceiptRef: "core-command:command-1",
      sourceReceiptHash: hash("7"),
      observedAt: "2026-09-01T08:00:00.010Z",
      recordedAt: "2026-09-01T08:00:00.011Z",
    });
    expect(advanced.attempt).toMatchObject({
      currentStatus: "TRIGGER_PENDING",
      currentStatusRevisionNo: 2,
      resourceVersion: 2,
    });
    expect(advanced.revision).toMatchObject({
      revisionNo: 2,
      previousRevisionId: created.initialStatus.statusRevisionId,
      previousStateHash: created.initialStatus.observationHash,
    });
    expect(created.attempt.currentStatus).toBe("CREATED");

    expect(() =>
      appendAutomationAttemptStatus(created.attempt, created.initialStatus, {
        statusRevisionId: "status-attempt-1-2",
        status: "RUNNING",
        providerStatus: "RUNNING",
        providerRevisionToken: "running:1",
        source: "POLL_READ",
        sourceReceiptRef: "poll:1",
        sourceReceiptHash: hash("8"),
        observedAt: "2026-09-01T08:00:01.000Z",
        recordedAt: "2026-09-01T08:00:01.001Z",
      }),
    ).toThrow("QA_AUTOMATION_STATUS_TRANSITION_INVALID");
  });
});
