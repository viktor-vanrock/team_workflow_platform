import type { OperationalNormalizedStatus } from "./operational-work-item.ts";
import type { ConnectorRuntimeContext, ConnectorVersionedReference } from "./runtime-context.ts";

export type OperationalErrorCategory =
  | "AUTHENTICATION"
  | "PERMISSION"
  | "CONFLICT"
  | "RATE_LIMIT"
  | "TRANSIENT"
  | "VALIDATION"
  | "NOT_FOUND"
  | "MAPPING_DRIFT"
  | "AMBIGUOUS"
  | "SECURITY_SCOPE";
export type EffectLookupState = "FOUND" | "PROVEN_ABSENT" | "UNKNOWN" | "MULTIPLE";

export interface OperationalAuthorityObservation {
  readonly observationId: string;
  readonly source:
    | "CREATE_READ_BACK"
    | "IMPORT_READ"
    | "COMMAND_CONFIRMATION"
    | "WEBHOOK_READ"
    | "RECONCILIATION_READ"
    | "CONFLICT_READ";
  readonly externalEntityId: string;
  readonly externalDisplayKey: string;
  readonly externalWebUrl?: string;
  readonly externalRevisionToken: string;
  readonly authorityFieldsHash: string;
  readonly providerUpdatedAt: string;
  readonly providerChangelogId?: string;
  readonly observedAt: string;
  readonly rawStatus: Readonly<{ id: string; name: string }>;
  readonly normalizedStatus: OperationalNormalizedStatus;
  readonly requester: Readonly<{ externalPrincipalId: string; canonicalPrincipalId?: string }>;
  readonly assignee?: Readonly<{
    externalPrincipalId: string;
    canonicalPrincipalId?: string;
  }> | null;
  readonly priority?: Readonly<{ rawId: string; rawName: string; normalizedKey: string }> | null;
  readonly dueDate?: string | null;
  readonly profileRef: ConnectorVersionedReference;
  readonly mappingRef: ConnectorVersionedReference;
  readonly connectionRef: ConnectorVersionedReference;
  readonly adapterFamily: string;
  readonly adapterContractVersion: string;
}

export interface ConnectorSecretLease {
  readonly metadata: Readonly<Record<string, unknown>>;
  withMaterial<T>(now: Date, use: (bytes: Uint8Array) => T): T;
}

export interface SecretResolverPort {
  resolve(
    secretRef: string,
    allowedUseHash: string,
    signal: AbortSignal,
  ): Promise<ConnectorSecretLease>;
}

export interface ConnectorDiscoveryPort {
  discover(context: ConnectorRuntimeContext): Promise<Readonly<Record<string, unknown>>>;
}

export interface OperationalObservationPort {
  read(
    context: ConnectorRuntimeContext,
    externalEntityId: string,
  ): Promise<OperationalAuthorityObservation>;
}

export interface ConnectorWebhookNormalizerPort {
  normalize(
    input: Readonly<{
      context: ConnectorRuntimeContext;
      headers: Readonly<Record<string, string>>;
      rawBytes: Uint8Array;
      receivedAt: Date;
    }>,
  ): Promise<Readonly<Record<string, unknown>>>;
}

export interface ConnectorReconciliationPort {
  page(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>;
}

export interface ConnectorProfileValidationPort {
  validate(
    input: Readonly<Record<string, unknown>>,
  ): Promise<
    Readonly<{ status: "VALID" | "INVALID"; issues: readonly Readonly<Record<string, unknown>>[] }>
  >;
}

export interface ExternalPrincipalResolutionPort {
  resolve(
    input: Readonly<{
      workspaceId: string;
      connectionHeaderId: string;
      canonicalPrincipalId: string;
    }>,
  ): Promise<Readonly<{ providerSubject: string; bindingRef: ConnectorVersionedReference }>>;
}
