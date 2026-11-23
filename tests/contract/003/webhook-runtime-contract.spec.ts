import { describe, expect, it } from "vitest";

import {
  type ConnectorWebhookIngressPort,
  ConnectorWebhooksController,
} from "../../../packages/platform-runtime-nest/src/http/connector-webhooks.controller.ts";

describe("003 Jira webhook runtime contract", () => {
  it("matches the published Jira route inputs and returns a stable receipt identity", async () => {
    const accepted: Record<string, unknown>[] = [];
    const receiptId = "11111111-1111-4111-8111-111111111111";
    const ingress: ConnectorWebhookIngressPort = {
      accept: async (input) => {
        accepted.push(input as unknown as Record<string, unknown>);
        return { status: "ACCEPTED", receiptId };
      },
    };
    const controller = new ConnectorWebhooksController(ingress);
    const webhookKey = "local-webhook-key-0000000000000001";

    await expect(
      controller.receive(
        "jira",
        "connection-1",
        webhookKey,
        {
          "content-type": "application/json",
          "x-atlassian-webhook-identifier": "delivery-1",
          "x-hub-signature": "sha256=signature",
        },
        { rawBody: Buffer.from("{}") },
      ),
    ).resolves.toEqual({ status: "ACCEPTED", receiptId });

    expect(accepted).toEqual([
      expect.objectContaining({
        connectorKey: "jira",
        connectionId: "connection-1",
        webhookKey,
      }),
    ]);
  });
});
