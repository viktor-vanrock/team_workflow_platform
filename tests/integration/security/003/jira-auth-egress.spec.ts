import { describe, expect, it } from "vitest";

import {
  buildJiraAuthHeaders,
  JiraRestClient,
} from "../../../../packages/connector-jira/src/index.ts";
import { EphemeralJiraSecretLease } from "../../../../packages/platform-contracts/src/index.ts";

describe("Jira auth and egress boundary", () => {
  it("uses a short-lived secret lease without serializing material", () => {
    const lease = new EphemeralJiraSecretLease(
      {
        schemaVersion: 1,
        leaseId: "11111111-1111-4111-8111-111111111111",
        secretRefHash: `sha256:${"1".repeat(64)}`,
        secretVersionRef: "v1",
        allowedUseHash: `sha256:${"2".repeat(64)}`,
        issuedAt: "2026-01-01T00:00:00Z",
        expiresAt: "2026-01-01T00:01:00Z",
        redactionToken: "abcdefghijklmnop",
      },
      new TextEncoder().encode("top-secret"),
    );
    expect(
      buildJiraAuthHeaders("CLOUD_SERVICE_API_TOKEN", lease, new Date("2026-01-01T00:00:30Z")),
    ).toHaveProperty("authorization");
    expect(JSON.stringify(lease)).not.toContain("top-secret");
  });

  it("rejects redirects, private/prod scope mismatches and redacts failures", async () => {
    const client = new JiraRestClient({
      baseUrl: "https://jira.nonprod.example/",
      environment: "NON_PROD",
      allowedOrigins: ["https://jira.nonprod.example"],
      transport: async () =>
        new Response("secret body", { status: 302, headers: { location: "https://evil.example" } }),
    });
    await expect(
      client.request({
        method: "GET",
        path: "/rest/api/3/serverInfo",
        headers: { authorization: "Bearer secret" },
      }),
    ).rejects.toThrow("JIRA_REDIRECT_FORBIDDEN");
    expect(
      () =>
        new JiraRestClient({
          baseUrl: "https://jira.example/",
          environment: "PLATFORM_PROD" as never,
          allowedOrigins: [],
          transport: fetch,
        }),
    ).toThrow("JIRA_ENVIRONMENT_FORBIDDEN");
  });
});
