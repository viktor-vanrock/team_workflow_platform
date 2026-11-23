import type { Sha256Digest } from "@awp/platform-contracts";

import type { ConnectorVersionedReference } from "./runtime-context.ts";
import type { TrustedConnectorOperationContext } from "./source-context.ts";

export const ciArtifactCapability = Object.freeze({
  key: "artifact.ci-read" as const,
  version: "1.0.0" as const,
  operations: Object.freeze(["artifact.metadata", "artifact.stream"] as const),
});

export type CiArtifactOperation = (typeof ciArtifactCapability.operations)[number];
export type CiArtifactKind = "RESULT" | "REPORT" | "LOG" | "SCREENSHOT" | "TRACE" | "OTHER";
export type CiArtifactAvailability = "AVAILABLE" | "MISSING" | "EXPIRED" | "CHECKSUM_MISMATCH";
export type CiArtifactChecksumSource = "MACHINE_RESULT_MANIFEST" | "CONNECTOR_CONTENT_SHA256";

export interface CiArtifactMetadataRequest {
  readonly schemaVersion: "artifact.ci-read@1.0.0";
  readonly messageType: "REQUEST";
  readonly operation: "artifact.metadata";
  readonly automationAttemptId: string;
  readonly externalPipelineId: string;
  readonly externalJobId: string;
  readonly logicalArtifactKey: string;
  readonly resultHash: Sha256Digest;
}

export interface CiArtifactDescriptor {
  readonly schemaVersion: "artifact.ci-read@1.0.0";
  readonly messageType: "RESULT";
  readonly operation: "artifact.metadata";
  readonly descriptorId: string;
  readonly descriptorHash: Sha256Digest;
  readonly workItemId: string;
  readonly testSessionId: string;
  readonly automationAttemptId: string;
  readonly externalPipelineId: string;
  readonly externalJobId: string;
  readonly artifactKind: CiArtifactKind;
  readonly opaqueLocatorHash: Sha256Digest;
  readonly fileName: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly checksum: Sha256Digest;
  readonly checksumSource: CiArtifactChecksumSource;
  readonly classification: string;
  readonly availability: CiArtifactAvailability;
  readonly sourceProfileRef: ConnectorVersionedReference;
  readonly sourceProfileHash: Sha256Digest;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly provenanceHash: Sha256Digest;
}

export interface CiArtifactStreamRequest {
  readonly schemaVersion: "artifact.ci-read@1.0.0";
  readonly messageType: "REQUEST";
  readonly operation: "artifact.stream";
  readonly artifactReferenceId: string;
  readonly descriptorId: string;
  readonly descriptorHash: Sha256Digest;
  readonly expectedByteSize: number;
  readonly expectedChecksum: Sha256Digest;
  readonly expectedClassification: string;
}

export interface CiArtifactStreamMetadata {
  readonly schemaVersion: "artifact.ci-read@1.0.0";
  readonly messageType: "RESULT";
  readonly operation: "artifact.stream";
  readonly artifactReferenceId: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly checksum: Sha256Digest;
  readonly checksumSource: CiArtifactChecksumSource;
  readonly classification: string;
  readonly availability: "AVAILABLE";
  readonly verifiedAt: string;
  readonly streamReceiptHash: Sha256Digest;
}

export interface CiArtifactStream {
  readonly metadata: CiArtifactStreamMetadata;
  readonly bytes: ReadableStream<Uint8Array>;
}

export interface CiArtifactPort {
  metadata(
    context: TrustedConnectorOperationContext,
    request: CiArtifactMetadataRequest,
  ): Promise<CiArtifactDescriptor>;
  stream(
    context: TrustedConnectorOperationContext,
    request: CiArtifactStreamRequest,
  ): Promise<CiArtifactStream>;
}
