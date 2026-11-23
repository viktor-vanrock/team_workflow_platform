export interface ConnectorScope {
  readonly kind: "PROJECT";
  readonly workspaceId: string;
  readonly projectId: string;
}

export interface ConnectorActor {
  readonly kind: "HUMAN" | "SERVICE" | "SYSTEM";
  readonly principalId: string;
  readonly serviceKey?: string;
}

export interface ConnectorVersionedReference {
  readonly id: string;
  readonly version: number;
}

/** Neutral execution context. Core may structurally provide it without becoming an SDK dependency. */
export interface ConnectorRuntimeContext {
  readonly scope: ConnectorScope;
  readonly actor: ConnectorActor;
  readonly correlationId: string;
  readonly causationId: string;
  readonly effectIdempotencyKey: string;
  readonly profileRef: ConnectorVersionedReference;
  readonly classification: Readonly<{ key: string; rank: number }>;
  readonly signal: AbortSignal;
  readonly configurationPins?: readonly Readonly<Record<string, unknown>>[];
  readonly trustedExternalSubject?: string;
}
