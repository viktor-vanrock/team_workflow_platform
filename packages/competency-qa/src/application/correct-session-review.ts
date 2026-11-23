import { randomUUID } from "node:crypto";

import type { DataSource, EntityManager } from "typeorm";

import {
  type QaAuthorizationBasis,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
} from "../domain/primitives.ts";
import { createQaSessionReview } from "../domain/session-review.ts";
import { TypeOrmEvidenceReviewRepository } from "../persistence/evidence-review.repository.ts";
import { SessionReviewUnitOfWork } from "../persistence/session-review.uow.ts";
import { correctEvidenceManifest } from "./evidence-manifest-builder.ts";
import { createQaTypeOrmCompletionInvalidator } from "./invalidate-completion-candidate.ts";
import type { QaAdjudicativeMutationInvalidator } from "./qa-adjudicative-mutation-invalidator.ts";

export class CorrectSessionReviewService {
  constructor(
    private readonly source: DataSource,
    private readonly invalidators: (
      manager: EntityManager,
    ) => QaAdjudicativeMutationInvalidator = createQaTypeOrmCompletionInvalidator,
  ) {}
  async correct(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      workItemId: string;
      sessionId: string;
      expectedManifestResourceVersion: number;
      expectedSessionResourceVersion: number;
      reason: string;
      outcomeSummary: string;
      actor: QaHumanActor;
      authorizationBasis: QaAuthorizationBasis;
      authorizationBasisHash: QaContentHash;
      evidencePolicyRef: unknown;
      riskReviewPolicyRef: unknown;
      at: string;
      correlationId: string;
      causationId: string;
    }>,
  ) {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `qa-request:${input.workspaceId}:${input.projectId}:${input.workItemId}`,
      ]);
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `qa-session:${input.workspaceId}:${input.projectId}:${input.sessionId}`,
      ]);
      const repository = new TypeOrmEvidenceReviewRepository(manager);
      const header = await repository.manifestHeader(
        { workspaceId: input.workspaceId, projectId: input.projectId },
        input.sessionId,
      );
      if (!header || header.resourceVersion !== input.expectedManifestResourceVersion)
        throw new QaDomainError("QA_MANIFEST_STALE_VERSION");
      const revisions = await repository.manifestRevisions(
        { workspaceId: input.workspaceId, projectId: input.projectId },
        header.manifestId,
      );
      const reviews = await repository.sessionReviews(
        { workspaceId: input.workspaceId, projectId: input.projectId },
        input.sessionId,
      );
      const previousManifest = revisions.at(-1);
      const previousReview = reviews.at(-1);
      if (!previousManifest || !previousReview)
        throw new QaDomainError("QA_SESSION_REVIEW_NOT_FOUND");
      const manifest = correctEvidenceManifest(previousManifest, {
        reason: input.reason,
        outcomeSummary: input.outcomeSummary,
        reviewerId: input.actor.principalId,
        reviewedAt: input.at,
      });
      const review = createQaSessionReview({
        id: randomUUID(),
        version: previousReview.version + 1,
        supersedesSessionReviewRef: {
          id: previousReview.id,
          version: previousReview.version,
          contentHash: previousReview.contentHash,
        },
        supersessionReason: input.reason,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        workItemId: input.workItemId,
        sessionId: input.sessionId,
        sessionOutcome: previousReview.sessionOutcome,
        outcomeSummary: input.outcomeSummary,
        adjudicativeManifestRevisionRef: {
          id: manifest.manifestRevisionId,
          version: manifest.version,
          contentHash: manifest.contentHash,
        },
        executionSetHash: previousReview.executionSetHash,
        resultSetHash: previousReview.resultSetHash,
        frozenFindingSetHash: previousReview.frozenFindingSetHash,
        flakyDispositionConfirmations: previousReview.flakyDispositionConfirmations,
        reviewer: input.actor,
        authorizationBasisHash: input.authorizationBasisHash,
        reviewedAt: input.at,
      });
      await this.invalidators(manager).invalidatePending(
        {
          actor: input.actor,
          scope: { kind: "PROJECT", workspaceId: input.workspaceId, projectId: input.projectId },
          correlationId: input.correlationId,
          causationId: input.causationId,
          authorizationBasis: input.authorizationBasis,
        },
        input.workItemId,
        "AGGREGATE_CHANGED",
      );
      const persisted = await new SessionReviewUnitOfWork(manager).persistCorrection({
        manifest,
        review,
        evidencePolicyRef: input.evidencePolicyRef,
        riskReviewPolicyRef: input.riskReviewPolicyRef,
        expectedManifestResourceVersion: input.expectedManifestResourceVersion,
        expectedSessionResourceVersion: input.expectedSessionResourceVersion,
      });
      return Object.freeze({ manifestRevision: manifest, sessionReview: review, ...persisted });
    });
  }
}
