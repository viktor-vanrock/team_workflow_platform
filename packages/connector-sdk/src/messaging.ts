import type { SchemaReference } from "@awp/platform-contracts";

export type MessagingLogicalTarget =
  | Readonly<{ kind: "PROJECT_CHANNEL"; purpose: string }>
  | Readonly<{ kind: "PRINCIPAL_DM"; principalId: string }>
  | Readonly<{ kind: "INTERACTION_RESPONSE"; sourceInteractionIntentId: string }>;

export interface SafeProviderReference {
  readonly kind: "MESSAGE" | "CHANNEL" | "PENDING_MESSAGE" | "EFFECT_MARKER";
  readonly opaqueId: string;
}

export interface MessagingPayloadCommitment {
  readonly templateRef: Readonly<{ key: string; version: string; hash: `sha256:${string}` }>;
  readonly variablesSchemaRef: SchemaReference;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly targetHash: `sha256:${string}`;
  readonly payloadHash: `sha256:${string}`;
  readonly renderHash: `sha256:${string}`;
}

export interface MessagingNotificationRequest extends MessagingPayloadCommitment {
  readonly target: MessagingLogicalTarget;
  readonly effectIdempotencyKey: string;
  readonly expiresAt: Date;
}

export interface MessagingCallbackPresentationRequest extends MessagingNotificationRequest {
  readonly presentation: Readonly<{
    actionInteractionIntentIds: readonly string[];
    actionSetHash: `sha256:${string}`;
  }>;
}

export type MessagingDeliveryResult =
  | Readonly<{ outcome: "DELIVERED"; providerRef: SafeProviderReference }>
  | Readonly<{
      outcome: "LOOKUP_REQUIRED";
      selector: SafeProviderReference;
      retryAfterSeconds?: number;
    }>
  | Readonly<{
      outcome: "AMBIGUOUS" | "FAILED" | "EXPIRED";
      code: string;
      retryAfterSeconds?: number;
    }>;

export function validateMessagingTarget(target: MessagingLogicalTarget): MessagingLogicalTarget {
  const value = target as unknown as Record<string, unknown>;
  if ("channelId" in value || "response_url" in value || "url" in value)
    throw new Error("CALLER_SELECTED_PROVIDER_ROUTE_FORBIDDEN");
  if (target.kind === "PROJECT_CHANNEL" && target.purpose.length === 0)
    throw new Error("PROJECT_CHANNEL_PURPOSE_REQUIRED");
  if (target.kind === "PRINCIPAL_DM" && target.principalId.length === 0)
    throw new Error("PRINCIPAL_DM_REQUIRED");
  if (target.kind === "INTERACTION_RESPONSE" && target.sourceInteractionIntentId.length === 0)
    throw new Error("SOURCE_INTERACTION_INTENT_REQUIRED");
  return Object.freeze(structuredClone(target));
}
