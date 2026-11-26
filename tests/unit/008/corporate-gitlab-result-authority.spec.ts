import { describe, expect, it, vi } from "vitest";

import { createCorporateGitLabResultAuthority } from "../../../packages/runtime-composition/src/gitlab/corporate-result-authority.ts";

describe("corporate GitLab result authority", () => {
  it("rejects production before opening provider access", () => {
    expect(() =>
      createCorporateGitLabResultAuthority({
        source: { isInitialized: true },
        environment: {
          profile: "non-local",
          environmentScope: "PLATFORM_PROD",
          deployment: { workspaceId: "w", projectIds: ["p"] },
        },
        grants: [],
        factories: {},
        connectorAuthority: { authorize: vi.fn() },
        guard: { assertCommandAllowed: vi.fn() },
      } as never),
    ).toThrow("CORPORATE_GITLAB_RESULT_SCOPE_REQUIRED");
  });
});
