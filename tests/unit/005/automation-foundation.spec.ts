import { describe, expect, it } from "vitest";

import {
  completeAutomationAttemptReview,
  createAutomationAttempt,
  createAutomationSessionFoundation,
  createAutomationSuiteBinding,
  createQaAttemptIdentity,
  recordAutomationTerminalResult,
} from "../../../packages/competency-qa/src/node.ts";

const hash = `sha256:${"a".repeat(64)}` as const;
const anotherHash = `sha256:${"b".repeat(64)}` as const;
const human = Object.freeze({
  kind: "HUMAN" as const,
  principalId: "human-1",
  issuer: "local",
  subject: "human-1",
});
const service = Object.freeze({
  kind: "SERVICE" as const,
  principalId: "worker-1",
  serviceKey: "qa-worker",
});

function pin(
  logicalRole: "SOURCE_CONTEXT" | "TEST_EXECUTION" | "ARTIFACT_SOURCE",
  ordinal: number,
) {
  return {
    ordinal,
    logicalRole,
    capabilityKey:
      logicalRole === "SOURCE_CONTEXT"
        ? ("source-context.read" as const)
        : logicalRole === "TEST_EXECUTION"
          ? ("test-executor.trigger-status" as const)
          : ("artifact.ci-read" as const),
    exactContractVersion: "1.0.0" as const,
    profileRef: { id: `profile-${ordinal}`, version: 1, contentHash: hash },
    connectionRef: { id: "connection-1", version: 1, contentHash: hash },
    validationReportRef: { id: `validation-${ordinal}`, version: 1, contentHash: hash },
  };
}

describe("QA automation foundation", () => {
  it("pins exactly one immutable Suite and exactly three ordered logical roles per Session", () => {
    const suite = createAutomationSuiteBinding({
      id: "suite-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      suiteKey: "smoke",
      version: 1,
      state: "PUBLISHED",
      ownerPrincipalId: "human-1",
      definitionRef: { id: "suite-definition", version: 1, contentHash: hash },
      contentHash: anotherHash,
    });
    const session = createAutomationSessionFoundation({
      sessionId: "session-1",
      suiteBindingRefs: [{ id: suite.id, version: suite.version, contentHash: suite.contentHash }],
      configurationPins: [
        pin("SOURCE_CONTEXT", 1),
        pin("TEST_EXECUTION", 2),
        pin("ARTIFACT_SOURCE", 3),
      ],
    });

    expect(session.suiteBindingRef.id).toBe("suite-1");
    expect(session.configurationPins.map(({ logicalRole }) => logicalRole)).toEqual([
      "SOURCE_CONTEXT",
      "TEST_EXECUTION",
      "ARTIFACT_SOURCE",
    ]);
    expect(Object.isFrozen(session.configurationPins)).toBe(true);
    expect(() =>
      createAutomationSessionFoundation({
        sessionId: "session-2",
        suiteBindingRefs: [],
        configurationPins: session.configurationPins,
      }),
    ).toThrow("QA_AUTOMATION_SUITE_EXACTLY_ONE_REQUIRED");
  });

  it("uses one shared MANUAL/AUTOMATED identity and derives contiguous attempt numbers", () => {
    const manual = createQaAttemptIdentity({
      id: "attempt-manual",
      workspaceId: "workspace-1",
      projectId: "project-1",
      workItemId: "work-1",
      sessionId: "session-manual",
      planItemId: "plan-manual",
      mode: "MANUAL",
      previousAttemptNumbers: [],
      targetSnapshotHash: hash,
      scopeSnapshotHash: anotherHash,
      triggerKind: "HUMAN_MANUAL",
      initiator: human,
      authorizationBasisHash: hash,
      correlationId: "correlation-manual",
      causationId: "causation-manual",
      createdAt: "2026-09-01T08:00:00.000Z",
    });
    const automated = createQaAttemptIdentity({
      ...manual,
      id: "attempt-auto-3",
      sessionId: "session-auto",
      planItemId: "plan-auto",
      mode: "AUTOMATED",
      previousAttemptNumbers: [1, 2],
      triggerKind: "AUTO_INFRA_RETRY",
      initiator: service,
      authorizationBasisHash: anotherHash,
    });

    expect(manual).toMatchObject({ mode: "MANUAL", attemptNo: 1 });
    expect(automated).toMatchObject({ mode: "AUTOMATED", attemptNo: 3 });
    expect(() =>
      createQaAttemptIdentity({ ...automated, id: "attempt-gap", previousAttemptNumbers: [1, 3] }),
    ).toThrow("QA_ATTEMPT_SEQUENCE_NOT_CONTIGUOUS");
  });

  it("allows one terminal result, makes review sticky, and permits only HUMAN completion", () => {
    const identity = createQaAttemptIdentity({
      id: "attempt-auto-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      workItemId: "work-1",
      sessionId: "session-auto",
      planItemId: "plan-auto",
      mode: "AUTOMATED",
      previousAttemptNumbers: [],
      targetSnapshotHash: hash,
      scopeSnapshotHash: anotherHash,
      triggerKind: "HUMAN_LAUNCH",
      initiator: human,
      authorizationBasisHash: hash,
      correlationId: "correlation-auto",
      causationId: "causation-auto",
      createdAt: "2026-09-01T08:00:00.000Z",
    });
    const terminal = recordAutomationTerminalResult(createAutomationAttempt(identity), {
      resultId: "result-1",
      result: "PASS",
      observedAt: "2026-09-01T08:05:00.000Z",
    });

    expect(terminal).toMatchObject({ state: "REVIEW_REQUIRED", terminalResultId: "result-1" });
    expect(() =>
      recordAutomationTerminalResult(terminal, {
        resultId: "result-2",
        result: "ASSERTION_FAILED",
        observedAt: "2026-09-01T08:06:00.000Z",
      }),
    ).toThrow("QA_AUTOMATION_TERMINAL_RESULT_ALREADY_RECORDED");
    expect(() =>
      completeAutomationAttemptReview(terminal, service, "2026-09-01T08:07:00.000Z"),
    ).toThrow("QA_AUTOMATION_HUMAN_REVIEW_REQUIRED");
    expect(
      completeAutomationAttemptReview(terminal, human, "2026-09-01T08:07:00.000Z"),
    ).toMatchObject({ state: "COMPLETED" });
  });
});
