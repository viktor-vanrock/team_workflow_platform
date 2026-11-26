import { describe, expect, it } from "vitest";

import { createCorporateGitLabRetryPolicyAuthority } from "../../../packages/runtime-composition/src/gitlab/corporate-retry-policy-authority.ts";

describe("corporate GitLab retry policy authority", () => {
  it("rejects local, production and missing guards before resolving a policy", () => {
    for (const environment of [
      { profile: "local", environmentScope: "LOCAL" },
      {
        profile: "non-local",
        environmentScope: "PLATFORM_PROD",
        deployment: { workspaceId: "workspace", projectIds: ["project"] },
      },
      {
        profile: "non-local",
        environmentScope: "NON_PROD",
        deployment: { workspaceId: "workspace", projectIds: ["project"] },
      },
    ]) {
      expect(() =>
        createCorporateGitLabRetryPolicyAuthority({
          source: { isInitialized: true },
          environment,
          guard: {},
        } as never),
      ).toThrow("CORPORATE_GITLAB_RETRY_AUTHORITY_REQUIRED");
    }
  });
});
