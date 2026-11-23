import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { InMemoryExactWebhookInbox } from "../../../../packages/platform-core/src/index.ts";

describe("exact Jira webhook ingress", () => {
  it("persists exact bytes before ACK and scopes dedupe by connection", async () => {
    const inbox = new InMemoryExactWebhookInbox({ maxBytes: 128, retryHorizonMs: 60_000 });
    const bytes = new TextEncoder().encode('{"issue":{"id":"1"}}');
    const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    expect(
      (
        await inbox.persist({
          connectionId: "c1",
          deliveryId: "d1",
          rawBytes: bytes,
          bodyHash: hash,
          contentType: "application/json",
          receivedAt: new Date("2026-01-01"),
        })
      ).status,
    ).toBe("ACCEPTED");
    expect(
      (
        await inbox.persist({
          connectionId: "c1",
          deliveryId: "d1",
          rawBytes: bytes,
          bodyHash: hash,
          contentType: "application/json",
          receivedAt: new Date("2026-01-01"),
        })
      ).status,
    ).toBe("DUPLICATE");
    await expect(
      inbox.persist({
        connectionId: "c1",
        deliveryId: "d1",
        rawBytes: new Uint8Array([1]),
        bodyHash: "sha256:other",
        contentType: "application/json",
        receivedAt: new Date("2026-01-01"),
      }),
    ).rejects.toThrow("DELIVERY_HASH_CONFLICT");
    expect(inbox.receipt("c1", "d1")?.rawBytes).toEqual(bytes);
  });

  it("rejects oversize and expired deliveries", async () => {
    const inbox = new InMemoryExactWebhookInbox({ maxBytes: 1, retryHorizonMs: 1 });
    await expect(
      inbox.persist({
        connectionId: "c",
        deliveryId: "d",
        rawBytes: new Uint8Array([1, 2]),
        bodyHash: "sha256:x",
        contentType: "application/json",
        receivedAt: new Date(),
      }),
    ).rejects.toThrow("WEBHOOK_BODY_TOO_LARGE");
  });
});
