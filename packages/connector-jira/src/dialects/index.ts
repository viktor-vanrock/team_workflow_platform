import type { JiraAdapterFamily } from "@awp/platform-contracts";

import { jiraCloudV3Dialect, type JiraDialect } from "./jira-cloud-v3.ts";
import { jiraDc9V2Dialect } from "./jira-dc-9-v2.ts";
import { jiraDc10V2Dialect } from "./jira-dc-10-v2.ts";
import { jiraDc11V2Dialect } from "./jira-dc-11-v2.ts";

const dialects: Readonly<Record<JiraAdapterFamily, JiraDialect>> = Object.freeze({
  "jira-cloud-v3": jiraCloudV3Dialect,
  "jira-dc-9-v2": jiraDc9V2Dialect,
  "jira-dc-10-v2": jiraDc10V2Dialect,
  "jira-dc-11-v2": jiraDc11V2Dialect,
});

export function createJiraDialect(family: JiraAdapterFamily): JiraDialect {
  const dialect = dialects[family];
  if (!dialect) throw new Error("JIRA_DIALECT_UNSUPPORTED");
  return dialect;
}
export * from "./jira-cloud-v3.ts";
export * from "./jira-dc-9-v2.ts";
export * from "./jira-dc-10-v2.ts";
export * from "./jira-dc-11-v2.ts";
