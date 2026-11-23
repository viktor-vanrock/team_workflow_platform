import { describe, expect, it } from "vitest";

import { redactJiraAuth } from "../../../../packages/connector-jira/src/auth/jira-auth.ts";
import { JiraRestClient } from "../../../../packages/connector-jira/src/http/jira-rest-client.ts";
import { InMemoryExactWebhookInbox } from "../../../../packages/platform-core/src/events/webhook-ingress.ts";

describe("003 connector hardening", () => {
  it("rejects SSRF/redirect, webhook replay mismatch and redacts auth/PII", async () => {
    const client = new JiraRestClient({
      baseUrl: "http://127.0.0.1:3010",
      environment: "LOCAL",
      allowedOrigins: ["http://127.0.0.1:3010"],
      transport: async () =>
        new Response(null, { status: 302, headers: { location: "https://evil.invalid" } }),
    });
    await expect(client.request({ method: "GET", path: "/rest/api/3/issue/1" })).rejects.toThrow(
      "JIRA_REDIRECT_FORBIDDEN",
    );
    const inbox = new InMemoryExactWebhookInbox({ maxBytes: 100, retryHorizonMs: 1000 });
    const first = {
      connectionId: "c",
      deliveryId: "d",
      rawBytes: new Uint8Array([1]),
      bodyHash: "h1",
      contentType: "application/json",
      receivedAt: new Date(),
    };
    await inbox.persist(first);
    await expect(
      inbox.persist({ ...first, rawBytes: new Uint8Array([2]), bodyHash: "h2" }),
    ).rejects.toThrow("DELIVERY_HASH_CONFLICT");
    expect(
      JSON.stringify(redactJiraAuth({ authorization: "Bearer secret", cookie: "pii", safe: "ok" })),
    ).not.toMatch(/secret|pii/u);
  });
});
