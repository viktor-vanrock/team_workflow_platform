export interface DcJiraSearchInput {
  readonly jql: string;
  readonly offset: number;
  readonly pageSize: number;
  readonly pinnedBuild: string;
  readonly supportedBuildMajors: readonly number[];
}
export function planDcJiraSearch(input: DcJiraSearchInput) {
  const major = Number(input.pinnedBuild.split(".")[0]);
  if (!input.supportedBuildMajors.includes(major)) throw new Error("JIRA_DC_BUILD_UNSUPPORTED");
  if (input.offset < 0 || input.pageSize < 1) throw new Error("JIRA_DC_PAGE_INVALID");
  return Object.freeze({
    jql: input.jql,
    startAt: input.offset,
    maxResults: input.pageSize,
    pinnedBuild: input.pinnedBuild,
  });
}
