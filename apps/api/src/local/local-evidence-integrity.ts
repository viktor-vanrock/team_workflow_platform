import { createHash, createPrivateKey, createPublicKey, randomUUID } from "node:crypto";
import { resolve } from "node:path";

import type { DataSource } from "typeorm";

import { evidenceContentHash } from "@awp/competency-qa";
import {
  FilePublicKeyHistory,
  LocalEd25519EvidenceSigner,
  LocalEvidenceSigningKeyStore,
} from "@awp/runtime-composition";

import {
  DurableEvidenceHttpApplication,
  type EvidenceCrypto,
} from "../extensions/onboarding/evidence.application.ts";

export const localEvidencePolicies = Object.freeze({
  redactionPolicyRef: {
    id: "local-evidence-metadata-json",
    version: 1,
    contentHash: evidenceContentHash({ algorithm: "OPAQUE_PACKAGE_REFS_ONLY", version: 1 }),
  },
  exportPolicyRef: {
    id: "local-evidence-export",
    version: 1,
    contentHash: evidenceContentHash({ format: "JSON", stepUpMaximumAgeSeconds: 300, version: 1 }),
  },
});
/** Publicly reproducible development key; non-local hosts must inject their Vault signer. */
export function createLocalEvidenceCrypto(
  directory = resolve(".local/evidence-public-keys"),
): (scope: Readonly<{ workspaceId: string; projectId: string }>) => EvidenceCrypto {
  if (!["local", "test"].includes(process.env.AWP_RUNTIME_PROFILE ?? ""))
    throw new Error("LOCAL_EVIDENCE_CRYPTO_FORBIDDEN");
  const seed = createHash("sha256")
    .update("awp-development-evidence-key-never-use-outside-local-v1")
    .digest();
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicJwk = createPublicKey(privateKey).export({ format: "jwk" }),
    kid = "local-ed25519:1";
  if (
    (process.env.AWP_EVIDENCE_SIGNER !== undefined &&
      process.env.AWP_EVIDENCE_SIGNER !== "local-ed25519") ||
    (process.env.AWP_EVIDENCE_SIGNER_KID !== undefined &&
      process.env.AWP_EVIDENCE_SIGNER_KID !== kid) ||
    process.env.AWP_EVIDENCE_SIGNER_PRIVATE_MATERIAL === "false"
  )
    throw new Error("LOCAL_EVIDENCE_SIGNER_CONFIGURATION_UNSUPPORTED");
  const signer = new LocalEd25519EvidenceSigner(
    new LocalEvidenceSigningKeyStore([
      { kid, version: 1, publicJwk, privateJwk: privateKey.export({ format: "jwk" }) },
    ]),
  );
  return (scope) => {
    const history = new FilePublicKeyHistory(directory, scope);
    history.publish(kid, 1, publicJwk);
    return {
      ...localEvidencePolicies,
      verify: (manifest, envelope) => history.verify(manifest, envelope),
      signManifest: async (manifest) => {
        const signed = await signer.signManifest(manifest, "local-evidence-signing");
        const { contentHash: _hash, ...body } = signed;
        void _hash;
        const envelope = { ...body, schemaVersion: 1, signatureId: randomUUID() };
        return { ...envelope, contentHash: evidenceContentHash(envelope) };
      },
    };
  };
}
export function createLocalEvidenceIntegrity(source: DataSource) {
  return new DurableEvidenceHttpApplication(source, createLocalEvidenceCrypto());
}
