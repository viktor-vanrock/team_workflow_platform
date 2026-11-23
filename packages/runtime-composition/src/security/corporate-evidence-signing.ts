import { createPublicKey, randomUUID, verify as verifySignature } from "node:crypto";

import {
  assertEvidenceProtectedHeader,
  canonicalEvidenceBytes,
  evidenceContentHash,
  type EvidenceManifestSignerPort,
  type EvidenceSignatureEnvelope,
  type QaEvidenceManifestRevisionV2,
} from "@awp/competency-qa";
import {
  assertExactRevisionRef,
  type ExactRevisionRef,
  freezePilotValue,
  type ProjectScope,
} from "@awp/platform-core";

import { evidenceJwsInput, FilePublicKeyHistory } from "./public-key-history.ts";
import { VaultHttpClient, vaultObject } from "./vault-http-client.ts";

export { FilePublicKeyHistory } from "./public-key-history.ts";

export interface CorporateSigningConfiguration extends ProjectScope {
  readonly servicePrincipalId: string;
  readonly mount: string;
  readonly keyName: string;
  readonly keyVersion: number;
  readonly kid: string;
  readonly publicKeyRef: ExactRevisionRef;
  readonly signingPolicyRef: ExactRevisionRef;
}
export class CorporateEvidenceSigner implements EvidenceManifestSignerPort {
  readonly #configuration: CorporateSigningConfiguration;
  constructor(
    private readonly client: VaultHttpClient,
    private readonly history: FilePublicKeyHistory,
    configuration: CorporateSigningConfiguration,
    private readonly authorize: (
      manifest: QaEvidenceManifestRevisionV2,
      configuration: CorporateSigningConfiguration,
      signal: AbortSignal,
    ) => Promise<boolean>,
  ) {
    this.#configuration = freezePilotValue(structuredClone(configuration));
    assertExactRevisionRef(configuration.publicKeyRef);
    assertExactRevisionRef(configuration.signingPolicyRef);
    assertEvidenceProtectedHeader({
      alg: "EdDSA",
      typ: "application/awp-evidence+json",
      kid: configuration.kid,
    });
    if (
      !configuration.workspaceId ||
      !configuration.projectId ||
      !configuration.servicePrincipalId ||
      !/^[a-zA-Z0-9_-]+$/u.test(configuration.mount) ||
      !/^[a-zA-Z0-9_-]+$/u.test(configuration.keyName) ||
      !Number.isSafeInteger(configuration.keyVersion) ||
      configuration.keyVersion < 1 ||
      configuration.publicKeyRef.id !== configuration.kid ||
      configuration.publicKeyRef.version !== configuration.keyVersion ||
      !configuration.kid.endsWith(`:${configuration.keyVersion}`)
    )
      throw new Error("EVIDENCE_SIGNER_CONFIGURATION_INVALID");
  }
  async sign(
    input: Parameters<EvidenceManifestSignerPort["sign"]>[0],
    signal = new AbortController().signal,
  ): ReturnType<EvidenceManifestSignerPort["sign"]> {
    const pinned = freezePilotValue(structuredClone(input));
    const configuration = this.#configuration;
    if (
      pinned.manifest.workspaceId !== configuration.workspaceId ||
      pinned.manifest.projectId !== configuration.projectId
    )
      throw new Error("EVIDENCE_SIGNING_SCOPE_DENIED");
    const { contentHash, ...payload } = pinned.manifest;
    if (
      evidenceContentHash(payload) !== contentHash ||
      pinned.payloadHash !== contentHash ||
      pinned.canonicalPayload !== canonicalEvidenceBytes(payload)
    )
      throw new Error("EVIDENCE_MANIFEST_HASH_MISMATCH");
    assertEvidenceProtectedHeader(pinned.protectedHeader);
    if (pinned.protectedHeader.kid !== configuration.kid)
      throw new Error("EVIDENCE_SIGNER_VERSION_CONFLICT");
    const key = await this.history.resolve(configuration.publicKeyRef);
    if (!key) throw new Error("EVIDENCE_PUBLIC_KEY_UNAVAILABLE");
    await this.assertAuthorized(pinned.manifest, signal);
    const signingInput = evidenceJwsInput(pinned.protectedHeader, pinned.canonicalPayload);
    const result = await this.client.request(
      {
        workspaceId: configuration.workspaceId,
        projectId: configuration.projectId,
        servicePrincipalId: configuration.servicePrincipalId,
        purpose: "EVIDENCE_SIGNING",
        allowedUseHash: evidenceContentHash(configuration),
      },
      "POST",
      `/v1/${configuration.mount}/sign/${configuration.keyName}`,
      {
        input: signingInput.toString("base64"),
        key_version: configuration.keyVersion,
        prehashed: false,
      },
      signal,
    );
    const data = vaultObject(vaultObject(result.value).data);
    const match =
      typeof data.signature === "string"
        ? data.signature.match(/^vault:v([1-9][0-9]*):([A-Za-z0-9+/]+={0,2})$/u)
        : undefined;
    if (!match || Number(match[1]) !== configuration.keyVersion)
      throw new Error("EVIDENCE_SIGNER_VERSION_CONFLICT");
    const signature = Buffer.from(match[2]!, "base64");
    if (
      signature.length !== 64 ||
      signature.toString("base64") !== match[2] ||
      !verifySignature(
        null,
        signingInput,
        createPublicKey({ key: key.publicKey, format: "jwk" }),
        signature,
      )
    )
      throw new Error("EVIDENCE_REMOTE_SIGNATURE_INVALID");
    await this.assertAuthorized(pinned.manifest, signal);
    if (!(await this.history.resolve(configuration.publicKeyRef)))
      throw new Error("EVIDENCE_PUBLIC_KEY_UNAVAILABLE");
    return freezePilotValue({
      signature: signature.toString("base64url"),
      publicKeyRef: { ...configuration.publicKeyRef },
    });
  }
  private async assertAuthorized(
    manifest: QaEvidenceManifestRevisionV2,
    signal: AbortSignal,
  ): Promise<void> {
    let allowed = false;
    try {
      allowed = !signal.aborted && (await this.authorize(manifest, this.#configuration, signal));
    } catch {
      /* Safe denial only. */
    }
    if (!allowed || signal.aborted) throw new Error("EVIDENCE_SIGNING_AUTHORIZATION_DENIED");
  }
  async signManifest(
    manifest: QaEvidenceManifestRevisionV2,
    signal = new AbortController().signal,
  ): Promise<EvidenceSignatureEnvelope> {
    manifest = freezePilotValue(structuredClone(manifest));
    const { contentHash, ...payload } = manifest;
    const protectedHeader = assertEvidenceProtectedHeader({
      alg: "EdDSA",
      kid: this.#configuration.kid,
      typ: "application/awp-evidence+json",
    });
    const signed = await this.sign(
      {
        manifest,
        canonicalPayload: canonicalEvidenceBytes(payload),
        payloadHash: contentHash,
        protectedHeader,
      },
      signal,
    );
    const body = {
      schemaVersion: 1 as const,
      signatureId: randomUUID(),
      version: 1 as const,
      workspaceId: manifest.workspaceId,
      projectId: manifest.projectId,
      manifestRevisionRef: {
        id: manifest.manifestRevisionId,
        version: manifest.version,
        contentHash,
      },
      payloadHash: contentHash,
      serialization: "JCS_RFC8785" as const,
      format: "JWS_DETACHED" as const,
      protectedHeader,
      signature: signed.signature,
      signingPolicyRef: this.#configuration.signingPolicyRef,
      publicKeyRef: signed.publicKeyRef,
      signedAt: new Date().toISOString(),
    };
    return freezePilotValue({ ...body, contentHash: evidenceContentHash(body) });
  }
  async verify(
    manifest: QaEvidenceManifestRevisionV2,
    envelope: EvidenceSignatureEnvelope,
  ): Promise<"VALID" | "INVALID" | "KEY_UNAVAILABLE"> {
    return await this.history.verify(manifest, envelope);
  }
}
