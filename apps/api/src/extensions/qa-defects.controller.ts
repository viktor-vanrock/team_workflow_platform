import { randomUUID } from "node:crypto";

import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { DataSource } from "typeorm";

import {
  qaAggregateSnapshotHash,
  QaDefectProposalRepository,
  QaDomainError,
  type QaStoredDefectProposal,
  TypeOrmCreateDefectDraftService,
} from "@awp/competency-qa/node";
import { defaultClassificationCatalog } from "@awp/platform-core";
import type { QaDefectApprovalRuntime, QaDefectPublicationRuntime } from "@awp/runtime-composition";

import {
  authorizeQaApi,
  QA_DATA_SOURCE,
  QaSessionGuard,
  type QaSessionRequest,
} from "./qa-api-authorization.ts";

export const QA_DEFECT_APPROVAL_RUNTIME = Symbol("QA_DEFECT_APPROVAL_RUNTIME");
export const QA_DEFECT_PUBLICATION_RUNTIME = Symbol("QA_DEFECT_PUBLICATION_RUNTIME");

type Row = Readonly<Record<string, unknown>>;
type ResponseLike = Readonly<{ setHeader(name: string, value: string): void }>;
const etag = (version: number) => `W/"${version}"`;
const rows = (value: unknown): readonly Row[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Row[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const requireVersion = (value: string | undefined): number => {
  const match = /^W\/"([1-9][0-9]*)"$/u.exec(value ?? "");
  if (!match) throw new ConflictException("QA_IF_MATCH_REQUIRED");
  const version = Number(match[1]);
  if (!Number.isSafeInteger(version)) throw new ConflictException("QA_IF_MATCH_REQUIRED");
  return version;
};
const conflict = (error: unknown): never => {
  if (error instanceof QaDomainError) throw new ConflictException(error.message);
  throw error;
};

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/work-items/:workItemId/qa")
@UseGuards(QaSessionGuard)
export class QaDefectsController {
  constructor(
    @Inject(QA_DATA_SOURCE) private readonly source: DataSource,
    @Inject(QA_DEFECT_PUBLICATION_RUNTIME) private readonly publication: QaDefectPublicationRuntime,
    @Inject(QA_DEFECT_APPROVAL_RUNTIME) private readonly approvals: QaDefectApprovalRuntime,
  ) {}

  @Post("findings/:findingId/defect-draft-proposals")
  async propose(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("findingId") findingId: string,
    @Body()
    body: Readonly<{
      frozenFindingReviewRef: Readonly<{ id: string; version: number; contentHash: string }>;
    }>,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.defect.draft");
    return this.source.transaction("READ COMMITTED", async (manager) => {
      const found = rows(
        await manager.query(
          "SELECT f.finding_id,r.*,w.classification_key FROM qa_findings f JOIN qa_finding_review_revisions r ON r.finding_review_revision_id=f.frozen_review_revision_id JOIN work_items w ON w.id=f.work_item_id AND w.workspace_id=f.workspace_id AND w.project_id=f.project_id WHERE f.workspace_id=$1 AND f.project_id=$2 AND f.work_item_id=$3 AND f.finding_id=$4 FOR UPDATE OF f",
          [workspaceId, projectId, workItemId, findingId],
        ),
      )[0];
      if (!found) throw new NotFoundException("QA_FROZEN_FINDING_NOT_FOUND");
      if (
        found.stage !== "FROZEN" ||
        found.classification !== "PRODUCT" ||
        found.disposition_decision !== "CREATE_DEFECT" ||
        found.finding_review_revision_id !== body.frozenFindingReviewRef.id ||
        Number(found.version) !== body.frozenFindingReviewRef.version ||
        found.content_hash !== body.frozenFindingReviewRef.contentHash
      )
        throw new ConflictException("QA_FROZEN_FINDING_REF_MISMATCH");
      const generatedAt = new Date().toISOString();
      const proposalId = randomUUID();
      const authorization = await authorizeQaApi(
        this.source,
        request,
        workspaceId,
        projectId,
        "qa.defect.draft",
      );
      this.#assertClassification(authorization, String(found.classification_key));
      const bodyWithoutHash = {
        proposalId,
        workspaceId,
        projectId,
        workItemId,
        findingId,
        frozenFindingReviewRef: body.frozenFindingReviewRef,
        source: "DETERMINISTIC_FALLBACK",
        dataClassificationKey: String(found.classification_key),
        fallbackReasonCode: "MODEL_UNSET",
        title: `[QA] ${String(found.summary)}`,
        description: `${String(found.classification_reason)}\n\nDisposition: ${String(found.disposition_reason)}`,
        stepsToReproduce: json<readonly string[]>(found.observation_membership_ids).map(
          (id, index) => `${index + 1}. Reproduce observation membership ${id}`,
        ),
        expectedOutcome: "The validated acceptance outcome is satisfied.",
        actualOutcome: String(found.summary),
        promptTemplateRef: { key: "qa.defect-wording", version: "1.0.0" },
        generatedAt,
        expiresAt: new Date(Date.parse(generatedAt) + 15 * 60_000).toISOString(),
      };
      const proposal = Object.freeze({
        ...bodyWithoutHash,
        proposalHash: qaAggregateSnapshotHash(bodyWithoutHash as never),
      }) as QaStoredDefectProposal;
      await new QaDefectProposalRepository(manager).insert(proposal, {
        sessionId: String(found.session_id),
        classificationKey: String(found.classification_key),
        createdBy: authorization.actor.principalId,
        authorizationBasisHash: qaAggregateSnapshotHash(authorization.basis as never),
      });
      response.setHeader("Location", `defect-draft-proposals/${proposalId}`);
      return proposal;
    });
  }

  @Get("findings/:findingId/defect-draft-proposals/:proposalId")
  async proposal(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("findingId") findingId: string,
    @Param("proposalId") proposalId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read");
    const proposal = await new QaDefectProposalRepository(this.source).get(
      { workspaceId, projectId },
      workItemId,
      findingId,
      proposalId,
    );
    if (!proposal) throw new NotFoundException("QA_DEFECT_PROPOSAL_NOT_FOUND");
    const classification = rows(
      await this.source.query(
        "SELECT classification_key FROM work_items WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        [workspaceId, projectId, workItemId],
      ),
    )[0];
    if (!classification) throw new NotFoundException("QA_DEFECT_PROPOSAL_NOT_FOUND");
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "work-item.read",
    );
    this.#assertClassification(authorization, String(proposal.dataClassificationKey));
    this.#assertClassification(authorization, String(classification.classification_key));
    return proposal;
  }

  @Get("findings/:findingId/defect-drafts")
  async drafts(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("findingId") findingId: string,
  ) {
    await this.#authorizeWorkRead(request, workspaceId, projectId, workItemId);
    const found = rows(
      await this.source.query(
        "SELECT * FROM qa_defect_drafts WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND finding_id=$4 ORDER BY version",
        [workspaceId, projectId, workItemId, findingId],
      ),
    );
    return found.map((row) => this.#publicDraft(row));
  }

  @Post("findings/:findingId/defect-drafts")
  async create(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("findingId") findingId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body()
    body: Readonly<{
      source: "DETERMINISTIC_TEMPLATE" | "MODEL_PROPOSAL" | "DETERMINISTIC_FALLBACK";
      acceptedProposalRef?: Readonly<{ id: string; contentHash: string }>;
    }>,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.defect.draft");
    try {
      const draft = await this.source.transaction("SERIALIZABLE", async (manager) => {
        const finding = rows(
          await manager.query(
            "SELECT f.resource_version,w.classification_key FROM qa_findings f JOIN work_items w ON w.workspace_id=f.workspace_id AND w.project_id=f.project_id AND w.id=f.work_item_id WHERE f.workspace_id=$1 AND f.project_id=$2 AND f.work_item_id=$3 AND f.finding_id=$4 FOR UPDATE OF f,w",
            [workspaceId, projectId, workItemId, findingId],
          ),
        )[0];
        if (!finding) throw new QaDomainError("QA_FINDING_NOT_FOUND");
        if (Number(finding.resource_version) !== requireVersion(ifMatch))
          throw new QaDomainError("QA_FINDING_CAS_CONFLICT");
        let acceptedProposal: QaStoredDefectProposal | undefined;
        if (body.source !== "DETERMINISTIC_TEMPLATE") {
          acceptedProposal = body.acceptedProposalRef
            ? await new QaDefectProposalRepository(manager).get(
                { workspaceId, projectId },
                workItemId,
                findingId,
                body.acceptedProposalRef.id,
              )
            : undefined;
          if (
            !acceptedProposal ||
            acceptedProposal.proposalHash !== body.acceptedProposalRef?.contentHash ||
            acceptedProposal.findingId !== findingId ||
            Date.parse(acceptedProposal.expiresAt) <= Date.now()
          )
            throw new QaDomainError("QA_DEFECT_PROPOSAL_STALE_OR_MISMATCHED");
          if (acceptedProposal.source !== body.source)
            throw new QaDomainError("QA_DEFECT_PROPOSAL_SOURCE_MISMATCH");
        } else if (body.acceptedProposalRef)
          throw new QaDomainError("QA_DEFECT_PROPOSAL_REF_FORBIDDEN");
        const currentAuthorization = await authorizeQaApi(
          this.source,
          request,
          workspaceId,
          projectId,
          "qa.defect.draft",
        );
        this.#assertClassification(currentAuthorization, String(finding.classification_key));
        if (acceptedProposal)
          this.#assertClassification(
            currentAuthorization,
            String(acceptedProposal.dataClassificationKey),
          );
        return await new TypeOrmCreateDefectDraftService(manager).create({
          workspaceId,
          projectId,
          workItemId,
          findingId,
          source: body.source,
          ...(acceptedProposal ? { acceptedProposal } : {}),
          actor: currentAuthorization.actor,
          at: new Date().toISOString(),
        });
      });
      response.setHeader("ETag", etag(draft.resourceVersion));
      response.setHeader("Location", `../../defect-drafts/${draft.defectDraftId}`);
      return draft;
    } catch (error) {
      return conflict(error);
    }
  }

  @Post("defect-drafts/:defectDraftId/rejection")
  async reject(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("defectDraftId") defectDraftId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: Readonly<{ expectedContentHash: string; reason: string }>,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.defect.draft",
    );
    try {
      const draft = await this.source.transaction(
        "SERIALIZABLE",
        async (manager) =>
          await new TypeOrmCreateDefectDraftService(manager).reject({
            workspaceId,
            projectId,
            workItemId,
            defectDraftId,
            expectedResourceVersion: requireVersion(ifMatch),
            expectedContentHash: body.expectedContentHash,
            reason: body.reason,
            actor: authorization.actor,
            at: new Date().toISOString(),
          }),
      );
      response.setHeader("ETag", etag(Number(draft.resourceVersion)));
      response.setHeader("Location", `../${defectDraftId}`);
      return draft;
    } catch (error) {
      return conflict(error);
    }
  }

  @Post("defect-drafts/:defectDraftId/publication")
  @HttpCode(202)
  async publish(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("defectDraftId") defectDraftId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: Readonly<{ expectedResourceVersion: number }>,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const expected = requireVersion(ifMatch);
    if (body.expectedResourceVersion !== expected)
      throw new ConflictException("QA_DEFECT_DRAFT_VERSION_MISMATCH");
    try {
      const result = await this.publication.publish(
        {
          workspaceId,
          projectId,
          authorize: (permission) =>
            authorizeQaApi(this.source, request, workspaceId, projectId, permission),
        },
        workItemId,
        defectDraftId,
        expected,
      );
      response.setHeader("ETag", etag(result.resourceVersion));
      response.setHeader(
        "Location",
        `/api/v1/workspaces/${workspaceId}/projects/${projectId}/work-items/${workItemId}/qa/defect-approvals/${result.approvalId}`,
      );
      return result;
    } catch (error) {
      return conflict(error);
    }
  }

  @Get("defect-links")
  async links(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
  ) {
    await this.#authorizeWorkRead(request, workspaceId, projectId, workItemId);
    return rows(
      await this.source.query(
        "SELECT * FROM qa_defect_links WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY linked_at,defect_link_id",
        [workspaceId, projectId, workItemId],
      ),
    ).map((row) => this.#publicLink(row));
  }

  @Post("defect-approvals/:approvalId/approve")
  async approve(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("approvalId") approvalId: string,
  ) {
    return this.approvals.approve(
      {
        workspaceId,
        projectId,
        authorize: (permission) =>
          authorizeQaApi(this.source, request, workspaceId, projectId, permission),
      },
      workItemId,
      approvalId,
    );
  }

  @Get("defect-links/:defectLinkId")
  async link(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("defectLinkId") defectLinkId: string,
  ) {
    await this.#authorizeWorkRead(request, workspaceId, projectId, workItemId);
    const link = rows(
      await this.source.query(
        "SELECT * FROM qa_defect_links WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND defect_link_id=$4",
        [workspaceId, projectId, workItemId, defectLinkId],
      ),
    )[0];
    if (!link) throw new NotFoundException("QA_DEFECT_LINK_NOT_FOUND");
    return this.#publicLink(link);
  }

  #assertClassification(
    authorization: Awaited<ReturnType<typeof authorizeQaApi>>,
    key: string,
  ): void {
    try {
      if (
        !defaultClassificationCatalog.permits(
          defaultClassificationCatalog.reference(authorization.classificationCeiling),
          defaultClassificationCatalog.reference(key),
        )
      )
        throw new Error();
    } catch {
      throw new ForbiddenException("QA_DEFECT_PROPOSAL_CLASSIFICATION_DENIED");
    }
  }

  async #authorizeWorkRead(
    request: QaSessionRequest,
    workspaceId: string,
    projectId: string,
    workItemId: string,
  ): Promise<void> {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read");
    const [work] = rows(
      await this.source.query(
        "SELECT classification_key FROM work_items WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        [workspaceId, projectId, workItemId],
      ),
    );
    if (!work) throw new NotFoundException("QA_WORK_ITEM_NOT_FOUND");
    this.#assertClassification(
      await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read"),
      String(work.classification_key),
    );
  }

  #publicDraft(row: Row): Row {
    return Object.freeze({
      ...row,
      defectDraftId: String(row.defect_draft_id),
      findingId: String(row.finding_id),
      state: String(row.state),
      version: Number(row.version),
      resourceVersion: Number(row.resource_version),
      contentHash: String(row.content_hash),
      payload: json(row.payload),
      provenance: json(row.provenance),
      ...(row.approval_ref ? { approvalRef: json(row.approval_ref) } : {}),
    });
  }
  #publicLink(row: Row): Row {
    return Object.freeze({
      ...row,
      defectLinkId: String(row.defect_link_id),
      findingId: String(row.finding_id),
      defectDraftId: String(row.defect_draft_id),
      contentHash: String(row.content_hash),
      normalizedStatus: String(row.normalized_status),
      externalEntityId: String(row.external_entity_id),
      externalDisplayKey: String(row.external_display_key),
      externalVersion: String(row.external_version),
      rawExternalState: String(row.raw_external_state),
    });
  }
}
