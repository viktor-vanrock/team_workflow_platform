import { canonicalize, type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

import { QaDomainError } from "./primitives.ts";

export type EvidenceIntegrityMode = "LEGACY_INTEGRITY_ONLY" | "SIGNED_V2";

export interface EvidenceProtectedHeader {
  readonly alg: "EdDSA";
  readonly kid: string;
  readonly typ: "application/awp-evidence+json";
}

export interface EvidenceSignatureEnvelope {
  readonly signatureId: string;
  readonly version: 1;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly manifestRevisionRef: Readonly<{
    id: string;
    version: number;
    contentHash: Sha256Digest;
  }>;
  readonly payloadHash: Sha256Digest;
  readonly serialization: "JCS_RFC8785";
  readonly format: "JWS_DETACHED";
  readonly protectedHeader: EvidenceProtectedHeader;
  readonly signature: string;
  readonly signingPolicyRef: Readonly<{ id: string; version: number; contentHash: Sha256Digest }>;
  readonly publicKeyRef: Readonly<{ id: string; version: number; contentHash: Sha256Digest }>;
  readonly signedAt: string;
  readonly contentHash: Sha256Digest;
}

export interface QaEvidenceManifestRevisionV2 {
  readonly schemaVersion: "qa-evidence-manifest@2.0.0";
  readonly manifestRevisionId: string;
  readonly manifestId: string;
  readonly version: number;
  readonly kind: "INITIAL" | "SUBSTANTIVE_CORRECTION" | "CLERICAL";
  readonly previousRevisionRef?: Readonly<{
    id: string;
    version: number;
    contentHash: Sha256Digest;
  }>;
  readonly correctionReason?: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly targetSnapshot: Readonly<{
    schemaRef: unknown;
    value: JsonValue;
    contentHash: Sha256Digest;
  }>;
  readonly humanAttestation: Readonly<{ actor: unknown; attestedAt: string }>;
  readonly effectiveClassificationKey: string;
  readonly createdAt: string;
  readonly contentHash: Sha256Digest;
  readonly [key: string]: unknown;
}

export function evidenceIntegrityModeForSchema(schemaId: string): EvidenceIntegrityMode {
  return schemaId === "urn:awp:schemas:007:evidence-manifest:v2"
    ? "SIGNED_V2"
    : "LEGACY_INTEGRITY_ONLY";
}

export function canonicalEvidenceBytes(value: unknown): string {
  return canonicalize(value as JsonValue);
}

export function evidenceContentHash(value: unknown): Sha256Digest {
  return sha256(value as JsonValue);
}

export function assertEvidenceProtectedHeader(
  value: Readonly<{ alg: string; kid: string; typ: string }>,
): EvidenceProtectedHeader {
  if (value.alg !== "EdDSA") throw new QaDomainError("EVIDENCE_JWS_ALGORITHM_FORBIDDEN");
  if (!/^[A-Za-z0-9._-]+:[1-9][0-9]*$/u.test(value.kid))
    throw new QaDomainError("EVIDENCE_KEY_VERSION_REQUIRED");
  if (value.typ !== "application/awp-evidence+json")
    throw new QaDomainError("EVIDENCE_JWS_TYPE_INVALID");
  return Object.freeze({ alg: "EdDSA", kid: value.kid, typ: "application/awp-evidence+json" });
}

export function assertEvidenceCorrection(
  previous: QaEvidenceManifestRevisionV2 | undefined,
  next: QaEvidenceManifestRevisionV2,
): void {
  if (next.kind === "INITIAL") {
    if (
      previous ||
      next.version !== 1 ||
      next.previousRevisionRef !== undefined ||
      next.correctionReason !== undefined
    ) {
      throw new QaDomainError("EVIDENCE_INITIAL_LINEAGE_INVALID");
    }
    return;
  }
  if (
    !previous ||
    !next.previousRevisionRef ||
    !next.correctionReason ||
    next.version !== previous.version + 1 ||
    next.previousRevisionRef.id !== previous.manifestRevisionId ||
    next.previousRevisionRef.version !== previous.version ||
    next.previousRevisionRef.contentHash !== previous.contentHash ||
    next.workspaceId !== previous.workspaceId ||
    next.projectId !== previous.projectId ||
    next.workItemId !== previous.workItemId ||
    next.sessionId !== previous.sessionId ||
    next.manifestId !== previous.manifestId
  ) {
    throw new QaDomainError("EVIDENCE_CORRECTION_LINEAGE_INVALID");
  }
}
