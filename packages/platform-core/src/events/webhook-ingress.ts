import type { WriteStageAuditor } from "../audit/write-stage-auditor.ts";

export interface RawWebhookRequest {
  readonly connectorKey: string;
  readonly deliveryId: string;
  readonly timestamp: string;
  readonly signature: string;
  readonly rawBody: Uint8Array;
}

interface Receipt {
  readonly connectorKey: string;
  readonly deliveryId: string;
  readonly bodyHash: string;
  readonly parsed: unknown;
}

export interface ExactWebhookReceiptInput {
  readonly connectionId: string;
  readonly deliveryId: string;
  readonly rawBytes: Uint8Array;
  readonly bodyHash: string;
  readonly contentType: string;
  readonly receivedAt: Date;
}

export interface ExactWebhookReceipt extends ExactWebhookReceiptInput {
  readonly rawBytes: Uint8Array;
  readonly status: "ACCEPTED";
}

export class InMemoryExactWebhookInbox {
  readonly #receipts = new Map<string, ExactWebhookReceipt>();
  constructor(private readonly policy: Readonly<{ maxBytes: number; retryHorizonMs: number }>) {
    if (policy.maxBytes <= 0 || policy.retryHorizonMs <= 0)
      throw new Error("WEBHOOK_POLICY_INVALID");
  }
  async persist(
    input: ExactWebhookReceiptInput,
  ): Promise<Readonly<{ status: "ACCEPTED" | "DUPLICATE" }>> {
    if (input.rawBytes.byteLength > this.policy.maxBytes) throw new Error("WEBHOOK_BODY_TOO_LARGE");
    if (input.contentType !== "application/json") throw new Error("WEBHOOK_CONTENT_TYPE_REJECTED");
    const key = `${input.connectionId}\0${input.deliveryId}`;
    const existing = this.#receipts.get(key);
    if (existing) {
      if (existing.bodyHash !== input.bodyHash) throw new Error("DELIVERY_HASH_CONFLICT");
      return Object.freeze({ status: "DUPLICATE" });
    }
    this.#receipts.set(
      key,
      Object.freeze({
        ...input,
        rawBytes: input.rawBytes.slice(),
        receivedAt: new Date(input.receivedAt),
        status: "ACCEPTED",
      }),
    );
    return Object.freeze({ status: "ACCEPTED" });
  }
  receipt(connectionId: string, deliveryId: string): ExactWebhookReceipt | undefined {
    const value = this.#receipts.get(`${connectionId}\0${deliveryId}`);
    return value
      ? { ...value, rawBytes: value.rawBytes.slice(), receivedAt: new Date(value.receivedAt) }
      : undefined;
  }
}

const encoder = new TextEncoder();

function joinSignaturePayload(timestamp: string, rawBody: Uint8Array): Uint8Array {
  const prefix = encoder.encode(`${timestamp}.`);
  const payload = new Uint8Array(prefix.byteLength + rawBody.byteLength);
  payload.set(prefix);
  payload.set(rawBody, prefix.byteLength);
  return payload;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function copiedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.byteLength, rightBytes.byteLength);
  let difference = leftBytes.byteLength ^ rightBytes.byteLength;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

async function hmac(secret: string, timestamp: string, rawBody: Uint8Array): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    copiedArrayBuffer(joinSignaturePayload(timestamp, rawBody)),
  );
  return `sha256=${hex(signature)}`;
}

async function sha256(rawBody: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copiedArrayBuffer(rawBody));
  return `sha256:${hex(digest)}`;
}

export class InMemoryWebhookInbox {
  readonly #receipts = new Map<string, Receipt>();
  readonly #audit: unknown[] = [];

  receipt(connector: string, delivery: string): Receipt | undefined {
    return this.#receipts.get(`${connector}\0${delivery}`);
  }

  save(value: Receipt): void {
    this.#receipts.set(`${value.connectorKey}\0${value.deliveryId}`, structuredClone(value));
  }

  audit(value: unknown): void {
    this.#audit.push(structuredClone(value));
  }

  securityAudit(): readonly unknown[] {
    return structuredClone(this.#audit);
  }
}

export class WebhookIngress {
  constructor(
    private readonly inbox: InMemoryWebhookInbox,
    private readonly secrets: Readonly<Record<string, string>>,
    private readonly audit?: WriteStageAuditor,
  ) {}

  async accept(
    request: RawWebhookRequest,
  ): Promise<Readonly<{ status: "ACCEPTED" | "DUPLICATE"; parsed: unknown }>> {
    const secret = this.secrets[request.connectorKey];
    if (!secret) {
      throw new Error("CONNECTOR_WEBHOOK_SECRET_NOT_FOUND");
    }

    const expected = await hmac(secret, request.timestamp, request.rawBody);
    if (!constantTimeEqual(expected, request.signature)) {
      this.inbox.audit({
        scope: {
          kind: "WORKSPACE",
          workspaceId: `quarantine:${request.connectorKey}`,
        },
        actor: {
          kind: "SERVICE",
          principalId: `webhook:${request.connectorKey}`,
          serviceKey: request.connectorKey,
        },
        reasonCode: "SIGNATURE_INVALID",
      });
      throw new Error("SIGNATURE_INVALID");
    }

    const bodyHash = await sha256(request.rawBody);
    const existing = this.inbox.receipt(request.connectorKey, request.deliveryId);
    if (existing) {
      if (existing.bodyHash !== bodyHash) {
        throw new Error("DELIVERY_HASH_CONFLICT");
      }
      return Object.freeze({ status: "DUPLICATE", parsed: existing.parsed });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(request.rawBody));
    } catch {
      throw new Error("WEBHOOK_JSON_INVALID");
    }

    this.inbox.save({
      connectorKey: request.connectorKey,
      deliveryId: request.deliveryId,
      bodyHash,
      parsed,
    });
    await this.audit?.record({
      stage: "WEBHOOK",
      workspaceId: `quarantine:${request.connectorKey}`,
      action: "webhook.ingest",
      resultCode: "ACCEPTED",
      reasonCode: "SIGNATURE_VERIFIED",
      attributes: {},
    });
    return Object.freeze({ status: "ACCEPTED", parsed });
  }
}
