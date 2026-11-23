import type { JiraDialect } from "./jira-cloud-v3.ts";

export const jiraDc10V2Dialect: JiraDialect = Object.freeze({
  family: "jira-dc-10-v2",
  apiPrefix: "/rest/api/2",
  identityField: "key",
  richText: "PLAIN_TEXT",
  pagination: "OFFSET",
  createIssuePath: () => "/rest/api/2/issue",
  issuePath: (id: string) => `/rest/api/2/issue/${encodeURIComponent(id)}`,
  issuePropertyPath: (id: string, propertyKey: string) =>
    `/rest/api/2/issue/${encodeURIComponent(id)}/properties/${encodeURIComponent(propertyKey)}`,
  issueRemoteLinkPath: (id: string) => `/rest/api/2/issue/${encodeURIComponent(id)}/remotelink`,
  issueLinkPath: () => "/rest/api/2/issueLink",
  issueCommentPath: (id: string) => `/rest/api/2/issue/${encodeURIComponent(id)}/comment`,
  searchPath: () => "/rest/api/2/search",
});
