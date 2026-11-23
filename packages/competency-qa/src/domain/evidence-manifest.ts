import type { QaContentHash } from "./primitives.ts";

export interface QaEvidenceManifestRevision {
  readonly schemaVersion: 1;
  readonly manifestId: string;
  readonly manifestRevisionId: string;
  readonly version: number;
  readonly kind: "INITIAL" | "SUBSTANTIVE_CORRECTION" | "CLERICAL";
  readonly previousRevisionRef?: Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
  readonly correctionReason?: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly targetSnapshotHash: string;
  readonly scopeSnapshotHash: string;
  readonly resultRevisions: readonly unknown[];
  readonly attempts: readonly unknown[];
  readonly observations: readonly unknown[];
  readonly artifactMembers: readonly unknown[];
  readonly frozenFindingReviews: readonly unknown[];
  readonly sessionOutcome: "PASSED" | "FAILED" | "BLOCKED" | "INCONCLUSIVE";
  readonly outcomeSummary: string;
  readonly profileRefs: readonly Readonly<{ id: string; version: number }>[];
  readonly policyRefs: readonly Readonly<{ key: string; version: string }>[];
  readonly reviewerId: string;
  readonly reviewedAt: string;
  readonly contentHash: QaContentHash;
}

export interface QaEvidenceManifestHeader {
  readonly manifestId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly resourceVersion: number;
  readonly latestRevisionRef: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
  readonly latestAdjudicativeRevisionRef: Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
}
