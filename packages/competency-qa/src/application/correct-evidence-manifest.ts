import type { QaEvidenceManifestRevisionV2 } from "../domain/evidence-manifest-v2.ts";
import { QaDomainError } from "../domain/primitives.ts";
import { buildEvidenceManifestV2 } from "./evidence-manifest-builder-v2.ts";

export function correctEvidenceManifestV2(
  previous: QaEvidenceManifestRevisionV2,
  input: Readonly<{
    manifestRevisionId: string;
    kind: "SUBSTANTIVE_CORRECTION" | "CLERICAL";
    reason: string;
    createdAt: string;
    humanAttestation: QaEvidenceManifestRevisionV2["humanAttestation"];
  }>,
): QaEvidenceManifestRevisionV2 {
  if (!input.reason.trim()) throw new QaDomainError("EVIDENCE_CORRECTION_REASON_REQUIRED");
  const source = previous as QaEvidenceManifestRevisionV2 & Readonly<Record<string, unknown>>;
  return buildEvidenceManifestV2(
    {
      manifestRevisionId: input.manifestRevisionId,
      manifestId: previous.manifestId,
      version: previous.version + 1,
      kind: input.kind,
      previousRevisionRef: {
        id: previous.manifestRevisionId,
        version: previous.version,
        contentHash: previous.contentHash,
      },
      correctionReason: input.reason,
      workspaceId: previous.workspaceId,
      projectId: previous.projectId,
      workItemId: previous.workItemId,
      sessionId: previous.sessionId,
      targetSnapshot: source.targetSnapshot as never,
      planItems: source.planItems as readonly Readonly<Record<string, unknown>>[],
      attempts: source.attempts as readonly Readonly<Record<string, unknown>>[],
      findings: source.findings as readonly Readonly<Record<string, unknown>>[],
      artifacts: source.artifacts as never,
      provenance: source.provenance as readonly Readonly<Record<string, unknown>>[],
      humanAttestation: input.humanAttestation as never,
      createdAt: input.createdAt,
    },
    previous,
  );
}
