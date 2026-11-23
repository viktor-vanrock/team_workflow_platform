import { randomUUID } from "node:crypto";

import type { QaEvidenceManifestRevision } from "../domain/evidence-manifest.ts";
import { qaAggregateSnapshotHash, QaDomainError } from "../domain/primitives.ts";

interface ManifestAttempt {
  readonly attemptId: string;
  readonly planItemId: string;
  readonly attemptNo: number;
  readonly result:
    "PASS" | "ASSERTION_FAILED" | "INFRA_FAILED" | "TIMEOUT" | "CANCELLED" | "INCOMPLETE";
  readonly cancellationReason?: string;
  readonly actorId: string;
  readonly startedAt: string;
  readonly endedAt: string;
}
interface ManifestObservation {
  readonly observationId: string;
  readonly planItemId: string;
  readonly attemptId: string;
  readonly kind: "POSITIVE" | "NEGATIVE" | "AMBIGUOUS" | "INFORMATIONAL";
  readonly expectedOutcome: string;
  readonly actualOutcome: string;
}
interface ManifestResult {
  readonly resultRevisionId: string;
  readonly planItemId: string;
  readonly result: "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN" | "INCONCLUSIVE";
  readonly attemptIds: readonly string[];
  readonly observationIds: readonly string[];
  readonly evidenceLinkIds: readonly string[];
  readonly waiverRef?: Readonly<{ id: string; contentHash: string }>;
}
interface ManifestArtifact {
  readonly evidenceArtifactLinkId: string;
  readonly checksum: string;
  readonly mediaType?: string;
  readonly sizeBytes?: number;
  readonly dataClassificationKey?: string;
  readonly availabilityAtSigning?: "AVAILABLE";
}

export interface CleanEvidenceManifestInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly targetSnapshotHash: string;
  readonly scopeSnapshotHash: string;
  readonly resultRevisions: readonly ManifestResult[];
  readonly attempts: readonly ManifestAttempt[];
  readonly observations: readonly ManifestObservation[];
  readonly artifactLinks: readonly ManifestArtifact[];
  readonly sessionOutcome: "PASSED" | "FAILED" | "BLOCKED" | "INCONCLUSIVE";
  readonly outcomeSummary: string;
  readonly profileRefs: readonly Readonly<{ id: string; version: number }>[];
  readonly policyRefs: readonly Readonly<{ key: string; version: string }>[];
  readonly reviewerId: string;
  readonly reviewedAt: string;
  readonly frozenFindingReviews?: readonly Readonly<{
    id: string;
    version: number;
    contentHash: string;
    findingId: string;
    membershipIds: readonly string[];
    observationIds?: readonly string[];
    classification: string;
    dispositionDecision: string;
  }>[];
}

function canonicalPayload(
  input: CleanEvidenceManifestInput,
  outcomeSummary = input.outcomeSummary,
) {
  const attempts = [...input.attempts].sort(
    (a, b) => a.planItemId.localeCompare(b.planItemId) || a.attemptNo - b.attemptNo,
  );
  const observations = [...input.observations].sort((a, b) =>
    a.observationId.localeCompare(b.observationId),
  );
  const resultRevisions = [...input.resultRevisions].sort((a, b) =>
    a.planItemId.localeCompare(b.planItemId),
  );
  const artifactMembers = [...input.artifactLinks]
    .sort((a, b) => a.evidenceArtifactLinkId.localeCompare(b.evidenceArtifactLinkId))
    .map((value, index) => ({
      ...value,
      ordinal: index + 1,
      role: "MANIFEST_MEMBER" as const,
      availabilityAtSigning: value.availabilityAtSigning ?? ("AVAILABLE" as const),
    }));
  const frozenFindingReviews = Object.freeze(
    [...(input.frozenFindingReviews ?? [])].sort((a, b) => a.findingId.localeCompare(b.findingId)),
  );
  return Object.freeze({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workItemId: input.workItemId,
    sessionId: input.sessionId,
    targetSnapshotHash: input.targetSnapshotHash,
    scopeSnapshotHash: input.scopeSnapshotHash,
    resultRevisions,
    attempts,
    observations,
    artifactMembers,
    frozenFindingReviews,
    sessionOutcome: input.sessionOutcome,
    outcomeSummary,
    profileRefs: [...input.profileRefs].sort((a, b) => a.id.localeCompare(b.id)),
    policyRefs: [...input.policyRefs].sort((a, b) => a.key.localeCompare(b.key)),
    reviewerId: input.reviewerId,
    reviewedAt: input.reviewedAt,
  });
}

