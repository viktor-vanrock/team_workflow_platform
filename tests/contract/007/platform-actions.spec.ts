import { describe, expect, it } from "vitest";

import {
  consumeProjectActionApproval,
  createProjectActionCandidate,
  PROJECT_ONBOARDING_ACTION_KINDS,
  type ProjectActionApproval,
} from "../../../packages/platform-core/src/project-onboarding/operational-actions.ts";
import {
  exactRef,
  humanActor,
  onboardingFixture,
  projectScope,
  testHash,
} from "../../support/007-onboarding-fixture.ts";

function candidate(kind: (typeof PROJECT_ONBOARDING_ACTION_KINDS)[number] = "BINDING_PUBLISH") {
  return createProjectActionCandidate({
    actionId: "00000000-0000-4000-8000-000000000731",
    kind,
    ...projectScope(),
    targetRef: exactRef("binding"),
    expectedOnboardingVersion: 4,
    prerequisiteRefs: [exactRef("acceptance"), exactRef("probe")],
    initiator: humanActor(
      onboardingFixture.integrationAdministratorId,
      "integration-administrator",
    ),
    reason: "Validated exact candidate",
    createdAt: onboardingFixture.now,
    expiresAt: onboardingFixture.later,
  });
}

describe("Feature 007 exact platform actions", () => {
  it("publishes exactly the four privileged onboarding action kinds", () => {
    expect(PROJECT_ONBOARDING_ACTION_KINDS).toEqual([
      "BINDING_PUBLISH",
      "BINDING_RETIRE",
      "PROJECT_RESUME",
      "ONBOARDING_PILOT_ACTIVATE",
    ]);
  });

  it("binds an exact PLATFORM_ACTION approval and consumes it once", () => {
    const action = candidate();
    const approval: ProjectActionApproval = {
      approvalId: "approval-1",
      subjectKind: "PLATFORM_ACTION" as const,
      actionKind: action.kind,
      actionId: action.actionId,
      targetHash: action.contentHash,
      initiatorPrincipalId: onboardingFixture.integrationAdministratorId,
      approver: humanActor(onboardingFixture.workspaceOwnerId, "workspace-owner"),
      stepUpAt: onboardingFixture.now,
      approvedAt: onboardingFixture.now,
      expiresAt: onboardingFixture.later,
    };
    const consumed = consumeProjectActionApproval(action, approval, onboardingFixture.now);
    expect(consumed.consumedAt).toBe(onboardingFixture.now);
    expect(() => consumeProjectActionApproval(action, consumed, onboardingFixture.now)).toThrow(
      "APPROVAL_ALREADY_CONSUMED",
    );
  });

  it("rejects self approval, wrong exact target and absent step-up", () => {
    const action = candidate("PROJECT_RESUME");
    const base: ProjectActionApproval = {
      approvalId: "approval-1",
      subjectKind: "PLATFORM_ACTION" as const,
      actionKind: action.kind,
      actionId: action.actionId,
      targetHash: action.contentHash,
      initiatorPrincipalId: onboardingFixture.integrationAdministratorId,
      approver: humanActor(onboardingFixture.workspaceOwnerId, "workspace-owner"),
      approvedAt: onboardingFixture.now,
      expiresAt: onboardingFixture.later,
      stepUpAt: onboardingFixture.now,
    };
    expect(() =>
      consumeProjectActionApproval(
        action,
        { ...base, approver: humanActor(onboardingFixture.integrationAdministratorId) },
        onboardingFixture.now,
      ),
    ).toThrow("SELF_APPROVAL_FORBIDDEN");
    expect(() =>
      consumeProjectActionApproval(
        action,
        { ...base, targetHash: testHash("different") },
        onboardingFixture.now,
      ),
    ).toThrow("APPROVAL_EXACT_SUBJECT_MISMATCH");
    const { stepUpAt: _stepUpAt, ...withoutStepUp } = base;
    void _stepUpAt;
    expect(() =>
      consumeProjectActionApproval(action, withoutStepUp, onboardingFixture.now),
    ).toThrow("APPROVAL_STEP_UP_REQUIRED");
  });
});
