import type { SchemaReference } from "@awp/platform-contracts";

export type IngressRouteKind = "DIALOG_SUBMISSION" | "POST_ACTION";
export type IngressAuthentication = "AWP_OPAQUE_INTENT" | "SIGNED_PROXY_HMAC_PLUS_AWP_INTENT";
export type DeliveryIdentityMode = "PROVIDER_DELIVERY_ID" | "EXACT_BODY_FINGERPRINT";

export interface ConnectorIngressContract {
  readonly schemaVersion: "connector-ingress-contract@1.0.0";
  readonly key: string;
  readonly version: "1.0.0";
  readonly routeKind: IngressRouteKind;
  readonly connectionFamily: string;
  readonly method: "POST";
  readonly contentType: "application/json" | "application/x-www-form-urlencoded";
  readonly maxRawBytes: number;
  readonly authentication: IngressAuthentication;
  readonly deliveryIdentityMode: DeliveryIdentityMode;
  readonly freshnessSeconds: number;
  readonly retryHorizonSeconds: number;
  readonly clockSkewSeconds: number;
  readonly receiptRetentionSeconds: number;
  readonly normalizedSchemaRef: SchemaReference;
  readonly acknowledgementSchemaRef: SchemaReference;
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
  if (contract.routeKind === "POST_ACTION" && contract.contentType !== "application/json")
    throw new Error("POST_ACTION_CONTENT_TYPE_INVALID");
  return Object.freeze(structuredClone(contract));
}
