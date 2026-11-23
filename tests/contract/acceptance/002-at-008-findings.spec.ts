import { describe, expect, it } from "vitest";

import {
  QaFindingAggregate,
  type QaFindingObservationInput,
} from "../../../packages/competency-qa/src/domain/finding.ts";

const executor = Object.freeze({
  kind: "HUMAN" as const,
  principalId: "11111111-1111-4111-8111-111111111111",
  issuer: "local",
  subject: "executor.alpha",
});
const policyRef = Object.freeze({ key: "qa.finding-review", version: "1.0.0" });
const observation = (id: string): QaFindingObservationInput =>
  Object.freeze({
    observationId: id,
    sessionId: "session-1",
    kind: "NEGATIVE",
    affectedTargetHash: `sha256:${"a".repeat(64)}`,
    evidenceRefs: Object.freeze([
      { id: `artifact-${id}`, version: "1", contentHash: `sha256:${"b".repeat(64)}` },
    ]),
  });

describe("AT-008 Finding classification and freeze", () => {
  it("walks DRAFT -> CLASSIFIED -> DISPOSED -> FROZEN over the exact active set", () => {
    const finding = QaFindingAggregate.create({
      findingId: "finding-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      workItemId: "work-item-1",
      sessionId: "session-1",
      observation: observation("observation-1"),
      membershipId: "membership-1",
      actor: executor,
      at: "2026-08-30T10:00:00.000Z",
    });
    expect(finding.state).toBe("DRAFT");

    finding.classify({
      classification: "PRODUCT",
      severity: "HIGH",
      summary: "Checkout fails",
      reason: "Reproduced from the frozen target",
      policyRef,
      actor: executor,
      at: "2026-08-30T10:01:00.000Z",
    });
    expect(finding.state).toBe("CLASSIFIED");

    finding.dispose({
      decision: "CREATE_DEFECT",
      reason: "Publish one product defect",
      actor: executor,
      at: "2026-08-30T10:02:00.000Z",
    });
    expect(finding.state).toBe("DISPOSED");

    const frozen = finding.freeze("2026-08-30T10:03:00.000Z");
    expect(finding.state).toBe("FROZEN");
    expect(frozen.stage).toBe("FROZEN");
    expect(frozen.observationMembershipIds).toEqual(["membership-1"]);
    expect(finding.frozenMembershipSetHash).toBe(frozen.activeMembershipSetHash);
  });

  it("resets a decision after membership change and after assigned-observation correction", () => {
    const finding = QaFindingAggregate.create({
      findingId: "finding-2",
      workspaceId: "workspace-1",
      projectId: "project-1",
      workItemId: "work-item-1",
      sessionId: "session-1",
      observation: observation("observation-1"),
      membershipId: "membership-1",
      actor: executor,
      at: "2026-08-30T10:00:00.000Z",
    });
    finding.classify({
      classification: "INFRA",
      severity: "MEDIUM",
      summary: "Runner unavailable",
      reason: "Infrastructure signature",
      policyRef,
      actor: executor,
      at: "2026-08-30T10:01:00.000Z",
    });
    finding.dispose({
      decision: "NOT_A_BUG",
      reason: "Repair runner",
      actor: executor,
      at: "2026-08-30T10:02:00.000Z",
    });

    finding.assign({
      membershipId: "membership-2",
      observation: observation("observation-2"),
      actor: executor,
      at: "2026-08-30T10:03:00.000Z",
    });
    expect(finding.state).toBe("DRAFT");
    expect(finding.currentReview).toBeUndefined();
    expect(finding.reviews.at(-1)?.stage).toBe("DISPOSED");

    finding.classify({
      classification: "INFRA",
      severity: "MEDIUM",
      summary: "Runner unavailable",
      reason: "Rechecked complete membership",
      policyRef,
      actor: executor,
      at: "2026-08-30T10:04:00.000Z",
    });
    finding.dispose({
      decision: "NOT_A_BUG",
      reason: "Repair runner",
      actor: executor,
      at: "2026-08-30T10:05:00.000Z",
    });
    finding.correctAssignedObservation({
      predecessorObservationId: "observation-1",
      successorMembershipId: "membership-3",
      successor: observation("observation-3"),
      reason: "Corrected actual outcome",
      actor: executor,
      at: "2026-08-30T10:06:00.000Z",
    });
    expect(finding.state).toBe("DRAFT");
    expect(finding.activeObservationIds).toEqual(["observation-2"]);
  });

  it("never turns an Observation into a defect without classification and disposition", () => {
    const finding = QaFindingAggregate.create({
      findingId: "finding-3",
      workspaceId: "workspace-1",
      projectId: "project-1",
      workItemId: "work-item-1",
      sessionId: "session-1",
      observation: observation("observation-1"),
      membershipId: "membership-1",
      actor: executor,
      at: "2026-08-30T10:00:00.000Z",
    });
    expect(finding.currentReview).toBeUndefined();
    expect(finding.canCreateDefectDraft()).toBe(false);
  });
});
