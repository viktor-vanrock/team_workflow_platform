import type { Sha256Digest } from "@awp/platform-contracts";

import type {
  EvidenceProtectedHeader,
  EvidenceSignatureEnvelope,
  QaEvidenceManifestRevisionV2,
} from "../domain/evidence-manifest-v2.ts";

export interface EvidenceManifestSignerPort {
  sign(
    input: Readonly<{
      manifest: QaEvidenceManifestRevisionV2;
      canonicalPayload: string;
      payloadHash: Sha256Digest;
      protectedHeader: EvidenceProtectedHeader;
    }>,
  ): Promise<
    Readonly<{
      signature: string;
      publicKeyRef: Readonly<{ id: string; version: number; contentHash: Sha256Digest }>;
    }>
  >;
}

export interface EvidenceManifestVerifierPort {
  verify(
    manifest: QaEvidenceManifestRevisionV2,
    envelope: EvidenceSignatureEnvelope,
  ): Promise<"VALID" | "INVALID" | "KEY_UNAVAILABLE">;
}

export interface ImmutablePublicKeyResolverPort {
  resolve(
    ref: Readonly<{ id: string; version: number; contentHash: Sha256Digest }>,
  ): Promise<Readonly<{ kid: string; algorithm: "Ed25519"; publicKey: unknown }> | undefined>;
}

export interface ArtifactAvailabilityPort {
  current(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    artifactId: string,
  ): Promise<"AVAILABLE" | "EXPIRED" | "QUARANTINED" | "UNAVAILABLE">;
}
