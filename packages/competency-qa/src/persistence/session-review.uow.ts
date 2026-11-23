import { randomUUID } from "node:crypto";

import type { QaEvidenceManifestRevision } from "../domain/evidence-manifest.ts";
import type {
  EvidenceSignatureEnvelope,
  QaEvidenceManifestRevisionV2,
} from "../domain/evidence-manifest-v2.ts";
import { qaAggregateSnapshotHash, QaDomainError } from "../domain/primitives.ts";
import type { QaSessionReview } from "../domain/session-review.ts";
import type { QaTestSession } from "../domain/test-session.ts";
import { EvidenceSigningUnitOfWork } from "./evidence-signing.uow.ts";
import { ManualExecutionUnitOfWork } from "./manual-execution.uow.ts";
import type { QaQueryExecutor } from "./repository-helpers.ts";

const dbRows = <T>(value: unknown): readonly T[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly T[];
};

export class SessionReviewUnitOfWork {
  constructor(private readonly source: QaQueryExecutor) {}
  async persistManualSignedV2(
    manifest: QaEvidenceManifestRevisionV2,
    signature: EvidenceSignatureEnvelope,
    expectedSessionVersion: number,
  ): Promise<void> {
    await new EvidenceSigningUnitOfWork(this.source).commit(
      manifest,
      signature,
      expectedSessionVersion,
    );
  }
  async persistInitial(
    input: Readonly<{
      previousSession: QaTestSession;
      completedSession: QaTestSession;
      manifest: QaEvidenceManifestRevision;
      review: QaSessionReview;
      evidencePolicyRef: unknown;
      riskReviewPolicyRef: unknown;
      frozenFindingReviewRefs?: readonly Readonly<{
        id: string;
        version: number;
        contentHash: string;
      }>[];
    }>,
  ): Promise<Readonly<{ manifestResourceVersion: number }>> {
    const manifest = input.manifest;
    const review = input.review;
    await this.source.query(
      "INSERT INTO qa_evidence_manifests(manifest_id,workspace_id,project_id,work_item_id,session_id,latest_revision_id,latest_adjudicative_revision_id,revision_count,resource_version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6,1,1,$7,$7)",
      [
        manifest.manifestId,
        manifest.workspaceId,
        manifest.projectId,
        manifest.workItemId,
        manifest.sessionId,
        manifest.manifestRevisionId,
        manifest.reviewedAt,
      ],
    );
    await this.#insertManifestRevision(manifest, input.evidencePolicyRef, review);
    await this.#insertReview(
      review,
      input.riskReviewPolicyRef,
      input.frozenFindingReviewRefs ?? [],
    );
    await new ManualExecutionUnitOfWork(this.source).persistTransition(
      input.previousSession,
      input.completedSession,
    );
    return Object.freeze({ manifestResourceVersion: 1 });
  }
  async persistCorrection(
    input: Readonly<{
      manifest: QaEvidenceManifestRevision;
      review: QaSessionReview;
      evidencePolicyRef: unknown;
      riskReviewPolicyRef: unknown;
      expectedManifestResourceVersion: number;
      expectedSessionResourceVersion: number;
    }>,
  ): Promise<Readonly<{ manifestResourceVersion: number; sessionResourceVersion: number }>> {
    await this.#insertManifestRevision(input.manifest, input.evidencePolicyRef, input.review);
    const frozenFindingReviewRefs =
      (input.manifest.frozenFindingReviews as readonly Readonly<{
        id: string;
        version: number;
        contentHash: string;
      }>[]) ?? [];
    await this.#insertReview(input.review, input.riskReviewPolicyRef, frozenFindingReviewRefs);
    const header = dbRows<Readonly<{ resource_version: number | string }>>(
      await this.source.query(
        "UPDATE qa_evidence_manifests SET latest_revision_id=$1,latest_adjudicative_revision_id=$1,revision_count=$2,resource_version=resource_version+1,updated_at=$3 WHERE manifest_id=$4 AND workspace_id=$5 AND project_id=$6 AND resource_version=$7 RETURNING resource_version",
        [
          input.manifest.manifestRevisionId,
          input.manifest.version,
          input.manifest.reviewedAt,
          input.manifest.manifestId,
          input.manifest.workspaceId,
          input.manifest.projectId,
          input.expectedManifestResourceVersion,
        ],
      ),
    );
    if (!header[0]) throw new QaDomainError("QA_MANIFEST_STALE_VERSION");
    const session = dbRows<Readonly<{ resource_version: number | string }>>(
      await this.source.query(
        "UPDATE qa_test_sessions SET latest_session_review_id=$1,adjudicative_manifest_revision_id=$2,session_outcome=$3,resource_version=resource_version+1,content=content||jsonb_build_object('latestSessionReviewId',$1::text,'adjudicativeManifestRevisionId',$2::text,'sessionOutcome',$3::text,'resourceVersion',resource_version+1) WHERE session_id=$4 AND workspace_id=$5 AND project_id=$6 AND state='COMPLETED' AND resource_version=$7 RETURNING resource_version",
        [
          input.review.id,
          input.manifest.manifestRevisionId,
          input.review.sessionOutcome,
          input.review.sessionId,
          input.review.workspaceId,
          input.review.projectId,
          input.expectedSessionResourceVersion,
        ],
      ),
    );
    if (!session[0]) throw new QaDomainError("QA_SESSION_STALE_VERSION");
    return Object.freeze({
      manifestResourceVersion: Number(header[0].resource_version),
      sessionResourceVersion: Number(session[0].resource_version),
    });
  }
  async #insertManifestRevision(
    manifest: QaEvidenceManifestRevision,
    evidencePolicyRef: unknown,
    review: QaSessionReview,
  ): Promise<void> {
    await this.source.query(
      `INSERT INTO qa_evidence_manifest_revisions(manifest_revision_id,manifest_id,workspace_id,project_id,work_item_id,session_id,version,kind,previous_revision_id,previous_version,previous_content_hash,correction_reason,manifest,content_hash,signature,evidence_policy_ref,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        manifest.manifestRevisionId,
        manifest.manifestId,
        manifest.workspaceId,
        manifest.projectId,
        manifest.workItemId,
        manifest.sessionId,
        manifest.version,
        manifest.kind,
        manifest.previousRevisionRef?.id ?? null,
        manifest.previousRevisionRef?.version ?? null,
        manifest.previousRevisionRef?.contentHash ?? null,
        manifest.correctionReason ?? null,
        JSON.stringify(manifest),
        manifest.contentHash,
        JSON.stringify({
          signer: review.reviewer,
          authorizationBasisHash: review.authorizationBasisHash,
          signedAt: review.reviewedAt,
          contentHash: manifest.contentHash,
        }),
        JSON.stringify(evidencePolicyRef),
        manifest.reviewedAt,
      ],
    );
    for (const [index, raw] of manifest.artifactMembers.entries()) {
      const member = raw as Record<string, unknown>;
      const rows = (await this.source.query(
        "SELECT checksum,size_bytes,media_type,classification_key FROM qa_evidence_artifact_links WHERE workspace_id=$1 AND project_id=$2 AND session_id=$3 AND evidence_link_id=$4",
        [
          manifest.workspaceId,
          manifest.projectId,
          manifest.sessionId,
          member.evidenceArtifactLinkId,
        ],
      )) as readonly Record<string, unknown>[];
      if (!rows[0]) throw new QaDomainError("QA_MANIFEST_EVIDENCE_MEMBERSHIP_INVALID");
      await this.source.query(
        "INSERT INTO qa_evidence_manifest_artifact_memberships(membership_id,workspace_id,project_id,work_item_id,session_id,manifest_revision_id,evidence_link_id,ordinal,role,checksum,size_bytes,media_type,classification_key,availability_at_signing) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'MANIFEST_MEMBER',$9,$10,$11,$12,'AVAILABLE')",
        [
          randomUUID(),
          manifest.workspaceId,
          manifest.projectId,
          manifest.workItemId,
          manifest.sessionId,
          manifest.manifestRevisionId,
          member.evidenceArtifactLinkId,
          index + 1,
          rows[0].checksum,
          rows[0].size_bytes,
          rows[0].media_type,
          rows[0].classification_key,
        ],
      );
    }
  }
  async #insertReview(
    review: QaSessionReview,
    riskReviewPolicyRef: unknown,
    frozenFindingReviewRefs: readonly Readonly<{
      id: string;
      version: number;
      contentHash: string;
    }>[] = [],
  ): Promise<void> {
    const previous = (
      review as QaSessionReview & {
        supersedesSessionReviewRef?: { id: string; version: number; contentHash: string };
        supersessionReason?: string;
      }
    ).supersedesSessionReviewRef;
    const reason = (review as QaSessionReview & { supersessionReason?: string }).supersessionReason;
    await this.source.query(
      `INSERT INTO qa_session_reviews(session_review_id,workspace_id,project_id,work_item_id,session_id,version,supersedes_review_id,supersedes_version,supersedes_content_hash,supersession_reason,session_outcome,outcome_summary,manifest_revision_id,manifest_content_hash,execution_set_hash,result_set_hash,frozen_finding_set_hash,flaky_disposition_confirmations,reviewer,authorization_basis_hash,risk_review_policy_ref,reviewed_at,content_hash,content) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [
        review.id,
        review.workspaceId,
        review.projectId,
        review.workItemId,
        review.sessionId,
        review.version,
        previous?.id ?? null,
        previous?.version ?? null,
        previous?.contentHash ?? null,
        reason ?? null,
        review.sessionOutcome,
        review.outcomeSummary,
        review.adjudicativeManifestRevisionRef.id,
        review.adjudicativeManifestRevisionRef.contentHash,
        review.executionSetHash,
        review.resultSetHash,
        review.frozenFindingSetHash,
        JSON.stringify(review.flakyDispositionConfirmations),
        JSON.stringify(review.reviewer),
        review.authorizationBasisHash,
        JSON.stringify(riskReviewPolicyRef),
        review.reviewedAt,
        review.contentHash,
        JSON.stringify(review),
      ],
    );
    const eventPayload = Object.freeze({
      workItemId: review.workItemId,
      sessionId: review.sessionId,
      sessionReviewRef: { id: review.id, version: review.version, contentHash: review.contentHash },
      manifestRevisionRef: review.adjudicativeManifestRevisionRef,
      sessionOutcome: review.sessionOutcome,
      frozenFindingReviewRefs: Object.freeze([...frozenFindingReviewRefs]),
    });
    await this.source.query(
      "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,'qa.test-session.reviewed',$4,$5,'READY',$6)",
      [
        randomUUID(),
        review.workspaceId,
        review.projectId,
        JSON.stringify(eventPayload),
        qaAggregateSnapshotHash(eventPayload as never),
        review.reviewedAt,
      ],
    );
    await this.source.query(
      "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,$4,$5,'qa.session.review','SUCCEEDED',$6,$7,$8,$9,'INTERNAL',$10)",
      [
        randomUUID(),
        review.workspaceId,
        review.projectId,
        review.reviewedAt,
        JSON.stringify(review.reviewer),
        previous ? "SUBSTANTIVE_CORRECTION" : "INITIAL_REVIEW",
        randomUUID(),
        randomUUID(),
        JSON.stringify({ authorizationBasisHash: review.authorizationBasisHash }),
        JSON.stringify({
          values: {
            sessionId: review.sessionId,
            sessionReviewId: review.id,
            manifestRevisionId: review.adjudicativeManifestRevisionRef.id,
            sessionOutcome: review.sessionOutcome,
          },
          versionRefs: [],
        }),
      ],
    );
  }
}
