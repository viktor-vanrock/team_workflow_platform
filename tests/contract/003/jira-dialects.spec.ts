import { describe, expect, it } from "vitest";

import { createJiraDialect } from "../../../packages/connector-jira/src/index.ts";

describe("pinned Jira dialect families", () => {
  it.each([
    ["jira-cloud-v3", "/rest/api/3", "accountId", "TOKEN"],
    ["jira-dc-9-v2", "/rest/api/2", "key", "OFFSET"],
    ["jira-dc-10-v2", "/rest/api/2", "key", "OFFSET"],
    ["jira-dc-11-v2", "/rest/api/2", "key", "OFFSET"],
  ] as const)("pins %s request/identity/pagination", (family, prefix, identity, pagination) => {
    const dialect = createJiraDialect(family);
    expect(dialect.apiPrefix).toBe(prefix);
    expect(dialect.identityField).toBe(identity);
    expect(dialect.pagination).toBe(pagination);
    expect(dialect.issuePath("10001")).not.toContain("latest");
  });

  it("rejects unknown and /latest dialect selection", () => {
    expect(() => createJiraDialect("jira-latest" as never)).toThrow("JIRA_DIALECT_UNSUPPORTED");
  });
});
