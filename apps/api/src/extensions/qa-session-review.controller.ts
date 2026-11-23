import { randomUUID } from "node:crypto";

import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Headers,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { DataSource, EntityManager } from "typeorm";

import {
  CorrectSessionReviewService,
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaRequestRepository,
  type QaTestSession,
  TypeOrmEvidenceReviewRepository,
  TypeOrmManualSessionRepository,
  TypeOrmReviewManualSessionService,
} from "@awp/competency-qa/node";
import { defaultClassificationCatalog } from "@awp/platform-core";
import { createDurableQaCompletionInvalidator } from "@awp/runtime-composition";

import {
  authorizeQaApi,
  QA_DATA_SOURCE,
  QaSessionGuard,
  type QaSessionRequest,
} from "./qa-api-authorization.ts";

type ResponseLike = Readonly<{ setHeader(name: string, value: string): void }>;
const etag = (version: number) => `W/"${version}"`;
const requireVersion = (value: string | undefined): number => {
  const match = /^W\/"([1-9][0-9]*)"$/u.exec(value ?? "");
  if (!match) throw new ConflictException("QA_IF_MATCH_REQUIRED");
  return Number(match[1]);
};

interface ReviewBody {
  readonly reviewKind: "INITIAL" | "SUBSTANTIVE_CORRECTION";
  readonly sessionOutcome: "PASSED" | "FAILED" | "BLOCKED" | "INCONCLUSIVE";
  readonly outcomeSummary: string;
  readonly expectedExecutionSetHash: QaContentHash;
  readonly expectedFlakyDispositionBases: readonly unknown[];
  readonly previousManifestRevisionRef?: Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
  readonly correctionReason?: string;
}

@Controller(
  "api/v1/workspaces/:workspaceId/projects/:projectId/work-items/:workItemId/qa/sessions/:sessionId",
)
@UseGuards(QaSessionGuard)
export class QaSessionReviewController {
  constructor(@Inject(QA_DATA_SOURCE) private readonly source: DataSource) {}

