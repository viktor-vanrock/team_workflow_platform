import { randomUUID } from "node:crypto";

import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
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
  publishRequiredSessionPlan,
  QaProjectPolicyRepository,
  QaReadinessRepository,
  QaRequestRepository,
  type QaRequiredSessionRequirementInput,
} from "@awp/competency-qa/node";

import {
  authorizeQaApi,
  QA_DATA_SOURCE,
  QaSessionGuard,
  type QaSessionRequest,
} from "./qa-api-authorization.ts";

interface ResponseLike {
  setHeader(name: string, value: string): void;
}
const parseEtag = (value: string | undefined): number =>
  Number(value?.match(/\d+/u)?.[0] ?? Number.NaN);

@Controller(
  "api/v1/workspaces/:workspaceId/projects/:projectId/work-items/:workItemId/qa/required-session-plans",
)
@UseGuards(QaSessionGuard)
export class QaRequiredSessionPlansController {
  constructor(@Inject(QA_DATA_SOURCE) private readonly source: DataSource) {}

  @Get()
  async current(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read");
    const extension = await new QaRequestRepository(this.source).byWorkItem(
      { workspaceId, projectId },
      workItemId,
    );
    if (!extension) throw new NotFoundException("QA_REQUEST_NOT_FOUND");
    const header = await new QaReadinessRepository(this.source).ensurePlanHeader(this.source, {
      id: `${extension.extensionId}:required-plan`,
      extensionId: extension.extensionId,
      scope: { workspaceId, projectId },
      workItemId,
      createdAt: extension.createdAt,
    });
    response.setHeader("ETag", `W/"${header.resourceVersion}"`);
    return header;
  }

  @Get("history")
  async history(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    return await this.current(request, workspaceId, projectId, workItemId, response);
  }

  @Get("current")
  async currentRevision(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read");
    const rows = (await this.source.query(
      "SELECT v.content FROM qa_required_session_plans h JOIN qa_required_session_plan_versions v ON v.plan_version_id=h.current_version_id WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.work_item_id=$3",
      [workspaceId, projectId, workItemId],
    )) as readonly { content: unknown }[];
    if (!rows[0]) throw new NotFoundException("QA_REQUIRED_SESSION_PLAN_NOT_PUBLISHED");
    return rows[0].content;
  }

  @Get(":requiredSessionPlanId/revisions/:requiredSessionPlanRevision")
  async revision(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("requiredSessionPlanId") requiredSessionPlanId: string,
    @Param("requiredSessionPlanRevision") requiredSessionPlanRevision: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read");
    const rows = (await this.source.query(
      "SELECT content FROM qa_required_session_plan_versions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND plan_id=$4 AND version=$5",
      [
        workspaceId,
        projectId,
        workItemId,
        requiredSessionPlanId,
        Number(requiredSessionPlanRevision),
      ],
    )) as readonly { content: unknown }[];
    if (!rows[0]) throw new NotFoundException("QA_REQUIRED_SESSION_PLAN_REVISION_NOT_FOUND");
    return rows[0].content;
  }

