import { describe, expect, it, vi } from "vitest";

import { AuthorizedProjectQueryToken } from "../../../../packages/platform-core/src/project-onboarding/query-ports.ts";
import { authorizeEvidenceBoundary } from "../../../../packages/runtime-composition/src/onboarding/evidence-authorization.ts";
import { exactRef, onboardingFixture } from "../../../support/007-onboarding-fixture.ts";

const token = (ceiling = 10) =>
  AuthorizedProjectQueryToken.issue({
    workspaceId: onboardingFixture.workspaceId,
    principalId: onboardingFixture.qaLeadId,
    permission: "qa.evidence.read",
    projects: [
      {
        projectId: onboardingFixture.projectA,
        classificationCeilingRank: ceiling,
        operationalState: "ACTIVE",
        entitlementRef: { id: "a", version: 1 },
      },
    ],
    issuedAt: onboardingFixture.now,
  });

describe("Feature 007 US3 evidence/artifact isolation", () => {
  it.each([
    "ARTIFACT_METADATA",
    "ARTIFACT_CONTENT",
    "MANIFEST_VERIFY",
    "PACKAGE_VERIFY",
    "EVIDENCE_EXPORT",
  ] as const)("authorizes %s with the same Project/classification decision", async (operation) => {
    const storage = vi.fn(async () => exactRef(operation));
    await expect(
      authorizeEvidenceBoundary(
        {
          token: token(),
          workspaceId: onboardingFixture.workspaceId,
          projectId: onboardingFixture.projectA,
          classificationRank: 10,
          operation,
        },
        storage,
      ),
    ).resolves.toEqual(exactRef(operation));
    await expect(
      authorizeEvidenceBoundary(
        {
          token: token(),
          workspaceId: onboardingFixture.workspaceId,
          projectId: onboardingFixture.forbiddenProjectC,
          classificationRank: 10,
          operation,
        },
        storage,
      ),
    ).rejects.toThrow("PROJECT_RESOURCE_NOT_AVAILABLE");
    await expect(
      authorizeEvidenceBoundary(
        {
          token: token(),
          workspaceId: onboardingFixture.workspaceId,
          projectId: onboardingFixture.projectA,
          classificationRank: 20,
          operation,
        },
        storage,
      ),
    ).rejects.toThrow("PROJECT_RESOURCE_NOT_AVAILABLE");
  });
});
