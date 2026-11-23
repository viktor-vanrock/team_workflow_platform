import { describe, expect, it } from "vitest";

import { routeImportCandidate } from "../../../../packages/connector-jira/src/import/import-router.ts";

describe("US2 import isolation", () => {
  it("fails closed across connection/profile scope without disclosing content", async () => {
    let loaded = false;
    const result = await routeImportCandidate(
      {
        workspaceId: "other",
        connectionHeaderId: "c1",
        projectId: "100",
        issueTypeId: "10001",
        discriminator: "alpha",
        externalEntityId: "1",
      },
      {
        workspaceId: "w",
        connectionHeaderId: "c1",
        projectId: "100",
        issueTypeId: "10001",
        discriminator: "alpha",
        profileStatus: "VALID",
      },
      async () => {
        loaded = true;
        return { summary: "secret" };
      },
    );
    expect(result).toMatchObject({
      state: "REJECTED_SECURITY",
      reasonCode: "WORKSPACE_SCOPE_MISMATCH",
    });
    expect(loaded).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
