import { describe, expect, it } from "vitest";

import { assertSameProjectResourceScope } from "../../../../packages/platform-core/src/project-onboarding/query-ports.ts";
import { onboardingFixture } from "../../../support/007-onboarding-fixture.ts";

describe("Feature 007 US3 cross-Project exact-ref substitution", () => {
  it.each([
    "BINDING",
    "CONTEXT",
    "ENVIRONMENT",
    "LEASE",
    "SESSION",
    "MANIFEST",
    "ARTIFACT",
    "APPROVAL",
    "AUDIT",
  ] as const)("rejects a %s ref from another Project", (kind) => {
    expect(() =>
      assertSameProjectResourceScope(
        { workspaceId: onboardingFixture.workspaceId, projectId: onboardingFixture.projectA },
        {
          ...{
            kind,
            workspaceId: onboardingFixture.workspaceId,
            projectId: onboardingFixture.projectB,
            id: `${kind.toLowerCase()}-b`,
            version: 1,
            contentHash: `sha256:${"a".repeat(64)}`,
          },
        },
      ),
    ).toThrow("CROSS_PROJECT_REFERENCE_FORBIDDEN");
  });
});
