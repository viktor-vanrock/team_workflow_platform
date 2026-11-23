import type { JiraAdapterFamily } from "@awp/platform-contracts";

import type { JiraRestClient } from "../http/jira-rest-client.ts";

export interface SanitizedJiraDiscoverySnapshot {
  readonly family: JiraAdapterFamily;
  readonly exactBuild: string;
  readonly projects: readonly Readonly<{ id: string; name: string }>[];
  readonly issueTypes: readonly Readonly<{
    id: string;
    name: string;
    projectIds: readonly string[];
  }>[];
  readonly fields: readonly Readonly<{ id: string; name: string; schemaType: string }>[];
  readonly statuses: readonly Readonly<{ id: string; name: string }>[];
  readonly transitions: readonly Readonly<{
    id: string;
    name: string;
    fromStatusIds: readonly string[];
    toStatusId: string;
  }>[];
  readonly priorities: readonly Readonly<{ id: string; name: string }>[];
  readonly linkTypes: readonly Readonly<{
    id: string;
    name: string;
    inward: string;
    outward: string;
  }>[];
  readonly capabilities: Readonly<Record<string, boolean>>;
}

function sanitizedArray(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .filter(
          (item): item is Record<string, unknown> =>
            !!item && typeof item === "object" && !Array.isArray(item),
        )
        .map((item) => Object.freeze({ ...item }))
    : [];
}

export class JiraDiscoveryService {
  constructor(
    private readonly client: JiraRestClient,
    private readonly family: JiraAdapterFamily,
  ) {}
  async discover(): Promise<SanitizedJiraDiscoverySnapshot> {
    const response = await this.client.request({
      method: "GET",
      path: this.family === "jira-cloud-v3" ? "/rest/api/3/serverInfo" : "/rest/api/2/serverInfo",
    });
    const body = (await response.json()) as Record<string, unknown>;
    const metadata = (
      body.metadata && typeof body.metadata === "object" ? body.metadata : {}
    ) as Record<string, unknown>;
    return Object.freeze({
      family: this.family,
      exactBuild: String(body.buildNumber ?? body.version ?? "unknown"),
      projects: sanitizedArray(metadata.projects) as SanitizedJiraDiscoverySnapshot["projects"],
      issueTypes: sanitizedArray(
        metadata.issueTypes,
      ) as SanitizedJiraDiscoverySnapshot["issueTypes"],
      fields: sanitizedArray(metadata.fields) as SanitizedJiraDiscoverySnapshot["fields"],
      statuses: sanitizedArray(metadata.statuses) as SanitizedJiraDiscoverySnapshot["statuses"],
      transitions: sanitizedArray(
        metadata.transitions,
      ) as SanitizedJiraDiscoverySnapshot["transitions"],
      priorities: sanitizedArray(
        metadata.priorities,
      ) as SanitizedJiraDiscoverySnapshot["priorities"],
      linkTypes: sanitizedArray(metadata.linkTypes) as SanitizedJiraDiscoverySnapshot["linkTypes"],
      capabilities: Object.freeze({
        search: true,
        issueRead: true,
        ...(metadata.capabilities as Record<string, boolean> | undefined),
      }),
    });
  }
}
