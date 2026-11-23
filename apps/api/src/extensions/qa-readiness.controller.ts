import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import type { DataSource } from "typeorm";

import {
  buildRevisedQaRequestInput,
  prepareReadinessWaiverAction,
  qaAggregateSnapshotHash,
  type QaDorSemanticInput,
  type QaReadinessAssessment,
  QaReadinessRepository,
  QaRequestInputRepository,
  QaRequestRepository,
} from "@awp/competency-qa/node";
import {
  invalidateQaPendingReadiness,
  type QaReadinessRuntime,
  readQaRequestRevisionGuards,
} from "@awp/runtime-composition";

import {
  authorizeQaApi,
  QA_DATA_SOURCE,
  QaSessionGuard,
  type QaSessionRequest,
} from "./qa-api-authorization.ts";

export const QA_READINESS_RUNTIME = Symbol("QA_READINESS_RUNTIME");

interface ResponseLike {
  setHeader(name: string, value: string): void;
}
const etag = (value: number) => `W/"${value}"`;
const parseEtag = (value: string | undefined): number =>
  Number(value?.match(/^W\/"([1-9]\d*)"$/u)?.[1] ?? Number.NaN);

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/work-items/:workItemId/qa")
@UseGuards(QaSessionGuard)
export class QaReadinessController {
  constructor(
    @Inject(QA_DATA_SOURCE) private readonly source: DataSource,
    @Inject(QA_READINESS_RUNTIME) private readonly runtime: QaReadinessRuntime,
  ) {}

