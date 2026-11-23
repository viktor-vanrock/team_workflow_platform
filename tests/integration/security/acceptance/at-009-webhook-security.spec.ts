import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  InMemoryEventInbox,
  processEvent,
} from "../../../../packages/platform-core/src/events/event-processing.ts";
import {
  InMemoryWebhookInbox,
  WebhookIngress,
} from "../../../../packages/platform-core/src/events/webhook-ingress.ts";

const signed = (raw: Uint8Array, timestamp: string) =>
  `sha256=${createHmac("sha256", "webhook-secret").update(timestamp).update(".").update(raw).digest("hex")}`;
describe("AT-009 webhook security", () => {
  it("verifies raw signature/replay before parsing and quarantines pre-Project failures", async () => {
    const inbox = new InMemoryWebhookInbox();
    const ingress = new WebhookIngress(inbox, { "sample.mock": "webhook-secret" });
    const bad = new TextEncoder().encode("not-json");
    await expect(
      ingress.accept({
        connectorKey: "sample.mock",
        deliveryId: "d1",
        timestamp: "2026-01-01T00:00:00.000Z",
        signature: "bad",
        rawBody: bad,
      }),
    ).rejects.toThrow("SIGNATURE_INVALID");
    expect(inbox.securityAudit()[0]).toMatchObject({
      scope: { kind: "WORKSPACE" },
      actor: { kind: "SERVICE" },
    });
    const raw = new TextEncoder().encode(JSON.stringify({ eventId: "e1", entityVersion: 1 }));
    const timestamp = "2026-01-01T00:00:00.000Z";
    const request = {
      connectorKey: "sample.mock",
      deliveryId: "d2",
      timestamp,
      signature: signed(raw, timestamp),
      rawBody: raw,
    };
    expect((await ingress.accept(request)).status).toBe("ACCEPTED");
    expect((await ingress.accept(request)).status).toBe("DUPLICATE");
    await expect(
      ingress.accept({
        ...request,
        rawBody: new TextEncoder().encode("{}"),
        signature: signed(new TextEncoder().encode("{}"), timestamp),
      }),
    ).rejects.toThrow("DELIVERY_HASH_CONFLICT");
  });
  it("deduplicates consumers and identifies gaps", async () => {
    const inbox = new InMemoryEventInbox();
    expect(
      (await processEvent(inbox, "projection", { eventId: "e1", entityId: "a", entityVersion: 1 }))
        .status,
    ).toBe("PROCESSED");
    expect(
      (await processEvent(inbox, "projection", { eventId: "e1", entityId: "a", entityVersion: 1 }))
        .status,
    ).toBe("DUPLICATE");
    expect(
      (await processEvent(inbox, "projection", { eventId: "e3", entityId: "a", entityVersion: 3 }))
        .status,
    ).toBe("GAP_REQUIRES_RECONCILIATION");
  });
});
