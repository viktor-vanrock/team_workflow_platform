import { describe, expect, it } from "vitest";

import { ExternalInteractionReceiptAggregate } from "../../../packages/platform-core/src/index.ts";

const contract = {
  schemaVersion: "connector-ingress-contract@1.0.0" as const,
  key: "post",
  version: "1.0.0" as const,
  routeKind: "POST_ACTION" as const,
  connectionFamily: "mattermost-v4",
  method: "POST" as const,
  contentType: "application/json" as const,
  maxRawBytes: 1024,
  authentication: "AWP_OPAQUE_INTENT" as const,
  deliveryIdentityMode: "PROVIDER_DELIVERY_ID" as const,
  freshnessSeconds: 60,
  retryHorizonSeconds: 120,
  clockSkewSeconds: 5,
  receiptRetentionSeconds: 125,
  normalizedSchemaRef: { id: "n", version: 1, digest: "sha256:n" },
  acknowledgementSchemaRef: { id: "a", version: 1, digest: "sha256:a" },
};
describe("ExternalInteractionReceipt", () =>
  it("replays same ID/body and rejects changed body", () => {
    const receipt = new ExternalInteractionReceiptAggregate(contract, {
      contractHash: "sha256:c",
      body: new TextEncoder().encode("one"),
      externalDeliveryId: "delivery",
      normalized: { intentId: "i" },
      receivedAt: new Date(),
    });
    receipt.claim();
    receipt.complete("result");
    expect(receipt.replay(new TextEncoder().encode("one"))).toMatchObject({ resultRef: "result" });
    expect(() => receipt.replay(new TextEncoder().encode("two"))).toThrow(/CONFLICT/u);
  }));
