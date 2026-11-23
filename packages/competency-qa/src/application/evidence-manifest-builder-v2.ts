import {
  assertEvidenceCorrection,
  evidenceContentHash,
  type QaEvidenceManifestRevisionV2,
} from "../domain/evidence-manifest-v2.ts";
import { QaDomainError } from "../domain/primitives.ts";
import type { QaTargetSnapshotV2 } from "../domain/snapshots-v2.ts";

export interface BuildEvidenceManifestV2Input {
  readonly manifestRevisionId: string;
  readonly manifestId: string;
  readonly version: number;
  readonly kind: "INITIAL" | "SUBSTANTIVE_CORRECTION" | "CLERICAL";
  readonly previousRevisionRef?: Readonly<{
    id: string;
    version: number;
    contentHash: `sha256:${string}`;
  }>;
  readonly correctionReason?: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly targetSnapshot: QaTargetSnapshotV2;
  readonly planItems: readonly Readonly<Record<string, unknown>>[];
  readonly attempts: readonly Readonly<Record<string, unknown>>[];
  readonly findings: readonly Readonly<Record<string, unknown>>[];
  readonly artifacts: readonly Readonly<{
    artifactId: string;
    checksum: string;
    classificationKey: string;
    classificationRank: number;
    availability: string;
  }>[];
  readonly provenance: readonly Readonly<Record<string, unknown>>[];
  readonly humanAttestation: Readonly<{
    actor: Readonly<{ kind: string; principalId: string }>;
    attestedAt: string;
  }>;
  readonly createdAt: string;
}

export function buildEvidenceManifestV2(
  input: BuildEvidenceManifestV2Input,
  previous?: QaEvidenceManifestRevisionV2,
): QaEvidenceManifestRevisionV2 {
  if (
    input.humanAttestation.actor.kind !== "HUMAN" ||
    !input.humanAttestation.actor.principalId ||
    Number.isNaN(Date.parse(input.humanAttestation.attestedAt))
  ) {
    throw new QaDomainError("EVIDENCE_HUMAN_ATTESTATION_REQUIRED");
  }
  if (
    input.targetSnapshot.workspaceId !== input.workspaceId ||
    input.targetSnapshot.projectId !== input.projectId ||
    input.targetSnapshot.workItemId !== input.workItemId ||
    input.targetSnapshot.sessionId !== input.sessionId
  ) {
    throw new QaDomainError("EVIDENCE_TARGET_SCOPE_MISMATCH");
  }
  if (input.planItems.length === 0 || input.attempts.length === 0 || input.provenance.length === 0)
    throw new QaDomainError("EVIDENCE_MANIFEST_INCOMPLETE");
  const maximum = [...input.artifacts].sort(
    (left, right) => right.classificationRank - left.classificationRank,
  )[0];
  const body = {
    schemaVersion: "qa-evidence-manifest@2.0.0" as const,
    manifestRevisionId: input.manifestRevisionId,
    manifestId: input.manifestId,
    version: input.version,
    kind: input.kind,
    ...(input.previousRevisionRef ? { previousRevisionRef: input.previousRevisionRef } : {}),
    ...(input.correctionReason ? { correctionReason: input.correctionReason } : {}),
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workItemId: input.workItemId,
    sessionId: input.sessionId,
    targetSnapshot: structuredClone(input.targetSnapshot),
    planItems: Object.freeze([...input.planItems]),
    attempts: Object.freeze([...input.attempts]),
    findings: Object.freeze([...input.findings]),
    artifacts: Object.freeze(
      [...input.artifacts].sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
    ),
    provenance: Object.freeze([...input.provenance]),
    humanAttestation: structuredClone(input.humanAttestation),
    effectiveClassificationKey: maximum?.classificationKey ?? "INTERNAL",
    createdAt: input.createdAt,
  };
  const manifest = Object.freeze({
    ...body,
    contentHash: evidenceContentHash(body),
  }) as unknown as QaEvidenceManifestRevisionV2;
  assertEvidenceCorrection(previous, manifest);
  return manifest;
}
