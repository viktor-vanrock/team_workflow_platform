import { randomUUID } from "node:crypto";

import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { DataSource } from "typeorm";

import {
  type QaExactReference,
  QaPostCloseCorrectionStore,
  recordPostCloseCorrection,
  TypeOrmEvidenceReviewRepository,
  TypeOrmQaPostCloseCorrectionRepository,
} from "@awp/competency-qa/node";

import {
  authorizeQaApi,
  QA_DATA_SOURCE,
  QaSessionGuard,
  type QaSessionRequest,
} from "./qa-api-authorization.ts";

type ResponseLike = Readonly<{ setHeader(name: string, value: string): void }>;
const etag = (value: number) => `W/"${value}"`;
const rows = (value: unknown): readonly Record<string, unknown>[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Record<string, unknown>[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const requireVersion = (value: string | undefined): number => {
  const match = /^W\/"([1-9][0-9]*)"$/u.exec(value ?? "");
  if (!match) throw new ConflictException("QA_IF_MATCH_REQUIRED");
  return Number(match[1]);
};

@Controller(
  "api/v1/workspaces/:workspaceId/projects/:projectId/work-items/:workItemId/qa/sessions/:sessionId",
)
@UseGuards(QaSessionGuard)
export class QaEvidenceController {
  constructor(@Inject(QA_DATA_SOURCE) private readonly source: DataSource) {}

  @Get("evidence-links") async list(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.evidence.read");
    return (
      await new TypeOrmEvidenceReviewRepository(this.source).listEvidence(
        { workspaceId, projectId },
        sessionId,
      )
    ).map((value) => this.#publicEvidence(value));
  }
  @Get("evidence-links/:evidenceLinkId") async get(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("evidenceLinkId") evidenceLinkId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.evidence.read");
    const value = await new TypeOrmEvidenceReviewRepository(this.source).evidence(
      { workspaceId, projectId },
      evidenceLinkId,
    );
    if (!value) throw new Error("QA_EVIDENCE_NOT_FOUND");
    return this.#publicEvidence(value);
  }
  @Get("evidence-manifests") async manifests(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.evidence.read");
    const repository = new TypeOrmEvidenceReviewRepository(this.source);
    const header = await repository.manifestHeader({ workspaceId, projectId }, sessionId);
    if (!header) return [];
    const revisions = await repository.manifestRevisions(
      { workspaceId, projectId },
      header.manifestId,
    );
    const latest = revisions.find(
      ({ manifestRevisionId }) => manifestRevisionId === header.latestRevisionId,
    )!;
    const adjudicative = revisions.find(
      ({ manifestRevisionId }) => manifestRevisionId === header.latestAdjudicativeRevisionId,
    )!;
    const markers = rows(
      await this.source.query(
        "SELECT * FROM qa_post_close_correction_markers WHERE workspace_id=$1 AND project_id=$2 AND manifest_id=$3 ORDER BY recorded_at,marker_id",
        [workspaceId, projectId, header.manifestId],
      ),
    );
    response.setHeader("ETag", etag(header.resourceVersion));
    return [
      {
        schemaVersion: 1,
        workspaceId,
        projectId,
        workItemId: revisions[0]!.workItemId,
        sessionId,
        manifestId: header.manifestId,
        resourceVersion: header.resourceVersion,
        latestRevisionRef: {
          id: header.latestRevisionId,
          version: latest.version,
          contentHash: latest.contentHash,
        },
        latestAdjudicativeRevisionRef: {
          id: header.latestAdjudicativeRevisionId,
          version: adjudicative.version,
          contentHash: adjudicative.contentHash,
        },
        revisions,
        postCloseCorrectionMarkers: markers,
      },
    ];
  }
  @Get("evidence-manifests/:manifestId") async history(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("sessionId") sessionId: string,
    @Param("manifestId") manifestId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const values = await this.manifests(request, workspaceId, projectId, sessionId, response);
    const value = values.find((entry) => entry.manifestId === manifestId);
    if (!value) throw new Error("QA_MANIFEST_NOT_FOUND");
    return value;
  }
  @Get("evidence-manifests/:manifestId/revisions/:manifestRevision") async revision(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("manifestId") manifestId: string,
    @Param("manifestRevision") manifestRevision: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.evidence.read");
    const values = await new TypeOrmEvidenceReviewRepository(this.source).manifestRevisions(
      { workspaceId, projectId },
      manifestId,
    );
    const value = values.find(({ version }) => version === Number(manifestRevision));
    if (!value) throw new Error("QA_MANIFEST_REVISION_NOT_FOUND");
    return value;
  }

  @Post("evidence-manifests/:manifestId/post-close-corrections")
  async postCloseCorrection(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("sessionId") sessionId: string,
    @Param("manifestId") manifestId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: Readonly<{ expectedPreviousRef: QaExactReference; note: string; reason: string }>,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.evidence.post-close-correction.record",
    );
    const current = rows(
      await this.source.query(
        "SELECT m.*,r.manifest,r.signature,r.evidence_policy_ref,ar.manifest AS adjudicative_manifest FROM qa_evidence_manifests m JOIN qa_evidence_manifest_revisions r ON r.manifest_revision_id=m.latest_revision_id JOIN qa_evidence_manifest_revisions ar ON ar.manifest_revision_id=m.latest_adjudicative_revision_id WHERE m.workspace_id=$1 AND m.project_id=$2 AND m.work_item_id=$3 AND m.session_id=$4 AND m.manifest_id=$5",
        [workspaceId, projectId, workItemId, sessionId, manifestId],
      ),
    )[0];
    if (!current) throw new ConflictException("QA_MANIFEST_NOT_FOUND");
    const done = rows(
      await this.source.query(
        "SELECT confirmation_id FROM qa_final_close_confirmations WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3",
        [workspaceId, projectId, workItemId],
      ),
    )[0];
    if (!done) throw new ConflictException("QA_WORK_ITEM_NOT_DONE");
    const latestManifest = json<Record<string, unknown>>(current.manifest);
    const priorArtifactRefs = Array.isArray(latestManifest.artifactMembers)
      ? latestManifest.artifactMembers.map((value) =>
          String(
            (value as Record<string, unknown>).evidenceArtifactLinkId ??
              (value as Record<string, unknown>).id ??
              "",
          ),
        )
      : [];
    const adjudicativeManifest = json<Record<string, unknown>>(current.adjudicative_manifest);
    const store = new QaPostCloseCorrectionStore({
      manifestId,
      latestRevisionRef: {
        id: String(current.latest_revision_id),
        version: (latestManifest as { version?: number }).version ?? 1,
        contentHash: String(
          (latestManifest as { contentHash?: string }).contentHash,
        ) as `sha256:${string}`,
      },
      latestAdjudicativeRevisionRef: {
        id: String(current.latest_adjudicative_revision_id),
        version: (adjudicativeManifest as { version?: number }).version ?? 1,
        contentHash: String(
          (adjudicativeManifest as { contentHash?: string }).contentHash,
        ) as `sha256:${string}`,
      },
      resourceVersion: Number(current.resource_version),
      content: {
        ...latestManifest,
        note: String(latestManifest.note ?? latestManifest.outcomeSummary ?? ""),
        artifactRefs: priorArtifactRefs,
      },
    });
    const context = {
      actor: authorization.actor,
      scope: { kind: "PROJECT" as const, workspaceId, projectId },
      correlationId: randomUUID(),
      causationId: randomUUID(),
      authorizationBasis: authorization.basis,
    };
    try {
      const result = await recordPostCloseCorrection({
        store,
        context,
        workItemId,
        manifestId,
        ifMatch: requireVersion(ifMatch),
        expectedPreviousRef: body.expectedPreviousRef,
        patch: { note: body.note },
        annotations: [{ field: "note", reason: body.reason }],
        markerId: randomUUID(),
        revisionId: randomUUID(),
        at: new Date().toISOString(),
      });
      const content = {
        ...latestManifest,
        ...result.manifest.content,
        manifestRevisionId: result.marker.clericalRevisionRef.id,
        version: result.marker.clericalRevisionRef.version,
        kind: "CLERICAL",
        previousRevisionRef: result.marker.previousRevisionRef,
        correctionReason: body.reason,
        contentHash: result.marker.clericalRevisionRef.contentHash,
      };
      await new TypeOrmQaPostCloseCorrectionRepository(this.source).append({
        marker: result.marker,
        scope: { workspaceId, projectId },
        workItemId,
        sessionId,
        expectedManifestResourceVersion: requireVersion(ifMatch),
        revision: {
          manifestId,
          content,
          signature: json(current.signature),
          evidencePolicyRef: json(current.evidence_policy_ref),
        },
      });
      response.setHeader("ETag", etag(result.manifest.resourceVersion));
      response.setHeader(
        "Location",
        `evidence-manifests/${manifestId}/revisions/${result.marker.clericalRevisionRef.version}`,
      );
      return {
        manifestId,
        resourceVersion: result.manifest.resourceVersion,
        latestRevisionRef: result.marker.clericalRevisionRef,
        latestAdjudicativeRevisionRef: result.manifest.latestAdjudicativeRevisionRef,
        marker: result.marker,
      };
    } catch (error) {
      throw new ConflictException(error instanceof Error ? error.message : String(error));
    }
  }

  #publicEvidence(
    value: Awaited<ReturnType<TypeOrmEvidenceReviewRepository["evidence"]>> extends infer T
      ? NonNullable<T>
      : never,
  ) {
    return {
      schemaVersion: 1,
      evidenceArtifactLinkId: value.evidenceArtifactLinkId,
      workspaceId: value.workspaceId,
      projectId: value.projectId,
      workItemId: value.workItemId,
      sessionId: value.sessionId,
      owner: value.owner,
      artifactRef: {
        artifactId: value.artifactReferenceId,
        checksum: value.checksum,
        mediaType: value.mediaType,
        sizeBytes: value.sizeBytes,
        dataClassificationKey: value.dataClassificationKey,
      },
      availability: value.availability,
      availabilityAtSigning: value.availabilityAtSigning,
      attachedBy: value.attachedBy,
      finalizedAt: value.finalizedAt,
    };
  }
}