  @Post("evidence-manifests")
  async publish(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("sessionId") sessionId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: ReviewBody,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.session.review",
    );
    await this.#authorizeClassification(
      this.source,
      authorization.classificationCeiling,
      workspaceId,
      projectId,
      workItemId,
    );
    if (body.expectedFlakyDispositionBases.length > 0)
      throw new ConflictException("QA_FLAKY_REVIEW_UNAVAILABLE_UNTIL_US4");
    const extension = await new QaRequestRepository(this.source).byWorkItem(
      { workspaceId, projectId },
      workItemId,
    );
    if (!extension) throw new ConflictException("QA_REQUEST_NOT_FOUND");
    const authorizationBasisHash = qaAggregateSnapshotHash(authorization.basis as never);
    const at = new Date().toISOString();

    if (body.reviewKind === "INITIAL") {
      if (
        body.sessionOutcome !== "PASSED" ||
        body.previousManifestRevisionRef ||
        body.correctionReason
      )
        throw new ConflictException("QA_US3_CLEAN_PASS_REVIEW_REQUIRED");
      const result = await new TypeOrmReviewManualSessionService(this.source).reviewCleanPass({
        workspaceId,
        projectId,
        workItemId,
        sessionId,
        expectedSessionVersion: requireVersion(ifMatch),
        expectedExecutionSetHash: body.expectedExecutionSetHash,
        actor: authorization.actor,
        authorizationBasisHash,
        evidencePolicyRef: extension.evidencePolicyRef,
        riskReviewPolicyRef: extension.riskReviewPolicyRef,
        outcomeSummary: body.outcomeSummary,
        at,
      });
      response.setHeader("ETag", etag(result.manifestHeaderResourceVersion));
      response.setHeader("Location", `evidence-manifests/${result.manifestRevision.manifestId}`);
      return { ...result, session: this.#publicSession(result.session) };
    }

    if (!body.previousManifestRevisionRef || !body.correctionReason)
      throw new ConflictException("QA_MANIFEST_CORRECTION_PREDECESSOR_REQUIRED");
    const repository = new TypeOrmEvidenceReviewRepository(this.source);
    const header = await repository.manifestHeader({ workspaceId, projectId }, sessionId);
    const session = await new TypeOrmManualSessionRepository(this.source).get(
      { workspaceId, projectId },
      sessionId,
    );
    if (!header || !session || session.workItemId !== workItemId)
      throw new ConflictException("QA_SESSION_REVIEW_NOT_FOUND");
    const revisions = await repository.manifestRevisions(
      { workspaceId, projectId },
      header.manifestId,
    );
    const previous = revisions.at(-1);
    if (
      !previous ||
      previous.manifestRevisionId !== body.previousManifestRevisionRef.id ||
      previous.version !== body.previousManifestRevisionRef.version ||
      previous.contentHash !== body.previousManifestRevisionRef.contentHash
    )
      throw new ConflictException("QA_MANIFEST_CORRECTION_PREDECESSOR_STALE");
    if (body.sessionOutcome !== previous.sessionOutcome)
      throw new ConflictException("QA_MANIFEST_SUBSTANTIVE_OUTCOME_CHANGE_REQUIRES_NEW_SESSION");
    const result = await new CorrectSessionReviewService(this.source, (manager) => ({
      invalidatePending: async (context, currentWorkItemId, reason) => {
        const current = await authorizeQaApi(
          this.source,
          request,
          workspaceId,
          projectId,
          "qa.session.review",
        );
        await this.#authorizeClassification(
          manager,
          current.classificationCeiling,
          workspaceId,
          projectId,
          currentWorkItemId,
        );
        if (
          qaAggregateSnapshotHash(current.actor as never) !==
            qaAggregateSnapshotHash(authorization.actor as never) ||
          qaAggregateSnapshotHash(current.basis as never) !== authorizationBasisHash
        )
          throw new ForbiddenException("QA_SESSION_REVIEW_AUTHORITY_CHANGED");
        await createDurableQaCompletionInvalidator(manager).invalidatePending(
          context,
          currentWorkItemId,
          reason,
        );
      },
    })).correct({
      workspaceId,
      projectId,
      workItemId,
      sessionId,
      expectedManifestResourceVersion: requireVersion(ifMatch),
      expectedSessionResourceVersion: session.resourceVersion,
      reason: body.correctionReason,
      outcomeSummary: body.outcomeSummary,
      actor: authorization.actor,
      authorizationBasis: authorization.basis,
      authorizationBasisHash,
      evidencePolicyRef: extension.evidencePolicyRef,
      riskReviewPolicyRef: extension.riskReviewPolicyRef,
      at,
      correlationId: randomUUID(),
      causationId: randomUUID(),
    });
    response.setHeader("ETag", etag(result.manifestResourceVersion));
    return {
      session: this.#publicSession({
        ...session,
        resourceVersion: result.sessionResourceVersion,
        latestSessionReviewId: result.sessionReview.id,
        adjudicativeManifestRevisionId: result.manifestRevision.manifestRevisionId,
      }),
      sessionReview: result.sessionReview,
      manifestRevision: result.manifestRevision,
      manifestHeaderResourceVersion: result.manifestResourceVersion,
    };
  }

  #publicSession(session: QaTestSession) {
    return { ...session, schemaVersion: 1 as const, sessionId: session.id };
  }

  async #authorizeClassification(
    source: DataSource | EntityManager,
    ceiling: string,
    workspaceId: string,
    projectId: string,
    workItemId: string,
  ) {
    const [work] = (await source.query(
      "SELECT classification_key FROM work_items WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR SHARE",
      [workspaceId, projectId, workItemId],
    )) as { classification_key: string }[];
    if (!work) throw new ConflictException("QA_REQUEST_NOT_FOUND");
    if (
      !defaultClassificationCatalog.permits(
        defaultClassificationCatalog.reference(ceiling),
        defaultClassificationCatalog.reference(work.classification_key),
      )
    )
      throw new ForbiddenException("QA_SESSION_REVIEW_CLASSIFICATION_DENIED");
  }
}
