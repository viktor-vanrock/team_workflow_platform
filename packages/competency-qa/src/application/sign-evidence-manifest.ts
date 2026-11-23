import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
} from "../domain/primitives.ts";

export interface QaEvidenceManifestSignature {
  readonly signer: QaHumanActor;
  readonly contentHash: QaContentHash;
  readonly authorizationBasisHash: QaContentHash;
  readonly policyRef: Readonly<{ key: string; version: string }>;
  readonly signedAt: string;
  readonly signatureHash: QaContentHash;
}

export function signEvidenceManifest(
  input: Omit<QaEvidenceManifestSignature, "signatureHash">,
): QaEvidenceManifestSignature {
  if (input.signer.kind !== "HUMAN" || !input.contentHash.startsWith("sha256:"))
    throw new QaDomainError("QA_MANIFEST_HUMAN_SIGNATURE_REQUIRED");
  return Object.freeze({
    ...structuredClone(input),
    signatureHash: qaAggregateSnapshotHash(input as never),
  });
}

export { signEvidenceManifestV2 } from "./sign-evidence-manifest-v2.ts";
