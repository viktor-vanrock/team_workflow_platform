import { describe, expect, it } from "vitest";

import { resolveJiraAssignmentSubject } from "../../../../packages/connector-jira/src/operational/request-assign.ts";

describe("US3 assignment identity", () => {
  it("resolves canonical identity through a verified binding and rejects provider-id smuggling", () => {
    expect(
      resolveJiraAssignmentSubject({
        canonicalPrincipalId: "p",
        clientPayload: { canonicalPrincipalId: "p" },
        bindings: [{ canonicalPrincipalId: "p", providerSubject: "acct", state: "VERIFIED" }],
      }),
    ).toBe("acct");
    expect(() =>
      resolveJiraAssignmentSubject({
        canonicalPrincipalId: "p",
        clientPayload: { accountId: "smuggled" },
        bindings: [],
      }),
    ).toThrow("ASSIGNMENT_PROVIDER_ID_FORBIDDEN");
  });
});
