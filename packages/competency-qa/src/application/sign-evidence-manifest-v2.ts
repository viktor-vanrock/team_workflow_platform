import {
  assertEvidenceProtectedHeader,
  canonicalEvidenceBytes,
  evidenceContentHash,
  type QaEvidenceManifestRevisionV2,
} from "../domain/evidence-manifest-v2.ts";
import type { EvidenceSigningUnitOfWork } from "../persistence/evidence-signing.uow.ts";
import type { EvidenceManifestSignerPort } from "./evidence-integrity-ports.ts";

export async function signEvidenceManifestV2(
  input: Readonly<{
    manifest: QaEvidenceManifestRevisionV2;
    expectedSessionVersion: number;
    signingPolicyRef: Readonly<{ id: string; version: number; contentHash: `sha256:${string}` }>;
    publicKeyKid: string;
    signer: EvidenceManifestSignerPort;
    unitOfWork: EvidenceSigningUnitOfWork;
    reauthorize: () => Promise<boolean>;
  }>,
): Promise<void> {
  const { contentHash: _, ...payload } = input.manifest;
  void _;
  const protectedHeader = assertEvidenceProtectedHeader({
    alg: "EdDSA",
    kid: input.publicKeyKid,
    typ: "application/awp-evidence+json",
  });
  const signed = await input.signer.sign({
    manifest: input.manifest,
    canonicalPayload: canonicalEvidenceBytes(payload),
    payloadHash: evidenceContentHash(payload),
    protectedHeader,
  });
  if (!(await input.reauthorize())) throw new Error("EVIDENCE_SIGNING_AUTHORIZATION_REVOKED");
  const body = {
    signatureId: `signature:${input.manifest.manifestRevisionId}`,
    version: 1 as const,
    workspaceId: input.manifest.workspaceId,
    projectId: input.manifest.projectId,
    manifestRevisionRef: {
      id: input.manifest.manifestRevisionId,
      version: input.manifest.version,
      contentHash: input.manifest.contentHash,
    },
    payloadHash: input.manifest.contentHash,
    serialization: "JCS_RFC8785" as const,
    format: "JWS_DETACHED" as const,
    protectedHeader,
    signature: signed.signature,
    signingPolicyRef: input.signingPolicyRef,
    publicKeyRef: signed.publicKeyRef,
    signedAt: input.manifest.createdAt,
  };
  await input.unitOfWork.commit(
    input.manifest,
    Object.freeze({ ...body, contentHash: evidenceContentHash(body) }),
    input.expectedSessionVersion,
  );
}
