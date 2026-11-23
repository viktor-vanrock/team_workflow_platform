export interface JiraDialect {
  readonly family: "jira-cloud-v3" | "jira-dc-9-v2" | "jira-dc-10-v2" | "jira-dc-11-v2";
  readonly apiPrefix: "/rest/api/3" | "/rest/api/2";
  readonly identityField: "accountId" | "key";
  readonly richText: "ADF" | "PLAIN_TEXT";
  readonly pagination: "TOKEN" | "OFFSET";
  createIssuePath(): string;
  issuePath(id: string): string;
  issuePropertyPath(id: string, propertyKey: string): string;
  issueRemoteLinkPath(id: string): string;
  issueLinkPath(): string;
  issueCommentPath(id: string): string;
  searchPath(): string;
}

export const jiraCloudV3Dialect: JiraDialect = Object.freeze({
  family: "jira-cloud-v3",
  apiPrefix: "/rest/api/3",
  identityField: "accountId",
  richText: "ADF",
  pagination: "TOKEN",
  createIssuePath: () => "/rest/api/3/issue",
  issuePath: (id: string) => `/rest/api/3/issue/${encodeURIComponent(id)}`,
  issuePropertyPath: (id: string, propertyKey: string) =>
    `/rest/api/3/issue/${encodeURIComponent(id)}/properties/${encodeURIComponent(propertyKey)}`,
  issueRemoteLinkPath: (id: string) => `/rest/api/3/issue/${encodeURIComponent(id)}/remotelink`,
  issueLinkPath: () => "/rest/api/3/issueLink",
  issueCommentPath: (id: string) => `/rest/api/3/issue/${encodeURIComponent(id)}/comment`,
  searchPath: () => "/rest/api/3/search/jql",
});
