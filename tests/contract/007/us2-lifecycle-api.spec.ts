import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { bindingLifecycleAction } from "../../../apps/api/src/extensions/onboarding/bindings.controller.ts";
import {
  consumeAuthorizedProjectAction,
  createProjectActionCandidate,
} from "../../../packages/platform-core/src/project-onboarding/operational-actions.ts";
import {
  exactRef,
  humanActor,
  onboardingFixture,
  projectScope,
} from "../../support/007-onboarding-fixture.ts";

describe("Feature 007 US2 lifecycle API", () => {
  it("exposes the closed publish/retire/rollback union and pilot activation", () => {
    expect(bindingLifecycleAction("rollback")).toBe("rollback");
    expect(() => bindingLifecycleAction("reactivate")).toThrow();
    const root = resolve(import.meta.dirname, "../../..");
    const contract = readFileSync(
      resolve(
        root,
        "specs/007-project-onboarding-evidence-security/contracts/openapi/project-onboarding-evidence-api.v1.yaml",
      ),
      "utf8",
    );
    const controller = readFileSync(
      resolve(root, "packages/platform-runtime-nest/src/http/project-onboarding.controller.ts"),
      "utf8",
    );
    expect(contract).toMatch(/enum: \[publish, retire, rollback\]/u);
    expect(contract).toContain("operationId: activateProjectPilot");
    expect(controller).toContain('Post(":projectId/onboarding/activate-pilot")');
  });

  it("rechecks CAS, live authorization and prerequisites at approval consumption", () => {
    const candidate = createProjectActionCandidate({
      actionId: "pilot",
      kind: "ONBOARDING_PILOT_ACTIVATE",
      ...projectScope(),
      targetRef: exactRef("onboarding"),
      expectedOnboardingVersion: 4,
      prerequisiteRefs: [exactRef("p3")],
      initiator: humanActor(
        onboardingFixture.integrationAdministratorId,
        "integration-administrator",
      ),
      reason: "Activate pilot",
      createdAt: onboardingFixture.now,
      expiresAt: onboardingFixture.later,
    });
    const approval = {
      approvalId: "approval",
      subjectKind: "PLATFORM_ACTION" as const,
      actionKind: candidate.kind,
      actionId: candidate.actionId,
      targetHash: candidate.contentHash,
      initiatorPrincipalId: candidate.initiator.principalId,
      approver: humanActor(onboardingFixture.workspaceOwnerId, "workspace-owner"),
      stepUpAt: onboardingFixture.now,
      approvedAt: onboardingFixture.now,
      expiresAt: onboardingFixture.later,
    };
    expect(
      consumeAuthorizedProjectAction(candidate, approval, {
        now: onboardingFixture.now,
        currentOnboardingVersion: 4,
        initiatorCurrentlyAuthorized: true,
        approverCurrentlyAuthorized: true,
        prerequisitesCurrent: true,
      }).consumedAt,
    ).toBe(onboardingFixture.now);
    expect(() =>
      consumeAuthorizedProjectAction(candidate, approval, {
        now: onboardingFixture.now,
        currentOnboardingVersion: 5,
        initiatorCurrentlyAuthorized: true,
        approverCurrentlyAuthorized: true,
        prerequisitesCurrent: true,
      }),
    ).toThrow("ONBOARDING_VERSION_CONFLICT");
  });
});