  @Post("request-input-revisions")
  async revise(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body()
    body: Readonly<{
      semanticInput: QaDorSemanticInput;
      changeReasonCode: "MISSING_INFO_SUPPLIED" | "REQUESTER_CORRECTION";
      reason: string;
    }>,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "qa.request.input.revise");
    const expectedVersion = parseEtag(ifMatch);
    if (!Number.isSafeInteger(expectedVersion)) throw new ConflictException("QA_IF_MATCH_REQUIRED");
    const recordedAt = new Date().toISOString();
    const revision = await this.source
      .transaction("READ COMMITTED", async (manager) => {
        await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `qa-request:${workspaceId}:${projectId}:${workItemId}`,
        ]);
        const authorization = await authorizeQaApi(
          this.source,
          request,
          workspaceId,
          projectId,
          "qa.request.input.revise",
        );
        const requests = new QaRequestRepository(manager);
        const inputs = new QaRequestInputRepository(manager);
        const extension = await requests.byWorkItem({ workspaceId, projectId }, workItemId);
        if (!extension) throw new NotFoundException("QA_REQUEST_NOT_FOUND");
        if (extension.resourceVersion !== expectedVersion)
          throw new ConflictException("QA_REQUEST_INPUT_STALE");
        const current = await inputs.get(
          { workspaceId, projectId },
          workItemId,
          extension.currentRequestInputRevisionRef.version,
        );
        if (!current) throw new NotFoundException("QA_REQUEST_INPUT_NOT_FOUND");
        const guards = await readQaRequestRevisionGuards(
          manager,
          { workspaceId, projectId },
          workItemId,
        );
        // Invalidation and advancing the input pointer share this transaction.
        const input = {
          current,
          expectedCurrentRef: extension.currentRequestInputRevisionRef,
          revisionId: randomUUID(),
          semanticInput: body.semanticInput,
          changeReasonCode: body.changeReasonCode,
          reason: body.reason,
          actor: authorization.actor,
          authorizationBasisHash: qaAggregateSnapshotHash(authorization.basis as never),
          recordedAt,
          correlationId: randomUUID(),
          ...guards,
        };
        const invalidatedState = await invalidateQaPendingReadiness(
          manager,
          current,
          authorization.actor,
          authorization.basis,
        );
        const next = buildRevisedQaRequestInput({ ...input, invalidatedState });
        await inputs.insert(manager, next);
        const extensionBody = Object.fromEntries(
          Object.entries(extension).filter(
            ([key]) => key !== "contentHash" && key !== "latestReadinessAssessmentRef",
          ),
        );
        const nextExtension = {
          ...extensionBody,
          currentRequestInputRevisionRef: {
            id: next.inputRevisionId,
            version: next.version,
            contentHash: next.contentHash,
          },
          resourceVersion: extension.resourceVersion + 1,
          updatedAt: recordedAt,
        };
        const contentHash = qaAggregateSnapshotHash(nextExtension as never);
        const clean = { ...nextExtension, contentHash };
        const [updated] = (await manager.query(
          "UPDATE qa_request_extensions SET current_input_revision_id=$1,current_input_version=$2,current_input_content_hash=$3,latest_readiness_assessment_id=NULL,resource_version=resource_version+1,content_hash=$4,content=$5,updated_at=$6 WHERE extension_id=$7 AND resource_version=$8 RETURNING resource_version",
          [
            next.inputRevisionId,
            next.version,
            next.contentHash,
            contentHash,
            JSON.stringify(clean),
            recordedAt,
            extension.extensionId,
            expectedVersion,
          ],
        )) as [readonly { resource_version: number }[], number];
        if (!updated[0]) throw new ConflictException("QA_REQUEST_INPUT_STALE");
        return { next, resourceVersion: updated[0].resource_version };
      })
      .catch((error: unknown) => this.fail(error));
    response.setHeader("ETag", etag(revision.resourceVersion));
    return revision.next;
  }

  @Post("readiness-assessments")
  async assess(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const expectedVersion = parseEtag(ifMatch);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      throw new ConflictException("QA_IF_MATCH_REQUIRED");
    const assessment = await this.runtime
      .assess(this.authority(request, workspaceId, projectId), workItemId, expectedVersion)
      .catch((error: unknown) => this.fail(error));
    response.setHeader("ETag", etag(expectedVersion + 1));
    return assessment;
  }

  @Get("readiness-assessments")
  async history(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read");
    const rows = (await this.source.query(
      "SELECT content FROM qa_readiness_assessments WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY assessment_version",
      [workspaceId, projectId, workItemId],
    )) as readonly { content: QaReadinessAssessment }[];
    return { items: rows.map(({ content }) => content) };
  }

  @Post("readiness-confirmations")
  async confirm(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
  ) {
    return this.runtime
      .confirm(this.authority(request, workspaceId, projectId), workItemId)
      .catch((error: unknown) => this.fail(error));
  }

  @Post("waivers")
  async requestWaiver(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Body() body: Readonly<{ reason: string; expiresAt: string }>,
  ) {
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.readiness.waive",
    );
    const assessment = await new QaReadinessRepository(this.source).latest(
      { workspaceId, projectId },
      workItemId,
    );
    if (!assessment) throw new NotFoundException("QA_READINESS_NOT_FOUND");
    const actionId = randomUUID();
    const createdAt = new Date().toISOString();
    const subject = prepareReadinessWaiverAction({
      id: randomUUID(),
      assessment,
      initiatedBy: authorization.actor.principalId,
      reason: body.reason,
      expiresAt: body.expiresAt,
      createdAt,
    });
    await this.source.query(
      "INSERT INTO qa_waivers(waiver_id,workspace_id,project_id,work_item_id,waiver_kind,rule_code,state,subject_hash,content_hash,content,expires_at,row_version) VALUES($1,$2,$3,$4,'DOR','PROJECT_REGISTRY_NEEDS_REVIEW','PENDING',$5,$6,$7,$8,1)",
      [
        subject.waiver.id,
        workspaceId,
        projectId,
        workItemId,
        subject.inputFingerprint,
        subject.waiver.contentHash,
        JSON.stringify(subject.waiver),
        subject.waiver.expiresAt,
      ],
    );
    return {
      actionId,
      actionKind: "qa.readiness.dor-waiver@1",
      state: "PENDING_APPROVAL",
      subjectHash: subject.waiver.contentHash,
      waiverRef: { id: subject.waiver.id, version: 1, contentHash: subject.waiver.contentHash },
    };
  }
  private fail(error: unknown): never {
    if (error instanceof HttpException) throw error;
    const code = error instanceof Error ? error.message : "";
    if (["QA_REQUEST_NOT_FOUND", "QA_REQUEST_INPUT_NOT_FOUND"].includes(code))
      throw new NotFoundException(code);
    if (
      [
        "QA_REQUEST_INPUT_STALE",
        "QA_READINESS_EXTENSION_CAS_CONFLICT",
        "QA_READINESS_NOT_ASSESSED",
        "QA_READINESS_BLOCKED",
        "QA_READINESS_STALE_INPUT",
        "QA_READINESS_FACTS_CHANGED",
        "QA_READINESS_EXTERNAL_STATE_CONFLICT",
        "QA_READINESS_DISPATCH_IN_FLIGHT",
        "QA_REQUEST_INPUT_FROZEN_READY",
        "QA_REQUEST_INPUT_FROZEN_SESSION_EXISTS",
        "QA_READINESS_WAIVER_REQUIRED",
      ].includes(code)
    )
      throw new ConflictException(code);
    if (
      [
        "QA_REQUEST_INPUT_REASON_INVALID",
        "QA_EMPTY_OPTIONAL_FACT_FORBIDDEN",
        "QA_BLOCKER_INVALID",
        "QA_MUTABLE_ALIAS_FORBIDDEN",
        "QA_RETEST_LINEAGE_FORBIDDEN",
      ].includes(code)
    )
      throw new BadRequestException(code);
    if (
      [
        "QA_READINESS_CONFIGURATION_DENIED",
        "QA_SESSION_CONFIGURATION_DENIED",
        "QA_PROJECT_CONTEXT_NOT_FOUND",
      ].includes(code)
    )
      throw new ServiceUnavailableException("QA_READINESS_CONFIGURATION_UNAVAILABLE");
    throw error;
  }
  private authority(request: QaSessionRequest, workspaceId: string, projectId: string) {
    return {
      workspaceId,
      projectId,
      authorize: (
        permission: Parameters<Parameters<QaReadinessRuntime["assess"]>[0]["authorize"]>[0],
      ) => authorizeQaApi(this.source, request, workspaceId, projectId, permission),
    };
  }
}
