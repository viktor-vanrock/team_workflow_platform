import type { Sha256Digest } from "@awp/platform-contracts";

import type {
  ConnectorActor,
  ConnectorRuntimeContext,
  ConnectorScope,
  ConnectorVersionedReference,
} from "./runtime-context.ts";

export const sourceContextCapability = Object.freeze({
  key: "source-context.read" as const,
  version: "1.0.0" as const,
  operations: Object.freeze(["merge-request.read", "commit.read", "build.read"] as const),
});

export type SourceContextOperation = (typeof sourceContextCapability.operations)[number];
export type SourceContextKind = "MERGE_REQUEST" | "COMMIT" | "BUILD";

export interface TrustedConnectorExactReference extends ConnectorVersionedReference {
  readonly contentHash: Sha256Digest;
}

export interface TrustedConnectorConfigurationPin {
  readonly logicalRole: string;
  readonly capabilityKey: string;
  readonly exactContractVersion: string;
  readonly bindingRef: TrustedConnectorExactReference;
  readonly profileRef: TrustedConnectorExactReference;
  readonly connectionRef: TrustedConnectorExactReference;
  readonly mappingRef?: TrustedConnectorExactReference;
  readonly validationReportRef: TrustedConnectorExactReference;
  readonly operationSetHash: Sha256Digest;
}

/**
 * Server-owned context passed beside serialized capability messages. Browser,
 * model and provider payloads cannot choose or replace these values.
 */
export interface TrustedConnectorOperationContext extends Omit<
  ConnectorRuntimeContext,
  "configurationPins"
> {
  readonly scope: ConnectorScope;
  readonly actor: ConnectorActor;
  readonly authorizationBasisHash: Sha256Digest;
  readonly configurationPins: readonly TrustedConnectorConfigurationPin[];
  readonly deadlineAt: string;
  readonly telemetry: Readonly<{
    correlationId: string;
    causationId: string;
    operation: string;
  }>;
}

export type SourceContextSelector =
  | Readonly<{ sourceKind: "MERGE_REQUEST"; sourceRef: string; expectedRevision?: string }>
  | Readonly<{ sourceKind: "COMMIT"; sourceRef: string; expectedRevision?: string }>
  | Readonly<{ sourceKind: "BUILD"; sourceRef: string; expectedRevision?: string }>;

export interface SourceContextReadRequest {
  readonly schemaVersion: "source-context.read@1.0.0";
  readonly messageType: "REQUEST";
  readonly operation: SourceContextOperation;
  readonly selector: SourceContextSelector;
}

interface SourceObservationProvenance {
  readonly sourceRef: string;
  readonly providerRevisionToken: string;
  readonly observedAt: string;
  readonly observationHash: Sha256Digest;
}

export interface MergeRequestObservation extends SourceObservationProvenance {
  readonly sourceKind: "MERGE_REQUEST";
  readonly state: "OPEN" | "MERGED" | "CLOSED";
  readonly sourceRevision: string;
  readonly targetRevision: string;
  readonly headCommitSha: string;
  readonly buildRefs: readonly string[];
}

export interface CommitObservation extends SourceObservationProvenance {
  readonly sourceKind: "COMMIT";
  readonly commitSha: string;
  readonly parentCommitShas: readonly string[];
}

export interface BuildObservation extends SourceObservationProvenance {
  readonly sourceKind: "BUILD";
  readonly buildDigest: Sha256Digest;
  readonly sourceCommitSha: string;
  readonly state: "AVAILABLE" | "UNAVAILABLE" | "EXPIRED";
}

export type SourceContextObservation =
  MergeRequestObservation | CommitObservation | BuildObservation;

export interface SourceContextReadResult {
  readonly schemaVersion: "source-context.read@1.0.0";
  readonly messageType: "RESULT";
  readonly operation: SourceContextOperation;
  readonly observation: SourceContextObservation;
}

export interface SourceContextReadPort {
  read(
    context: TrustedConnectorOperationContext,
    request: SourceContextReadRequest,
  ): Promise<SourceContextReadResult>;
}