  @Post()
  async publish(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body()
    body: Readonly<{ reason: string; requirements: readonly QaRequiredSessionRequirementInput[] }>,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.required-session-plan.publish",
    );
    const expectedResourceVersion = parseEtag(ifMatch);
    if (!Number.isFinite(expectedResourceVersion))
      throw new ConflictException("QA_IF_MATCH_REQUIRED");
    const extension = await new QaRequestRepository(this.source).byWorkItem(
      { workspaceId, projectId },
      workItemId,
    );
    if (!extension) throw new NotFoundException("QA_REQUEST_NOT_FOUND");
    const context = await new QaProjectPolicyRepository(this.source).currentProjectContext(
      { workspaceId, projectId },
      extension.projectContextRef.id,
    );
    if (!context) throw new NotFoundException("QA_PROJECT_CONTEXT_NOT_FOUND");
    const assessment = await new QaReadinessRepository(this.source).latest(
      { workspaceId, projectId },
      workItemId,
    );
    if (!assessment || (assessment.state !== "READY" && assessment.state !== "READY_WITH_WAIVER"))
      throw new ConflictException("QA_PLAN_REQUIRES_READY_ASSESSMENT");
    const workRows = (await this.source.query(
      "SELECT state FROM work_items WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [workspaceId, projectId, workItemId],
    )) as readonly {
      state: "READY" | "PLANNED" | "IN_PROGRESS" | "REVIEW" | "BLOCKED" | "CANCELLED" | "DONE";
    }[];
    const publishedAt = new Date().toISOString();
    const output = await this.source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `qa-plan:${workspaceId}:${projectId}:${workItemId}`,
      ]);
      const repository = new QaReadinessRepository(manager);
      const header = await repository.ensurePlanHeader(manager, {
        id: `${extension.extensionId}:required-plan`,
        extensionId: extension.extensionId,
        scope: { workspaceId, projectId },
        workItemId,
        createdAt: extension.createdAt,
      });
      const result = publishRequiredSessionPlan({
        header,
        expectedResourceVersion,
        readiness: {
          confirmed: workRows[0]?.state === "READY" || header.currentRevisionRef !== null,
          proofRef: {
            id: assessment.assessmentId,
            version: assessment.version,
            contentHash: assessment.contentHash,
          },
        },
        operationalStatus: workRows[0]?.state ?? "NEW",
        requirements: body.requirements,
        catalogs: {
          target: context.allowedTargetPolicyRefs,
          scope: context.allowedScopePolicyRefs,
          checklist: context.allowedChecklistPolicyRefs,
        },
        actor: authorization.actor,
        reason: body.reason,
        publishedAt,
        revisionId: randomUUID(),
      });
      const revision = result.revision;
      await manager.query(
        `INSERT INTO qa_required_session_plan_versions(plan_version_id,workspace_id,project_id,work_item_id,plan_id,version,previous_version_id,previous_version,previous_content_hash,readiness_assessment_id,content_hash,content,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          revision.id,
          workspaceId,
          projectId,
          workItemId,
          header.id,
          revision.version,
          revision.previousRevisionRef?.id ?? null,
          revision.previousRevisionRef?.version ?? null,
          revision.previousRevisionRef?.contentHash ?? null,
          assessment.assessmentId,
          revision.contentHash,
          JSON.stringify(revision),
          publishedAt,
        ],
      );
      for (const requirement of revision.requirements)
        await manager.query(
          `INSERT INTO qa_required_session_plan_requirements(requirement_id,workspace_id,project_id,work_item_id,plan_version_id,requirement_key,ordinal,mode,minimum_session_count,resolution,waiver_id,carried_from_requirement_id,content_hash,content) VALUES($1,$2,$3,$4,$5,$6,$7,'MANUAL',$8,$9,$10,$11,$12,$13)`,
          [
            requirement.id,
            workspaceId,
            projectId,
            workItemId,
            revision.id,
            requirement.requirementKey,
            requirement.ordinal,
            requirement.minimumSessionCount,
            requirement.resolution,
            requirement.waiverRef?.id ?? null,
            requirement.carriedForwardFromRequirementRef?.id ?? null,
            requirement.contentHash,
            JSON.stringify(requirement),
          ],
        );
      const moved = (await manager.query(
        "UPDATE qa_required_session_plans SET current_version_id=$1,current_version=$2,current_content_hash=$3,resource_version=resource_version+1,updated_at=$4 WHERE plan_id=$5 AND resource_version=$6 RETURNING resource_version",
        [
          revision.id,
          revision.version,
          revision.contentHash,
          publishedAt,
          header.id,
          expectedResourceVersion,
        ],
      )) as readonly { resource_version: number }[];
      if (!moved[0]) throw new ConflictException("QA_PLAN_STALE_VERSION");
      await manager.query(
        "UPDATE qa_request_extensions SET current_required_session_plan_version_id=$1,current_required_session_plan_content_hash=$2,resource_version=resource_version+1,updated_at=$3 WHERE extension_id=$4",
        [revision.id, revision.contentHash, publishedAt, extension.extensionId],
      );
      return { revision, resourceVersion: moved[0].resource_version };
    });
    response.setHeader("ETag", `W/"${output.resourceVersion}"`);
    return output.revision;
  }
}
