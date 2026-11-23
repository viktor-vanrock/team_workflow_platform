import { type JsonValue, sha256 } from "@awp/platform-contracts";

export interface ConnectorIngressContract {
  readonly schemaVersion: "connector-ingress-contract@1.0.0";
  readonly key: string;
  readonly version: "1.0.0";
  readonly routeKind: "DIALOG_SUBMISSION" | "POST_ACTION";
  readonly connectionFamily: string;
  readonly method: "POST";
  readonly contentType: "application/json" | "application/x-www-form-urlencoded";
  readonly maxRawBytes: number;
  readonly authentication: "AWP_OPAQUE_INTENT" | "SIGNED_PROXY_HMAC_PLUS_AWP_INTENT";
  readonly deliveryIdentityMode: "PROVIDER_DELIVERY_ID" | "EXACT_BODY_FINGERPRINT";
  readonly freshnessSeconds: number;
  readonly retryHorizonSeconds: number;
  readonly clockSkewSeconds: number;
  readonly receiptRetentionSeconds: number;
  readonly normalizedSchemaRef: Readonly<{ id: string; version: number; digest: string }>;
  readonly acknowledgementSchemaRef: Readonly<{ id: string; version: number; digest: string }>;
}
export interface NormalizedIngressEnvelope<T = unknown> {
  readonly contractRef: Readonly<{ key: string; version: string; hash: `sha256:${string}` }>;
  readonly transportAttemptKey: string;
  readonly bodyHash: `sha256:${string}`;
  readonly externalDeliveryId?: string;
  readonly normalized: T;
  readonly receivedAt: Date;
}
export function defineConnectorIngressContract(
  contract: ConnectorIngressContract,
): ConnectorIngressContract {
  if (contract.maxRawBytes < 1 || contract.maxRawBytes > 1_048_576)
    throw new Error("INGRESS_RAW_SIZE_INVALID");
  if (contract.receiptRetentionSeconds < contract.retryHorizonSeconds + contract.clockSkewSeconds)
    throw new Error("INGRESS_RETENTION_TOO_SHORT");
  return Object.freeze(structuredClone(contract));
}

export type ExternalInteractionReceiptState =
  "ACCEPTED" | "PROCESSING" | "DUPLICATE" | "DENIED" | "PROCESSED" | "FAILED";
export class ExternalInteractionReceiptAggregate<T> {
  readonly envelope: NormalizedIngressEnvelope<T>;
  #state: ExternalInteractionReceiptState = "ACCEPTED";
  #resultRef?: string;
  constructor(
    contract: ConnectorIngressContract,
    input: {
      contractHash: `sha256:${string}`;
      body: Uint8Array;
      externalDeliveryId?: string;
      normalized: T;
      receivedAt: Date;
    },
  ) {
    defineConnectorIngressContract(contract);
    if (input.body.byteLength > contract.maxRawBytes) throw new Error("INGRESS_BODY_TOO_LARGE");
    const bodyHash = sha256(new TextDecoder().decode(input.body));
    const transportAttemptKey =
      contract.deliveryIdentityMode === "PROVIDER_DELIVERY_ID"
        ? input.externalDeliveryId
        : bodyHash;
    if (!transportAttemptKey) throw new Error("INGRESS_DELIVERY_ID_REQUIRED");
    this.envelope = Object.freeze({
      contractRef: { key: contract.key, version: contract.version, hash: input.contractHash },
      transportAttemptKey,
      bodyHash,
      ...(input.externalDeliveryId ? { externalDeliveryId: input.externalDeliveryId } : {}),
      normalized: structuredClone(input.normalized),
      receivedAt: input.receivedAt,
    });
  }
  claim(): void {
    if (this.#state !== "ACCEPTED") throw new Error("INGRESS_RECEIPT_NOT_CLAIMABLE");
    this.#state = "PROCESSING";
  }
  complete(resultRef: string): void {
    if (this.#state !== "PROCESSING") throw new Error("INGRESS_RECEIPT_NOT_PROCESSING");
    this.#state = "PROCESSED";
    this.#resultRef = resultRef;
  }
  replay(
    body: Uint8Array,
  ): Readonly<{ state: ExternalInteractionReceiptState; resultRef?: string }> {
    if (sha256(new TextDecoder().decode(body)) !== this.envelope.bodyHash)
      throw new Error("INGRESS_DELIVERY_BODY_CONFLICT");
    return Object.freeze({
      state: this.#state,
      ...(this.#resultRef ? { resultRef: this.#resultRef } : {}),
    });
  }
  safeEnvelope(): JsonValue {
    return structuredClone(this.envelope) as unknown as JsonValue;
  }
}
