import { describe, expect, it } from "vitest";

import {
  evaluateCapacityAdmission,
  reconcileAuthoritativeCapacityFact,
} from "../../../packages/platform-core/src/index.ts";

const enforced = {
  policyMode: "ENFORCED" as const,
  current: { humanCommittedCount: 1, activeExpediteCount: 0 },
  workspaceHumanWipLimit: 1,
  activeExpediteLimit: 1,
  targetHasReservation: false,
};

describe("US4 authoritative capacity overflow", () => {
  it("applies confirmed external activity above capacity and emits one debt signal", () => {
    const first = reconcileAuthoritativeCapacityFact({
      ...enforced,
      operationalState: "ACTIVE",
      targetHasClaim: false,
      overflowAlreadyRecorded: false,
    });
    expect(first).toEqual({
      mutation: "UPSERT_FORCED_CLAIM",
      cause: "FORCED_EXTERNAL",
      outcome: "NON_DISCRETIONARY_OVERFLOW",
      emitOverLimitDetected: true,
    });
    expect(
      reconcileAuthoritativeCapacityFact({
        ...enforced,
        operationalState: "ACTIVE",
        targetHasClaim: false,
        overflowAlreadyRecorded: true,
      }),
    ).toMatchObject({ outcome: "NON_DISCRETIONARY_OVERFLOW", emitOverLimitDetected: false });
  });

  it("denies later discretionary work while the forced debt remains", () => {
    expect(
      evaluateCapacityAdmission({
        ...enforced,
        activityKind: "MANUAL_SESSION_START",
        targetHasClaim: false,
        targetHasExpedite: false,
      }),
    ).toMatchObject({ outcome: "DENIED", violatedConstraints: ["HARD_WIP"] });
  });

  it("accepts an authoritative automation result without a reservation as overflow", () => {
    expect(
      evaluateCapacityAdmission({
        ...enforced,
        activityKind: "AUTOMATED_RESULT_APPLY",
        automatedResultPath: "CONVERT_RESERVATION_TO_REVIEW_CLAIM",
        targetHasClaim: false,
        targetHasExpedite: false,
      }),
    ).toMatchObject({
      outcome: "NON_DISCRETIONARY_OVERFLOW",
      mutationKind: "CONVERT_RESERVATION",
      committedDelta: 1,
      violatedConstraints: ["HARD_WIP", "OVER_CAPACITY_EXTERNAL"],
    });
  });

  it("releases mapped RELEASE_WIP blocks and reacquires non-discretionarily on resume", () => {
    expect(
      reconcileAuthoritativeCapacityFact({
        ...enforced,
        operationalState: "BLOCKED",
        blockedWipEffect: "RELEASE_WIP",
        targetHasClaim: true,
        overflowAlreadyRecorded: false,
      }),
    ).toMatchObject({ mutation: "RELEASE_CLAIM_BLOCK", cause: "RELEASE_WIP" });
    expect(
      reconcileAuthoritativeCapacityFact({
        ...enforced,
        operationalState: "ACTIVE",
        targetHasClaim: false,
        overflowAlreadyRecorded: false,
      }),
    ).toMatchObject({ mutation: "UPSERT_FORCED_CLAIM", outcome: "NON_DISCRETIONARY_OVERFLOW" });
    expect(
      reconcileAuthoritativeCapacityFact({
        ...enforced,
        operationalState: "TERMINAL",
        targetHasClaim: true,
        overflowAlreadyRecorded: false,
      }),
    ).toMatchObject({ mutation: "RELEASE_CLAIM_TERMINAL" });
  });
});
