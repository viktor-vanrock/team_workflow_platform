import { describe, expect, it } from "vitest";

import { assertRequestCreateAuthority } from "../../../../packages/connector-jira/src/operational/request-create.ts";

describe("US1 create authorization", () => {
  it("rejects entitlement, profile and authority namespace mismatches before lookup or create", () => {
    expect(() =>
      assertRequestCreateAuthority({
        authorized: false,
        projectId: "alpha",
        targetProjectId: "alpha",
        profileStatus: "VALID",
        expectedAuthorityNamespace: "n1",
        actualAuthorityNamespace: "n1",
      }),
    ).toThrow("REQUEST_CREATE_UNAUTHORIZED");
    expect(() =>
      assertRequestCreateAuthority({
        authorized: true,
        projectId: "alpha",
        targetProjectId: "beta",
        profileStatus: "VALID",
        expectedAuthorityNamespace: "n1",
        actualAuthorityNamespace: "n1",
      }),
    ).toThrow("REQUEST_CREATE_PROJECT_SCOPE_MISMATCH");
    expect(() =>
      assertRequestCreateAuthority({
        authorized: true,
        projectId: "alpha",
        targetProjectId: "alpha",
        profileStatus: "DRIFTED",
        expectedAuthorityNamespace: "n1",
        actualAuthorityNamespace: "n1",
      }),
    ).toThrow("REQUEST_CREATE_PROFILE_UNAVAILABLE");
  });
});
