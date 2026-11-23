import { createHmac } from "node:crypto";

export interface SignedWebhookFixture {
  readonly rawBody: Uint8Array;
  readonly headers: Readonly<{
    "x-awp-delivery-id": string;
    "x-awp-timestamp": string;
    "x-awp-signature": string;
    "x-hub-signature": string;
  }>;
}
export class SignedWebhookEmitter {
  constructor(
    private readonly secret: string,
    private readonly now: () => Date = () => new Date(),
  ) {}
  create(deliveryId: string, envelope: unknown): SignedWebhookFixture {
    const rawBody = new TextEncoder().encode(JSON.stringify(envelope));
    const timestamp = this.now().toISOString();
    const signature = createHmac("sha256", this.secret)
      .update(timestamp)
      .update(".")
      .update(rawBody)
      .digest("hex");
    const hubSignature = createHmac("sha256", this.secret).update(rawBody).digest("hex");
    return Object.freeze({
      rawBody,
      headers: Object.freeze({
        "x-awp-delivery-id": deliveryId,
        "x-awp-timestamp": timestamp,
        "x-awp-signature": `sha256=${signature}`,
        "x-hub-signature": `sha256=${hubSignature}`,
      }),
    });
  }
  duplicate(
    deliveryId: string,
    envelope: unknown,
  ): readonly [SignedWebhookFixture, SignedWebhookFixture] {
    const fixture = this.create(deliveryId, envelope);
    return Object.freeze([fixture, fixture]);
  }
  outOfOrder(
    first: Readonly<{ id: string; sequence: number }>,
    second: Readonly<{ id: string; sequence: number }>,
  ): readonly SignedWebhookFixture[] {
    return Object.freeze([this.create(second.id, second), this.create(first.id, first)]);
  }
}
