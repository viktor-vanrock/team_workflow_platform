import { Controller, Get, Inject, Param, Req, UseGuards } from "@nestjs/common";
import type { DataSource } from "typeorm";

import { defaultClassificationCatalog } from "@awp/platform-core";

import { QA_DATA_SOURCE } from "../extensions/qa-api-authorization.ts";
import { authorizeLocalQaApi } from "./local-qa-authorization.ts";
import { LocalSessionGuard, type LocalSessionRequest } from "./local-session.guard.ts";

interface SubjectRow {
  id: string;
  kind: "WORK_ITEM" | "DRAFT" | "CANDIDATE";
  title: string;
  status: string;
  classification: string;
  input_classification: string;
}

/** A display catalog only: every mutation still resolves current authority for its exact project. */
@Controller("local/workspaces/:workspaceId/subjects")
@UseGuards(LocalSessionGuard)
export class WorkspaceSubjectsController {
  constructor(@Inject(QA_DATA_SOURCE) private readonly source: DataSource) {}

  @Get()
  async list(@Req() request: LocalSessionRequest, @Param("workspaceId") workspaceId: string) {
    const projects = (await this.source.query(
      "SELECT id,key FROM projects WHERE workspace_id=$1 AND state='ACTIVE' ORDER BY key",
      [workspaceId],
    )) as { id: string; key: string }[];
    const items = [];
    for (const project of projects) {
      let ceiling: string;
      try {
        ceiling = (
          await authorizeLocalQaApi(this.source, request, workspaceId, project.id, "work-item.read")
        ).classificationCeiling;
      } catch {
        continue;
      }
      const rows = (await this.source.query(
        `
        SELECT w.id,'WORK_ITEM' AS kind,i.title,w.state AS status,w.classification_key AS classification,i.data_classification_key AS input_classification
        FROM work_items w JOIN qa_request_extensions e ON e.work_item_id=w.id AND e.workspace_id=w.workspace_id AND e.project_id=w.project_id
        JOIN qa_request_input_revisions i ON i.input_revision_id=e.current_input_revision_id
        WHERE w.workspace_id=$1 AND w.project_id=$2
        UNION ALL
        SELECT d.id,'DRAFT',COALESCE(d.intake_payload->>'title','Черновик QA'),d.state,
          COALESCE(d.intake_payload->>'requestedClassificationKey','INTERNAL'),COALESCE(d.intake_payload->>'requestedClassificationKey','INTERNAL')
        FROM intake_drafts d JOIN work_type_definitions t ON t.id=d.work_type_definition_id
        WHERE d.workspace_id=$1 AND d.project_id=$2 AND t.work_type_key='qa.validation'
        UNION ALL
        SELECT c.id,'CANDIDATE',COALESCE(o.minimal_summary->>'title',o.minimal_summary->>'summary','Входящее обращение'),c.state,
          COALESCE(o.minimal_summary->>'requestedClassificationKey','INTERNAL'),COALESCE(o.minimal_summary->>'requestedClassificationKey','INTERNAL')
        FROM intake_candidates c JOIN intake_candidate_source_observations o ON o.candidate_id=c.id AND o.version=c.current_source_observation_version
        WHERE c.workspace_id=$1 AND c.project_id=$2
        ORDER BY kind,title,id
      `,
        [workspaceId, project.id],
      )) as SubjectRow[];
      for (const row of rows) {
        try {
          if (
            ![row.classification, row.input_classification].every((key) =>
              defaultClassificationCatalog.permits(
                defaultClassificationCatalog.reference(ceiling),
                defaultClassificationCatalog.reference(key),
              ),
            )
          )
            continue;
        } catch {
          continue;
        }
        items.push({
          id: row.id,
          kind: row.kind,
          title: row.title,
          status: row.status,
          projectId: project.id,
          projectKey: project.key,
        });
      }
    }
    return { items };
  }
}
