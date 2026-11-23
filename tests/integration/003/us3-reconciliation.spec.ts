import { describe, expect, it } from "vitest";

import { planCloudJiraSearch } from "../../../packages/connector-jira/src/reconciliation/jira-cloud-search.ts";
import { planDcJiraSearch } from "../../../packages/connector-jira/src/reconciliation/jira-dc-search.ts";

describe("US3 reconciliation dialects", () => {
  it("uses Cloud tokens, DC offsets and overlap without committing partial cursors", () => {
    expect(
      planCloudJiraSearch({
        jql: "project=Q",
        nextPageToken: "t",
        invalidToken: false,
        knownIssueIds: ["1"],
      }),
    ).toMatchObject({ nextPageToken: "t", knownIssueIds: ["1"] });
    expect(
      planCloudJiraSearch({
        jql: "project=Q",
        nextPageToken: "bad",
        invalidToken: true,
        knownIssueIds: [],
      }),
    ).toMatchObject({ nextPageToken: undefined, restarted: true });
    expect(
      planDcJiraSearch({
        jql: "project=Q",
        offset: 50,
        pageSize: 50,
        pinnedBuild: "10.4.1",
        supportedBuildMajors: [10],
      }),
    ).toMatchObject({ startAt: 50, maxResults: 50 });
  });
});
