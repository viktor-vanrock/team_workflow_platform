export interface CloudJiraSearchInput {
  readonly jql: string;
  readonly nextPageToken?: string;
  readonly invalidToken: boolean;
  readonly knownIssueIds: readonly string[];
}
export function planCloudJiraSearch(input: CloudJiraSearchInput) {
  if (!input.jql) throw new Error("JIRA_CLOUD_JQL_REQUIRED");
  return Object.freeze({
    jql: input.jql,
    nextPageToken: input.invalidToken ? undefined : input.nextPageToken,
    knownIssueIds: Object.freeze([...input.knownIssueIds]),
    restarted: input.invalidToken,
  });
}
