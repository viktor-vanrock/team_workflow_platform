import { describe, expect, it } from "vitest";

import { resolveImportCreator } from "../../../../packages/connector-jira/src/import/import-identity.ts";

describe("US2 import identity", () => {
  it("accepts only a live verified external human subject and never email-matches", () => {
    const bindings = [
      {
        workspaceId: "w",
        connectionHeaderId: "c",
        externalPrincipalId: "acct-1",
        kind: "EXTERNAL_HUMAN" as const,
        state: "VERIFIED" as const,
        principalId: "p",
      },
    ];
    expect(
      resolveImportCreator({
        workspaceId: "w",
        connectionHeaderId: "c",
        creatorSubject: "acct-1",
        bindings,
      }),
    ).toBe("p");
    expect(() =>
      resolveImportCreator({
        workspaceId: "w",
        connectionHeaderId: "c",
        creatorSubject: "person@example.com",
        bindings,
      }),
    ).toThrow("IMPORT_CREATOR_EMAIL_FORBIDDEN");
    expect(() =>
      resolveImportCreator({
        workspaceId: "w",
        connectionHeaderId: "c",
        creatorSubject: "other",
        bindings,
      }),
    ).toThrow("IMPORT_CREATOR_NOT_VERIFIED");
  });
});
