import { describe, expect, it, vi } from "vitest";

import { MutableProjectAuthorizationDirectory } from "../../../packages/runtime-composition/src/onboarding/scoped-execution.ts";
import { onboardingFixture } from "../../support/007-onboarding-fixture.ts";

describe("Feature 007 US3 entitlement revocation race", () => {
  it("denies the next list/read/export/effect check without moving business rows", async () => {
    const directory = new MutableProjectAuthorizationDirectory({
      workspaceId: onboardingFixture.workspaceId,
      principalId: onboardingFixture.qaLeadId,
      permission: "project.read",
      projectIds: [onboardingFixture.projectA],
      issuedAt: onboardingFixture.now,
    });
    const businessRows = Object.freeze([{ id: "work-a", projectId: onboardingFixture.projectA }]);
    expect(directory.issue().allows(onboardingFixture.projectA, 10, "READ")).toBe(true);
    directory.revoke(onboardingFixture.projectA);
    for (const operation of ["LIST", "READ", "EXPORT", "EFFECT"] as const)
      expect(
        directory
          .issue()
          .allows(onboardingFixture.projectA, 10, operation === "EFFECT" ? "EFFECT" : "READ"),
      ).toBe(false);
    expect(businessRows).toEqual([{ id: "work-a", projectId: onboardingFixture.projectA }]);
    const effect = vi.fn();
    if (directory.issue().allows(onboardingFixture.projectA, 10, "EFFECT")) effect();
    expect(effect).not.toHaveBeenCalled();
  });
});
