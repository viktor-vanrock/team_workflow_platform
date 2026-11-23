import { describe, expect, it } from "vitest";

import { routeImportCandidate } from "../../../../packages/connector-jira/src/import/import-router.ts";
import { assertRequestCreateAuthority } from "../../../../packages/connector-jira/src/operational/request-create.ts";

describe("003 isolation hardening", () => {
  it("is enumeration-resistant across workspace/project/connection/profile", async () => {
    const denied = await routeImportCandidate(
      {
        workspaceId: "other",
        connectionHeaderId: "other",
        projectId: "secret",
        issueTypeId: "secret",
        discriminator: "secret",
        externalEntityId: "opaque",
      },
      {
        workspaceId: "w",
        connectionHeaderId: "c",
        projectId: "p",
        issueTypeId: "t",
        discriminator: "d",
        profileStatus: "VALID",
      },
      async () => {
        throw new Error("must not read");
      },
    );
    expect(denied).toEqual({
      state: "REJECTED_SECURITY",
      reasonCode: "WORKSPACE_SCOPE_MISMATCH",
      externalEntityId: "opaque",
    });
    expect(JSON.stringify(denied)).not.toContain("secret");
    expect(() =>
      assertRequestCreateAuthority({
        authorized: true,
        projectId: "p",
        targetProjectId: "p",
        profileStatus: "VALID",
        expectedAuthorityNamespace: "a",
        actualAuthorityNamespace: "b",
      }),
    ).toThrow("REQUEST_CREATE_AUTHORITY_NAMESPACE_MISMATCH");
  });
});
