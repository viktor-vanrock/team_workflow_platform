import { describe, expect, it } from "vitest";

import { consumeAuthorizedProjectAction } from "../../../packages/platform-core/src/project-onboarding/operational-actions.ts";
import { createInitialPilotCohort } from "../../../packages/runtime-composition/src/pilot/cohort-service.ts";
import {
  assertPilotFenceActionDetails,
  createPilotFenceAction,
  pilotFenceCohortRecord,
} from "../../../packages/runtime-composition/src/pilot/fence-action.ts";

const hash = `sha256:${"a".repeat(64)}` as const;
const cohortId = "50000000-0000-4000-8000-000000000001";
const fenceId = "60000000-0000-4000-8000-000000000001";
const ref = { id: "ref", version: 1, contentHash: hash };

describe("exact pilot fence publication candidate", () => {
  it("binds complete cohort and fence rules to the approved candidate hash", () => {
    const cohort = createInitialPilotCohort({
      cohortId,
      projects: [{ workspaceId: "w", projectId: "p", onboardingRef: ref }],
      userIds: ["30000000-0000-4000-8000-000000000001"],
      channelRefs: ["web"],
      environmentRefs: ["dev"],
      suiteRefs: ["suite"],
      gateRefs: (["L0", "C1", "N2", "P3"] as const).map((kind) => ({
        kind,
        id: kind,
        contentHash: hash,
      })),
      startAt: "2026-01-01T00:00:00.000Z",
      endAt: "2099-01-01T00:00:00.000Z",
      sponsorRef: "sponsor",
      qaLeadRef: "lead",
      onCallRef: "oncall",
      rollbackRunbookRef: "runbook",
      comparisonProtocolRef: { id: "protocol", contentHash: hash },
    });
    const details = {
      schemaVersion: 1 as const,
      fenceId,
      cohortId,
      cohort,
      fence: {
        schemaVersion: 1 as const,
        mode: "COHORT_WRITES" as const,
        environment: "NON_PROD" as const,
        deploymentRef: ref,
        cohortRef: { id: cohortId, version: 1, contentHash: hash },
        runtimeInstanceId: fenceId,
        startsAt: cohort.startAt,
        expiresAt: cohort.endAt,
        revoked: false,
      },
    };
    const input = {
      actionId: "action",
      workspaceId: "w",
      projectId: "p",
      expectedOnboardingVersion: 1,
      initiator: {
        kind: "HUMAN",
        principalId: "initiator",
        roleKey: "system-administrator",
        authorizationBasisRef: ref,
        authenticationContextRef: ref,
      },
      reason: "pilot",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:05:00.000Z",
    } as const;
    const exactDetails = {
      ...details,
      fence: {
        ...details.fence,
        cohortRef: {
          ...details.fence.cohortRef,
          contentHash: pilotFenceCohortRecord(input, details).contentHash as `sha256:${string}`,
        },
      },
    };
    const candidate = createPilotFenceAction(input, exactDetails);
    expect(() => assertPilotFenceActionDetails(candidate)).not.toThrow();
    const approval = {
      approvalId: "approval",
      subjectKind: "PLATFORM_ACTION" as const,
      actionKind: "PILOT_FENCE_PUBLISH" as const,
      actionId: candidate.actionId,
      targetHash: candidate.contentHash,
      initiatorPrincipalId: input.initiator.principalId,
      approver: { ...input.initiator, principalId: "approver" },
      stepUpAt: input.createdAt,
      approvedAt: input.createdAt,
      expiresAt: input.expiresAt,
    };
    const live = {
      now: "2026-01-01T00:01:00.000Z",
      currentOnboardingVersion: 1,
      initiatorCurrentlyAuthorized: true,
      approverCurrentlyAuthorized: true,
      prerequisitesCurrent: true,
    };
    expect(consumeAuthorizedProjectAction(candidate, approval, live).consumedAt).toBe(live.now);
    expect(() =>
      consumeAuthorizedProjectAction(
        candidate,
        {
          ...approval,
          approver: { ...approval.approver, principalId: input.initiator.principalId },
        },
        live,
      ),
    ).toThrow("SELF_APPROVAL_FORBIDDEN");
    expect(() =>
      consumeAuthorizedProjectAction(candidate, approval, { ...live, prerequisitesCurrent: false }),
    ).toThrow("PROJECT_ACTION_PREREQUISITE_STALE");
    expect(() =>
      assertPilotFenceActionDetails({
        ...candidate,
        pilotFence: {
          ...exactDetails,
          fence: { ...exactDetails.fence, expiresAt: "2098-01-01T00:00:00.000Z" },
        },
      }),
    ).toThrow("PILOT_FENCE_ACTION_INVALID");
    expect(() =>
      assertPilotFenceActionDetails({
        ...candidate,
        pilotFence: {
          ...exactDetails,
          cohort: {
            ...exactDetails.cohort,
            gateRefs: exactDetails.cohort.gateRefs.map((gate) =>
              gate.kind === "P3"
                ? { ...gate, contentHash: `sha256:${"b".repeat(64)}` as const }
                : gate,
            ),
          },
        },
      }),
    ).toThrow("PILOT_FENCE_ACTION_INVALID");
  });
});
