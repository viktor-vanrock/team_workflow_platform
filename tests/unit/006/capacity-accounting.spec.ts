import { describe, expect, it } from "vitest";

import {
  type CapacityClaimFact,
  type CapacityReservationFact,
  computeCapacityAccounting,
  evaluateCapacityAdmission,
} from "../../../packages/platform-core/src/index.ts";
import { digest } from "../../helpers/006/triage-fixture.ts";

const claims: readonly CapacityClaimFact[] = Object.freeze([
  Object.freeze({
    projectId: "A",
    workItemId: "one",
    state: "ACTIVE",
    causes: Object.freeze(["FORCED_EXTERNAL", "MANUAL_RUNNING"] as const),
    sourceRefs: Object.freeze([
      {
        sourceType: "QA_TEST_SESSION_REVISION",
        sourceId: "s1",
        sourceVersion: 2,
        semanticHash: digest("s1"),
      },
    ]),
  }),
]);
const reservations: readonly CapacityReservationFact[] = Object.freeze([
  Object.freeze({
    projectId: "A",
    workItemId: "one",
    state: "COVERED_BY_CLAIM",
    causes: Object.freeze(["automation-1"]),
  }),
  Object.freeze({
    projectId: "A",
    workItemId: "two",
    state: "HELD",
    causes: Object.freeze(["automation-2"]),
  }),
  Object.freeze({
    projectId: "B",
    workItemId: "three",
    state: "HELD",
    causes: Object.freeze(["automation-3"]),
  }),
  Object.freeze({
    projectId: "B",
    workItemId: "old",
    state: "RELEASED",
    causes: Object.freeze(["automation-old"]),
  }),
]);

describe("US4 capacity accounting", () => {
  it("counts the union by Work Item, keeps cause hashes stable, and never double-counts a covered reservation", () => {
    const input = {
      claims,
      reservations,
      expedites: [],
      authorizedProjectIds: ["A", "B"],
      policyMode: "ENFORCED" as const,
      projectLimits: [{ projectId: "A", softWipLimit: 1, reservedCapacity: 0 }],
    };
    const value = computeCapacityAccounting(input);
    expect(value).toMatchObject({
      humanOccupiedCount: 1,
      reviewReservedCount: 2,
      humanCommittedCount: 3,
      forcedExternalCount: 1,
      activeExpediteCount: 0,
    });
    expect(value.reservationStateCounts).toEqual({
      held: 2,
      converted: 0,
      released: 1,
      coveredByClaim: 1,
    });
    expect(value.projectFacets).toEqual([
      expect.objectContaining({
        projectId: "A",
        humanOccupiedCount: 1,
        reviewReservedCount: 1,
        humanCommittedCount: 2,
        warningState: "RESERVATION_PRESSURE",
      }),
      expect.objectContaining({
        projectId: "B",
        humanOccupiedCount: 0,
        reviewReservedCount: 1,
        humanCommittedCount: 1,
        warningState: "NOT_CONFIGURED",
      }),
    ]);
    const reordered = computeCapacityAccounting({
      ...input,
      claims: [...claims].reverse(),
      reservations: [...reservations].reverse(),
    });
    expect(reordered.claimSetHash).toBe(value.claimSetHash);
    expect(reordered.reservationSetHash).toBe(value.reservationSetHash);
  });

  it("keeps Project soft limits as warnings and Workspace limits as hard discretionary blockers", () => {
    const current = { humanCommittedCount: 1, activeExpediteCount: 0 };
    const denied = evaluateCapacityAdmission({
      policyMode: "ENFORCED",
      activityKind: "MANUAL_SESSION_START",
      current,
      workspaceHumanWipLimit: 1,
      activeExpediteLimit: 1,
      targetHasClaim: false,
      targetHasReservation: false,
      targetHasExpedite: false,
      projectCommittedCount: 1,
      projectSoftWipLimit: 1,
    });
    expect(denied).toMatchObject({
      outcome: "DENIED",
      committedDelta: 0,
      violatedConstraints: ["HARD_WIP", "PROJECT_SOFT_LIMIT"],
    });
    const overridden = evaluateCapacityAdmission({
      policyMode: "ENFORCED",
      activityKind: "MANUAL_SESSION_RESUME",
      current,
      workspaceHumanWipLimit: 1,
      activeExpediteLimit: 1,
      targetHasClaim: false,
      targetHasReservation: false,
      targetHasExpedite: false,
      exactOverride: { actionKind: "WIP_ADMISSION_OVERRIDE", effectKind: "ALLOW_WIP_ADMISSION" },
    });
    expect(overridden).toMatchObject({
      outcome: "ADMITTED_WITH_EXACT_OVERRIDE",
      committedDelta: 1,
      violatedConstraints: ["HARD_WIP"],
    });
    const softOnly = evaluateCapacityAdmission({
      policyMode: "ENFORCED",
      activityKind: "AUTOMATED_SESSION_LAUNCH",
      current: { humanCommittedCount: 0, activeExpediteCount: 0 },
      workspaceHumanWipLimit: 2,
      activeExpediteLimit: 1,
      targetHasClaim: false,
      targetHasReservation: false,
      targetHasExpedite: false,
      projectReservedCount: 1,
      projectReservedCapacity: 1,
    });
    expect(softOnly).toMatchObject({
      outcome: "ADMITTED",
      mutationKind: "RESERVATION",
      violatedConstraints: ["RESERVATION_PRESSURE"],
    });
  });

  it("admits unavoidable facts with debt, and serializes EXPEDITE through its dedicated override family", () => {
    const overflow = evaluateCapacityAdmission({
      policyMode: "ENFORCED",
      activityKind: "EXTERNAL_JIRA_RECONCILIATION",
      current: { humanCommittedCount: 1, activeExpediteCount: 0 },
      workspaceHumanWipLimit: 1,
      activeExpediteLimit: 1,
      targetHasClaim: false,
      targetHasReservation: false,
      targetHasExpedite: false,
    });
    expect(overflow).toMatchObject({
      outcome: "NON_DISCRETIONARY_OVERFLOW",
      committedDelta: 1,
      violatedConstraints: ["HARD_WIP", "OVER_CAPACITY_EXTERNAL"],
    });
    const denied = evaluateCapacityAdmission({
      policyMode: "ENFORCED",
      activityKind: "SET_EXPEDITE",
      current: { humanCommittedCount: 0, activeExpediteCount: 1 },
      workspaceHumanWipLimit: 1,
      activeExpediteLimit: 1,
      targetHasClaim: false,
      targetHasReservation: false,
      targetHasExpedite: false,
    });
    expect(denied).toMatchObject({
      outcome: "DENIED",
      expediteDelta: 0,
      violatedConstraints: ["EXPEDITE_SINGLETON"],
    });
    const overridden = evaluateCapacityAdmission({
      policyMode: "ENFORCED",
      activityKind: "SET_EXPEDITE",
      current: { humanCommittedCount: 0, activeExpediteCount: 1 },
      workspaceHumanWipLimit: 1,
      activeExpediteLimit: 1,
      targetHasClaim: false,
      targetHasReservation: false,
      targetHasExpedite: false,
      exactOverride: {
        actionKind: "EXPEDITE_CAPACITY_OVERRIDE",
        effectKind: "ALLOW_EXPEDITE_CAPACITY",
      },
    });
    expect(overridden).toMatchObject({ outcome: "ADMITTED_WITH_EXACT_OVERRIDE", expediteDelta: 1 });
  });
});
