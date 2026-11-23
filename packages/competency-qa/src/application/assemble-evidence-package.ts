import { evidenceContentHash } from "../domain/evidence-manifest-v2.ts";
import { QaDomainError } from "../domain/primitives.ts";

interface ExactRef {
  readonly id: string;
  readonly version: number;
  readonly contentHash: `sha256:${string}`;
}
export function assembleEvidencePackage(
  input: Readonly<{
    workspaceId: string;
    projectId: string;
    workItemId: string;
    manifestRefs: readonly ExactRef[];
    signatureRefs: readonly (ExactRef &
      Readonly<{ status: "VALID" | "INVALID" | "KEY_UNAVAILABLE" }>)[];
    qaVerdict: ExactRef & Readonly<{ actorKind: "HUMAN" | "SERVICE"; signed: boolean }>;
    createdBy: Readonly<{ kind: "HUMAN" | "SERVICE"; principalId: string }>;
    createdAt: string;
  }>,
) {
  if (!input.qaVerdict.signed || input.qaVerdict.actorKind !== "HUMAN")
    throw new QaDomainError("EVIDENCE_PACKAGE_VERDICT_REQUIRED");
  if (
    input.manifestRefs.length === 0 ||
    input.signatureRefs.length !== input.manifestRefs.length ||
    input.signatureRefs.some(({ status }) => status !== "VALID")
  ) {
    throw new QaDomainError("EVIDENCE_PACKAGE_SIGNATURES_INVALID");
  }
  const body = { packageId: `package:${input.workItemId}`, version: 1, ...structuredClone(input) };
  return Object.freeze({ ...body, contentHash: evidenceContentHash(body) });
}
