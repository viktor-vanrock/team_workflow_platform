import { describe, expect, it } from "vitest";

import { AuthorizedProjectQueryToken } from "../../../../packages/platform-core/src/project-onboarding/query-ports.ts";

describe("US5 investigation", () => {
  it("allows reads but denies effects while suspended", () => {
    const t = AuthorizedProjectQueryToken.issue({
      workspaceId: "w",
      principalId: "u",
      permission: "read",
      projects: [
        {
          projectId: "p",
          classificationCeilingRank: 20,
          operationalState: "SUSPENDED",
          entitlementRef: { id: "e", version: 1 },
        },
      ],
      issuedAt: new Date(),
    });
    expect(t.allows("p", 10, "READ")).toBe(true);
    expect(t.allows("p", 10, "EFFECT")).toBe(false);
  });
});
