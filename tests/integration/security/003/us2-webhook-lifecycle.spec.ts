import { describe, expect, it } from "vitest";

import { JiraWebhookLifecycle } from "../../../../packages/runtime-composition/src/jira/webhook-handlers.ts";

describe("US2 webhook lifecycle", () => {
  it("supports Cloud delivery ids, DC hash fallback, rotation overlap and expiry", () => {
    const lifecycle = new JiraWebhookLifecycle({
      activeKeyVersion: "k2",
      overlapKeyVersions: ["k1"],
      expiresAt: new Date("2026-09-01T00:00:00Z"),
    });
    expect(
      lifecycle.verify({
        family: "CLOUD",
        deliveryId: "d1",
        bodyHash: "h",
        verifiedKeyVersion: "k1",
        now: new Date("2026-08-31T00:00:00Z"),
      }),
    ).toMatchObject({ identity: "d1", health: "CURRENT" });
    expect(
      lifecycle.verify({
        family: "DC",
        bodyHash: "h",
        changelogId: "7",
        verifiedKeyVersion: "k2",
        now: new Date("2026-08-31T00:00:00Z"),
      }),
    ).toMatchObject({ identity: "7:h" });
    expect(() =>
      lifecycle.verify({
        family: "CLOUD",
        deliveryId: "d2",
        bodyHash: "h",
        verifiedKeyVersion: "k1",
        now: new Date("2026-09-02T00:00:00Z"),
      }),
    ).toThrow("WEBHOOK_REGISTRATION_EXPIRED");
  });
});
