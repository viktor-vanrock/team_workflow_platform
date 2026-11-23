import { describe, expect, it } from "vitest";

import { InMemoryExactWebhookInbox } from "../../../packages/platform-core/src/events/webhook-ingress.ts";
import { JiraWebhookHandler } from "../../../packages/runtime-composition/src/jira/webhook-handlers.ts";

describe("US3 webhook hint semantics", () => {
  it("persists the signal and schedules a read without promoting payload fields", async () => {
    const handler = new JiraWebhookHandler(
      new InMemoryExactWebhookInbox({ maxBytes: 1000, retryHorizonMs: 1000 }),
    );
    const result = await handler.accept({
      connectionId: "c",
      deliveryId: "d",
      rawBytes: new TextEncoder().encode("{}"),
      bodyHash: "sha256:x",
      contentType: "application/json",
      receivedAt: new Date(),
      event: {
        webhookEvent: "jira:issue_updated",
        issue: { id: "1", fields: { status: { name: "FORGED_DONE" } } },
      },
    });
    expect(result.job).toMatchObject({ externalEntityId: "1", source: "WEBHOOK_READ" });
    expect(JSON.stringify(result.job)).not.toContain("FORGED_DONE");
  });
});
