import { Controller, Get, Inject, Param, Req, UseGuards } from "@nestjs/common";
import type { DataSource } from "typeorm";

import {
  authorizeQaApi,
  QA_DATA_SOURCE,
  QaSessionGuard,
  type QaSessionRequest,
} from "./qa-api-authorization.ts";

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/qa/hermes")
@UseGuards(QaSessionGuard)
export class QaHermesProposalsController {
  constructor(@Inject(QA_DATA_SOURCE) private readonly source: DataSource) {}
  @Get("triage/:subjectKind/:subjectId") async triage(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("subjectKind") subjectKind: string,
    @Param("subjectId") subjectId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read");
    const rows = (await this.source.query(
      'SELECT id,subject,revision,content,content_hash AS "contentHash",source_fact_set_hash AS "sourceFactSetHash",state,created_at AS "createdAt" FROM qa_triage_assessments WHERE workspace_id=$1 AND project_id=$2 AND subject->>\'kind\'=$3 AND subject->>\'id\'=$4 ORDER BY revision DESC',
      [workspaceId, projectId, subjectKind, subjectId],
    )) as readonly Readonly<Record<string, unknown>>[];
    return { items: rows };
  }
  @Get("session-plans/:workItemId") async plans(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read");
    const rows = (await this.source.query(
      'SELECT id,subject,revision,content,content_hash AS "contentHash",source_fact_set_hash AS "sourceFactSetHash",state,created_at AS "createdAt" FROM qa_session_plan_proposals WHERE workspace_id=$1 AND project_id=$2 AND subject->>\'id\'=$3 ORDER BY revision DESC',
      [workspaceId, projectId, workItemId],
    )) as readonly Readonly<Record<string, unknown>>[];
    return { items: rows };
  }
}

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId")
@UseGuards(QaSessionGuard)
export class QaHermesProposalResourcesController {
  constructor(@Inject(QA_DATA_SOURCE) private readonly source: DataSource) {}
  @Get("triage-assessments/:assessmentId") async assessment(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("assessmentId") assessmentId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read");
    const rows = (await this.source.query(
      'SELECT id,subject,revision,content,content_hash AS "contentHash",source_fact_set_hash AS "sourceFactSetHash",state,expires_at AS "expiresAt",created_at AS "createdAt" FROM qa_triage_assessments WHERE workspace_id=$1 AND project_id=$2 AND (id=$3 OR id LIKE $3||\':r%\') ORDER BY revision DESC LIMIT 1',
      [workspaceId, projectId, assessmentId],
    )) as readonly Readonly<Record<string, unknown>>[];
    if (!rows[0]) throw new Error("TRIAGE_ASSESSMENT_NOT_FOUND");
    return rows[0];
  }
  @Get("session-plan-proposals/:proposalId") async proposal(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("proposalId") proposalId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read");
    const rows = (await this.source.query(
      'SELECT id,subject,revision,content,content_hash AS "contentHash",source_fact_set_hash AS "sourceFactSetHash",state,expires_at AS "expiresAt",created_at AS "createdAt" FROM qa_session_plan_proposals WHERE workspace_id=$1 AND project_id=$2 AND (id=$3 OR id LIKE $3||\':r%\') ORDER BY revision DESC LIMIT 1',
      [workspaceId, projectId, proposalId],
    )) as readonly Readonly<Record<string, unknown>>[];
    if (!rows[0]) throw new Error("SESSION_PLAN_PROPOSAL_NOT_FOUND");
    return rows[0];
  }
}
