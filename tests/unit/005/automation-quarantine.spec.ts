import { describe, expect, it } from "vitest";

import {
  activateQaAutomationQuarantine,
  projectQaAutomationQuarantine,
  qaAggregateSnapshotHash,
  type QaAutomationQuarantinePolicy,
  reviseQaAutomationQuarantine,
} from "../../../packages/competency-qa/src/index.ts";
import { designContractRegistry } from "../../../packages/platform-contracts/src/index.ts";

const hash = (value: string) => qaAggregateSnapshotHash(value as never);
const workspaceId = "550e8400-e29b-41d4-a716-446655440201";
const projectId = "550e8400-e29b-41d4-a716-446655440202";
const actorId = "550e8400-e29b-41d4-a716-446655440203";
const ownerId = "550e8400-e29b-41d4-a716-446655440204";
const quarantineId = "550e8400-e29b-41d4-a716-446655440205";
const policy: QaAutomationQuarantinePolicy = Object.freeze({
  policyRef: "policy:qa-automation-quarantine:v1",
  policyHash: hash("quarantine-policy"),
  maximumLifetimeSeconds: 86_400,
  allowedSubjectKinds: Object.freeze(["SUITE_BINDING_VERSION", "INFRASTRUCTURE_CODE"] as const),
} as const);
const context = Object.freeze({
  actor: Object.freeze({
    kind: "HUMAN" as const,
    principalId: actorId,
    issuer: "local",
    subject: "executor.alpha",
  } as const),
  scope: Object.freeze({ kind: "PROJECT" as const, workspaceId, projectId } as const),
  correlationId: "550e8400-e29b-41d4-a716-446655440206",
  causationId: "550e8400-e29b-41d4-a716-446655440207",
} as const);
const originalFailure = "evidence:attempt:assertion-failed:1";

function activate(overrides: Readonly<Record<string, unknown>> = {}) {
  return activateQaAutomationQuarantine({
    context,
    quarantineId,
    quarantineRevisionId: "550e8400-e29b-41d4-a716-446655440208",
    subject: { kind: "INFRASTRUCTURE_CODE", infrastructureCode: "RUNNER_UNAVAILABLE" },
    ownerPrincipalId: ownerId,
    reason: "Runner pool is unstable and requires accountable isolation.",
    evidenceRefs: [originalFailure, "evidence:incident:runner-pool"],
    originalFailureEvidenceRefs: [originalFailure],
    policy,
    expiresAt: "2026-09-02T08:00:00.000Z",
    authorizationBasisHash: hash("authorization"),
    createdAt: "2026-09-01T08:00:00.000Z",
    sessionState: "REVIEW_REQUIRED",
    reviewFreeze: Object.freeze({
      freezeId: "550e8400-e29b-41d4-a716-446655440209",
      attemptSetHash: hash("attempt-set"),
    } as const),
    ...overrides,
  } as Parameters<typeof activateQaAutomationQuarantine>[0]);
}

describe("QA automation quarantine lifecycle", () => {
  it("creates an accountable activation and derives clock expiry without appending a revision", () => {
    const created = activate();
    expect(created.quarantine).toMatchObject({
      currentAction: "ACTIVATE",
      currentRevisionNo: 1,
      resourceVersion: 1,
    });
    expect(
      projectQaAutomationQuarantine(created.quarantine, new Date("2026-09-01T09:00:00.000Z")),
    ).toMatchObject({ effectiveState: "ACTIVE" });
    const expired = projectQaAutomationQuarantine(
      created.quarantine,
      new Date("2026-09-02T08:00:00.000Z"),
    );
    expect(expired).toMatchObject({
      effectiveState: "EXPIRED",
      currentRevisionNo: 1,
      resourceVersion: 1,
    });
    designContractRegistry.validateById("urn:awp:schemas:005:automation-quarantine:v1", expired);
    designContractRegistry.validate({
      schemaRef: created.event.payloadSchemaRef,
      value: created.event.payload as never,
    });
  });

  it("appends a HUMAN lift, preserves original failure evidence/freeze, and never reopens a completed Session", () => {
    const created = activate({ sessionState: "COMPLETED" });
    const lifted = reviseQaAutomationQuarantine({
      context,
      quarantine: created.quarantine,
      previousRevision: created.revision,
      quarantineRevisionId: "550e8400-e29b-41d4-a716-446655440210",
      action: "LIFT",
      ownerPrincipalId: ownerId,
      reason: "Runner incident is resolved; preserve all original failure evidence.",
      evidenceRefs: [...created.revision.evidenceRefs, "evidence:incident:resolved"],
      originalFailureEvidenceRefs: created.revision.evidenceRefs,
      policy,
      authorizationBasisHash: hash("authorization-lift"),
      createdAt: "2026-09-01T10:00:00.000Z",
      expectedResourceVersion: 1,
      sessionState: "COMPLETED",
      ...(created.preservedReviewFreeze ? { reviewFreeze: created.preservedReviewFreeze } : {}),
    });
    expect(lifted.revision).toMatchObject({
      revisionNo: 2,
      action: "LIFT",
      previousRevisionId: created.revision.quarantineRevisionId,
    });
    expect(lifted.revision.evidenceRefs).toContain(originalFailure);
    expect(lifted.sessionState).toBe("COMPLETED");
    expect(lifted.preservedReviewFreeze).toEqual(created.preservedReviewFreeze);
    expect(
      projectQaAutomationQuarantine(lifted.quarantine, new Date("2026-09-03T08:00:00.000Z")),
    ).toMatchObject({ effectiveState: "INACTIVE" });
    designContractRegistry.validate({
      schemaRef: lifted.event.payloadSchemaRef,
      value: lifted.event.payload as never,
    });
  });

  it("denies non-human, overlong activation and evidence loss", () => {
    expect(() =>
      activate({
        context: {
          ...context,
          actor: { kind: "SERVICE", principalId: actorId, serviceKey: "worker" },
        },
      }),
    ).toThrow("QA_VERIFIED_HUMAN_REQUIRED");
    expect(() => activate({ expiresAt: "2026-09-03T08:00:01.000Z" })).toThrow(
      "QA_AUTOMATION_QUARANTINE_EXPIRY_INVALID",
    );
    const created = activate();
    expect(() =>
      reviseQaAutomationQuarantine({
        context,
        quarantine: created.quarantine,
        previousRevision: created.revision,
        quarantineRevisionId: "550e8400-e29b-41d4-a716-446655440211",
        action: "LIFT",
        ownerPrincipalId: ownerId,
        reason: "Attempt to lose original evidence.",
        evidenceRefs: ["evidence:replacement"],
        originalFailureEvidenceRefs: ["evidence:replacement"],
        policy,
        authorizationBasisHash: hash("authorization-lift"),
        createdAt: "2026-09-01T10:00:00.000Z",
        expectedResourceVersion: 1,
        sessionState: "REVIEW_REQUIRED",
      }),
    ).toThrow("QA_AUTOMATION_QUARANTINE_REVISION_INVALID");
  });
});