function validate(input: CleanEvidenceManifestInput): void {
  if (!input.outcomeSummary.trim()) throw new QaDomainError("QA_SESSION_REVIEW_SUMMARY_REQUIRED");
  if (input.sessionOutcome !== "PASSED" && !input.frozenFindingReviews?.length)
    throw new QaDomainError("FINDING_REQUIRED");
  const artifactIds = new Set(
    input.artifactLinks.map(({ evidenceArtifactLinkId }) => evidenceArtifactLinkId),
  );
  for (const attempt of input.attempts) {
    if ((attempt.result === "CANCELLED") !== (attempt.cancellationReason !== undefined))
      throw new QaDomainError("QA_ATTEMPT_CANCELLATION_REASON_INVALID");
  }
  for (const result of input.resultRevisions) {
    if (result.evidenceLinkIds.some((id) => !artifactIds.has(id)))
      throw new QaDomainError("QA_MANIFEST_EVIDENCE_MEMBERSHIP_INVALID");
    if (result.result === "PASS") {
      const passAttempts = new Set(
        input.attempts
          .filter(
            (attempt) => attempt.result === "PASS" && result.attemptIds.includes(attempt.attemptId),
          )
          .map(({ attemptId }) => attemptId),
      );
      const hasSource = input.observations.some(
        (observation) =>
          result.observationIds.includes(observation.observationId) &&
          observation.kind === "POSITIVE" &&
          passAttempts.has(observation.attemptId),
      );
      if (!hasSource) throw new QaDomainError("QA_MANIFEST_PASS_SOURCE_REQUIRED");
    }
    if (
      (result.result === "NOT_RUN") !== (result.waiverRef !== undefined) ||
      (result.result === "NOT_RUN" &&
        (result.attemptIds.length > 0 || result.observationIds.length > 0))
    )
      throw new QaDomainError("QA_MANIFEST_WAIVER_MEMBERSHIP_INVALID");
  }
}

export function buildCleanEvidenceManifest(
  input: CleanEvidenceManifestInput,
): QaEvidenceManifestRevision {
  validate(input);
  const payload = canonicalPayload(input);
  return Object.freeze({
    schemaVersion: 1 as const,
    manifestId: randomUUID(),
    manifestRevisionId: randomUUID(),
    version: 1,
    kind: "INITIAL" as const,
    ...payload,
    contentHash: qaAggregateSnapshotHash(payload as never),
  });
}

export function correctEvidenceManifest(
  previous: QaEvidenceManifestRevision,
  input: Readonly<{
    reason: string;
    outcomeSummary: string;
    reviewerId: string;
    reviewedAt: string;
  }>,
): QaEvidenceManifestRevision {
  if (!input.reason.trim() || input.reason.length > 2_000 || !input.outcomeSummary.trim())
    throw new QaDomainError("QA_MANIFEST_CORRECTION_INVALID");
  const payload = Object.freeze({
    workspaceId: previous.workspaceId,
    projectId: previous.projectId,
    workItemId: previous.workItemId,
    sessionId: previous.sessionId,
    targetSnapshotHash: previous.targetSnapshotHash,
    scopeSnapshotHash: previous.scopeSnapshotHash,
    resultRevisions: previous.resultRevisions,
    attempts: previous.attempts,
    observations: previous.observations,
    artifactMembers: previous.artifactMembers,
    frozenFindingReviews: previous.frozenFindingReviews,
    sessionOutcome: previous.sessionOutcome,
    outcomeSummary: input.outcomeSummary,
    profileRefs: previous.profileRefs,
    policyRefs: previous.policyRefs,
    reviewerId: input.reviewerId,
    reviewedAt: input.reviewedAt,
  });
  return Object.freeze({
    schemaVersion: 1 as const,
    manifestId: previous.manifestId,
    manifestRevisionId: randomUUID(),
    version: previous.version + 1,
    kind: "SUBSTANTIVE_CORRECTION" as const,
    previousRevisionRef: {
      id: previous.manifestRevisionId,
      version: previous.version,
      contentHash: previous.contentHash,
    },
    correctionReason: input.reason,
    ...payload,
    contentHash: qaAggregateSnapshotHash(payload as never),
  });
}
