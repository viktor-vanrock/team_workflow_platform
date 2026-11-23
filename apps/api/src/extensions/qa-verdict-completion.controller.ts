import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { DataSource } from "typeorm";

import { type QaExactReference } from "@awp/competency-qa/node";
import { defaultClassificationCatalog } from "@awp/platform-core";
import {
  type QaCompletionApprovalRuntime,
  type QaCompletionRuntime,
  type QaDodAssessmentRequest,
  type QaDodRuntime,
  type QaVerdictDraftRequest,
  type QaVerdictRuntime,
} from "@awp/runtime-composition";

import {
  authorizeQaApi,
  QA_DATA_SOURCE,
  QaSessionGuard,
  type QaSessionRequest,
} from "./qa-api-authorization.ts";

type Row = Record<string, unknown>;
type ResponseLike = Readonly<{ setHeader(name: string, value: string): void }>;
const etag = (version: number) => `W/"${version}"`;
export const QA_VERDICT_RUNTIME = Symbol("QA_VERDICT_RUNTIME");
export const QA_DOD_RUNTIME = Symbol("QA_DOD_RUNTIME");
export const QA_COMPLETION_RUNTIME = Symbol("QA_COMPLETION_RUNTIME");
export const QA_COMPLETION_APPROVAL_RUNTIME = Symbol("QA_COMPLETION_APPROVAL_RUNTIME");
const rows = (value: unknown): readonly Row[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Row[];
};
const expectedVersion = (value: string | undefined): number => {
  const match = /^W\/"([1-9][0-9]*)"$/u.exec(value ?? "");
  if (!match || !Number.isSafeInteger(Number(match[1])))
    throw new ConflictException("QA_IF_MATCH_REQUIRED");
  return Number(match[1]);
};
const fail = (error: unknown): never => {
  if (error instanceof HttpException) throw error;
  throw new ConflictException(
    error instanceof Error && /^QA_[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : "QA_VERDICT_COMPLETION_FAILED",
  );
};

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/work-items/:workItemId/qa")
@UseGuards(QaSessionGuard)
export class QaVerdictCompletionController {
  constructor(
    @Inject(QA_DATA_SOURCE) private readonly source: DataSource,
    @Inject(QA_DOD_RUNTIME) private readonly dod: QaDodRuntime,
    @Inject(QA_COMPLETION_RUNTIME) private readonly completion: QaCompletionRuntime,
    @Inject(QA_COMPLETION_APPROVAL_RUNTIME)
    private readonly completionApproval: QaCompletionApprovalRuntime,
    @Inject(QA_VERDICT_RUNTIME) private readonly verdict: QaVerdictRuntime,
  ) {}

  @Get("verdict-completion")
  async detail(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
  ) {
    await this.#authorizeWorkRead(request, workspaceId, projectId, workItemId);
    const query = async (table: string, order: string) =>
      rows(
        await this.source.query(
          `SELECT * FROM ${table} WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY ${order}`,
          [workspaceId, projectId, workItemId],
        ),
      );
    const [
      verdicts,
      verdictSignatures,
      dodAssessments,
      completionCandidates,
      finalCloseConfirmations,
      postCloseCorrectionMarkers,
      cosignRequests,
      extensions,
    ] = await Promise.all([
      query("qa_verdicts", "version,verdict_id"),
      query("qa_verdict_signatures", "signed_at,signature_id"),
      query("qa_dod_assessments", "version,assessment_id"),
      query("qa_completion_candidates", "candidate_number,candidate_id"),
      query("qa_final_close_confirmations", "confirmed_at,confirmation_id"),
      query("qa_post_close_correction_markers", "recorded_at,marker_id"),
      this.source.query(
        "SELECT p.id AS \"actionId\",a.id AS \"approvalId\",p.candidate_ref->'candidate'->'subject'->'verdictRef'->>'id' AS \"verdictId\",a.expires_at AS \"expiresAt\",p.state FROM platform_actions p JOIN approvals a ON a.workspace_id=p.workspace_id AND a.project_id=p.project_id AND a.action_id=p.id WHERE p.workspace_id=$1 AND p.project_id=$2 AND p.action_kind='qa.verdict.cosign' AND p.candidate_ref->'candidate'->'subject'->>'workItemId'=$3 AND p.state='PENDING_APPROVAL' AND a.decision_state='PENDING' AND a.expires_at>clock_timestamp() ORDER BY p.created_at,p.id",
        [workspaceId, projectId, workItemId],
      ) as Promise<Row[]>,
      this.source.query(
        "SELECT adjudicative_aggregate_hash FROM qa_request_extensions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3",
        [workspaceId, projectId, workItemId],
      ) as Promise<Row[]>,
    ]);
    return {
      schemaVersion: 1,
      workspaceId,
      projectId,
      workItemId,
      verdicts,
      verdictSignatures,
      dodAssessments,
      completionCandidates,
      finalCloseConfirmations,
      postCloseCorrectionMarkers,
      cosignRequests,
      aggregateSnapshotHash: extensions[0]?.adjudicative_aggregate_hash,
      releaseDecision: false,
    };
  }

  @Post("verdicts")
  async createVerdict(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Body() body: QaVerdictDraftRequest,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.verdict.sign");
    try {
      const result = await this.verdict.create(
        this.#completionAuthority(request, workspaceId, projectId),
        workItemId,
        body,
      );
      response.setHeader("ETag", etag(result.resourceVersion));
      response.setHeader("Location", `verdicts/${result.verdictId}`);
      return result;
    } catch (error) {
      return fail(error);
    }
  }

  @Post("verdicts/:verdictId/signatures")
  async signVerdict(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("verdictId") verdictId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.verdict.sign");
    try {
      const result = await this.verdict.sign(
        this.#completionAuthority(request, workspaceId, projectId),
        workItemId,
        verdictId,
        expectedVersion(ifMatch),
      );
      response.setHeader("ETag", etag(Number(result.verdict.resource_version)));
      return result;
    } catch (error) {
      return fail(error);
    }
  }

  @Post("verdicts/:verdictId/cosign-requests")
  async requestCosign(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("verdictId") verdictId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: Readonly<{ reason: string }>,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.verdict.sign");
    try {
      return await this.verdict.requestCosign(
        this.#completionAuthority(request, workspaceId, projectId),
        workItemId,
        verdictId,
        expectedVersion(ifMatch),
        body.reason,
      );
    } catch (error) {
      return fail(error);
    }
  }

  @Post("verdicts/:verdictId/cosign-approvals/:approvalId/approve")
  async approveCosign(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("verdictId") verdictId: string,
    @Param("approvalId") approvalId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.verdict.cosign");
    try {
      return await this.verdict.approveCosign(
        this.#completionAuthority(request, workspaceId, projectId),
        workItemId,
        verdictId,
        approvalId,
      );
    } catch (error) {
      return fail(error);
    }
  }

  @Post("verdicts/:verdictId/supersessions")
  async supersedeVerdict(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("verdictId") verdictId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: QaVerdictDraftRequest,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.verdict.sign");
    try {
      const result = await this.verdict.create(
        this.#completionAuthority(request, workspaceId, projectId),
        workItemId,
        body,
        { verdictId, expectedVersion: expectedVersion(ifMatch) },
      );
      response.setHeader("ETag", etag(result.resourceVersion));
      response.setHeader("Location", `verdicts/${result.verdictId}`);
      return result;
    } catch (error) {
      return fail(error);
    }
  }

  @Post("dod-assessments")
  async assessDod(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Body() body: QaDodAssessmentRequest,
  ) {
    try {
      return await this.dod.assess(
        {
          workspaceId,
          projectId,
          authorize: (permission) =>
            authorizeQaApi(this.source, request, workspaceId, projectId, permission),
        },
        workItemId,
        body,
      );
    } catch (error) {
      return fail(error);
    }
  }

  @Post("completion-candidates")
  async createCandidate(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Body() body: Readonly<{ readyToCloseDodRef: QaExactReference }>,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    try {
      const candidate = await this.completion.create(
        this.#completionAuthority(request, workspaceId, projectId),
        workItemId,
        body.readyToCloseDodRef,
      );
      response.setHeader("ETag", etag(candidate.resourceVersion));
      response.setHeader("Location", `completion-candidates/${candidate.candidateId}`);
      return candidate;
    } catch (error) {
      return fail(error);
    }
  }

  @Get("completion-candidates/:candidateId")
  async candidate(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("candidateId") candidateId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    await this.#authorizeWorkRead(request, workspaceId, projectId, workItemId);
    const candidate = rows(
      await this.source.query(
        "SELECT * FROM qa_completion_candidates WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND candidate_id=$4",
        [workspaceId, projectId, workItemId, candidateId],
      ),
    )[0];
    if (!candidate) throw new NotFoundException("QA_COMPLETION_CANDIDATE_NOT_FOUND");
    response.setHeader("ETag", etag(Number(candidate.resource_version)));
    return candidate;
  }

  @Get("completion-candidates/:candidateId/final-close")
  async finalClose(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("candidateId") candidateId: string,
  ) {
    await this.#authorizeWorkRead(request, workspaceId, projectId, workItemId);
    const confirmation = rows(
      await this.source.query(
        "SELECT * FROM qa_final_close_confirmations WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND candidate_id=$4",
        [workspaceId, projectId, workItemId, candidateId],
      ),
    )[0];
    if (!confirmation) throw new NotFoundException("QA_FINAL_CLOSE_NOT_CONFIRMED");
    return confirmation;
  }

  @Post("completion-candidates/:candidateId/final-close")
  async requestCompletion(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("candidateId") candidateId: string,
    @Headers("if-match") ifMatch: string | undefined,
  ) {
    try {
      return await this.completion.publish(
        this.#completionAuthority(request, workspaceId, projectId),
        workItemId,
        candidateId,
        expectedVersion(ifMatch),
      );
    } catch (error) {
      return fail(error);
    }
  }

  @Post("completion-approvals/:approvalId/approve")
  async approveCompletion(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("approvalId") approvalId: string,
  ) {
    try {
      return await this.completionApproval.approve(
        this.#completionAuthority(request, workspaceId, projectId),
        workItemId,
        approvalId,
      );
    } catch (error) {
      return fail(error);
    }
  }

  #completionAuthority(request: QaSessionRequest, workspaceId: string, projectId: string) {
    return {
      workspaceId,
      projectId,
      authorize: (permission: string) =>
        authorizeQaApi(this.source, request, workspaceId, projectId, permission),
    };
  }

  async #authorizeWorkRead(
    request: QaSessionRequest,
    workspaceId: string,
    projectId: string,
    workItemId: string,
  ): Promise<void> {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read");
    const work = rows(
      await this.source.query(
        "SELECT classification_key FROM work_items WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        [workspaceId, projectId, workItemId],
      ),
    )[0];
    if (!work) throw new NotFoundException("QA_REQUEST_NOT_FOUND");
    const current = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "work-item.read",
    );
    if (
      !defaultClassificationCatalog.permits(
        defaultClassificationCatalog.reference(current.classificationCeiling),
        defaultClassificationCatalog.reference(String(work.classification_key)),
      )
    )
      throw new ForbiddenException("QA_VERDICT_CLASSIFICATION_DENIED");
  }
}
