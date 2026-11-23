import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

import {
  canonicalEvidenceBytes,
  evidenceContentHash,
  type EvidenceSignatureEnvelope,
  type QaEvidenceManifestRevisionV2,
} from "@awp/competency-qa";

export interface LocalEvidenceSigningKey {
  readonly kid: string;
  readonly version: number;
  readonly publicJwk: JsonWebKey;
  readonly privateJwk: JsonWebKey;
}

export class LocalEvidenceSigningKeyStore {
  readonly #keys = new Map<string, LocalEvidenceSigningKey>();
  readonly #revoked = new Set<string>();
  constructor(keys: readonly LocalEvidenceSigningKey[]) {
    for (const key of keys) {
      if (this.#keys.has(key.kid)) throw new Error("EVIDENCE_SIGNING_KEY_IMMUTABLE");
      this.#keys.set(key.kid, Object.freeze({ ...key }));
    }
  }
  current(): LocalEvidenceSigningKey {
    const key = [...this.#keys.values()]
      .filter(({ kid }) => !this.#revoked.has(kid))
      .sort((a, b) => b.version - a.version)[0];
    if (!key) throw new Error("EVIDENCE_SIGNING_KEY_UNAVAILABLE");
    return key;
  }
  resolve(kid: string): LocalEvidenceSigningKey | undefined {
    return this.#revoked.has(kid) ? undefined : this.#keys.get(kid);
  }
  revoke(kid: string): void {
    this.#revoked.add(kid);
  }
}

const encoded = (value: string | Uint8Array): string => Buffer.from(value).toString("base64url");

export class LocalEd25519EvidenceSigner {
  constructor(private readonly keys: LocalEvidenceSigningKeyStore) {}

  async signManifest(
    manifest: QaEvidenceManifestRevisionV2,
    signingPolicyId: string,
  ): Promise<EvidenceSignatureEnvelope> {
    const key = this.keys.current();
    const protectedHeader = Object.freeze({
      alg: "EdDSA" as const,
      kid: key.kid,
      typ: "application/awp-evidence+json" as const,
    });
    const { contentHash: _contentHash, ...payload } = manifest;
    void _contentHash;
    const canonicalPayload = canonicalEvidenceBytes(payload);
    const payloadHash = evidenceContentHash(payload);
    if (payloadHash !== manifest.contentHash) throw new Error("EVIDENCE_MANIFEST_HASH_MISMATCH");
    const signingInput = `${encoded(canonicalEvidenceBytes(protectedHeader))}.${encoded(canonicalPayload)}`;
    const signature = encoded(
      sign(
        null,
        Buffer.from(signingInput),
        createPrivateKey({ key: key.privateJwk, format: "jwk" }),
      ),
    );
    const publicKeyRef = Object.freeze({
      id: key.kid,
      version: key.version,
      contentHash: evidenceContentHash(key.publicJwk),
    });
    const signingPolicyRef = Object.freeze({
      id: signingPolicyId,
      version: 1,
      contentHash: evidenceContentHash({ signingPolicyId, algorithm: "Ed25519" }),
    });
    const body = {
      signatureId: `signature:${manifest.manifestRevisionId}:${key.kid}`,
      version: 1 as const,
      workspaceId: manifest.workspaceId,
      projectId: manifest.projectId,
      manifestRevisionRef: {
        id: manifest.manifestRevisionId,
        version: manifest.version,
        contentHash: manifest.contentHash,
      },
      payloadHash,
      serialization: "JCS_RFC8785" as const,
      format: "JWS_DETACHED" as const,
      protectedHeader,
      signature,
      signingPolicyRef,
      publicKeyRef,
      signedAt: manifest.createdAt,
    };
    return Object.freeze({ ...body, contentHash: evidenceContentHash(body) });
  }

  async verifyManifest(
    manifest: QaEvidenceManifestRevisionV2,
    envelope: EvidenceSignatureEnvelope,
  ): Promise<"VALID" | "INVALID" | "KEY_UNAVAILABLE"> {
    const key = this.keys.resolve(envelope.protectedHeader.kid);
    if (!key) return "KEY_UNAVAILABLE";
    if (
      envelope.protectedHeader.alg !== "EdDSA" ||
      envelope.format !== "JWS_DETACHED" ||
      envelope.serialization !== "JCS_RFC8785" ||
      envelope.manifestRevisionRef.id !== manifest.manifestRevisionId ||
      envelope.manifestRevisionRef.version !== manifest.version ||
      envelope.manifestRevisionRef.contentHash !== manifest.contentHash
    )
      return "INVALID";
    const { contentHash: _contentHash, ...payload } = manifest;
    void _contentHash;
    if (evidenceContentHash(payload) !== envelope.payloadHash) return "INVALID";
    const signingInput = `${encoded(canonicalEvidenceBytes(envelope.protectedHeader))}.${encoded(canonicalEvidenceBytes(payload))}`;
    try {
      return verify(
        null,
        Buffer.from(signingInput),
        createPublicKey({ key: key.publicJwk, format: "jwk" }),
        Buffer.from(envelope.signature, "base64url"),
      )
        ? "VALID"
        : "INVALID";
    } catch {
      return "INVALID";
    }
  }
}
