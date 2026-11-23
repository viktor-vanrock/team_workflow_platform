import { describe, expect, it } from "vitest";

import { confirmJiraCommand } from "../../../packages/connector-jira/src/operational/jira-command-confirmation.ts";

describe("US3 post-write confirmation", () => {
  it("classifies TOCTOU mismatch and provider 409 without echo confirmation", () => {
    expect(
      confirmJiraCommand({
        requestedValueHash: "wanted",
        postReadValueHash: "human",
        postReadRevisionToken: "r2",
      }),
    ).toMatchObject({ status: "CONFLICT" });
    expect(confirmJiraCommand({ requestedValueHash: "wanted", providerStatus: 409 })).toMatchObject(
      { status: "CONFLICT", reasonCode: "PROVIDER_CONFLICT" },
    );
  });
});
