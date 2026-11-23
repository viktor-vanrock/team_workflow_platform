import type { DataSource } from "typeorm";

import type { QaSessionPlanProposalSnapshot } from "../domain/session-plan-proposal.ts";

const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
export class TypeOrmQaSessionPlanProposalRepository {
  constructor(private readonly source: DataSource) {}
  async save(
    value: QaSessionPlanProposalSnapshot,
    actionProvenanceRef: string,
    createdAt = new Date(),
    modelPolicyRef?: Readonly<{ id: string; version: number; contentHash: string }>,
  ) {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query(
        "UPDATE qa_session_plan_proposals SET state='SUPERSEDED' WHERE workspace_id=$1 AND project_id=$2 AND subject->>'id'=$3 AND state='CURRENT'",
        [value.workspaceId, value.projectId, value.subject.id],
      );
      await manager.query(
        "INSERT INTO qa_session_plan_proposals(id,workspace_id,project_id,subject,revision,content,content_hash,source_fact_set_hash,state,expires_at,stale_at,accepted_plan_ref,accepted_by,accepted_at,action_provenance_ref,created_at,model_policy_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
        [
          `${value.id}:r${value.revision}`,
          value.workspaceId,
          value.projectId,
          JSON.stringify(value.subject),
          value.revision,
          JSON.stringify(value.content),
          value.contentHash,
          value.sourceFactSetHash,
          value.state,
          value.expiresAt,
          value.staleAt ?? null,
          value.acceptedPlanRef ?? null,
          value.acceptedBy ?? null,
          value.acceptedAt ?? null,
          actionProvenanceRef,
          createdAt,
          modelPolicyRef ?? null,
        ],
      );
      return value;
    });
  }
  async current(workspaceId: string, projectId: string, workItemId: string) {
    const rows = (await this.source.query(
      "SELECT * FROM qa_session_plan_proposals WHERE workspace_id=$1 AND project_id=$2 AND subject->>'kind'='WORK_ITEM' AND subject->>'id'=$3 ORDER BY revision DESC LIMIT 1",
      [workspaceId, projectId, workItemId],
    )) as readonly Readonly<Record<string, unknown>>[];
    const row = rows[0];
    return row
      ? Object.freeze({
          id: String(row.id).replace(/:r\d+$/u, ""),
          workspaceId: String(row.workspace_id),
          projectId: String(row.project_id),
          subject: json(row.subject),
          revision: Number(row.revision),
          content: json(row.content),
          contentHash: String(row.content_hash),
          sourceFactSetHash: String(row.source_fact_set_hash),
          state: String(row.state),
          expiresAt: new Date(String(row.expires_at)),
          ...(row.stale_at ? { staleAt: new Date(String(row.stale_at)) } : {}),
          ...(row.accepted_plan_ref ? { acceptedPlanRef: String(row.accepted_plan_ref) } : {}),
          ...(row.accepted_by ? { acceptedBy: String(row.accepted_by) } : {}),
          ...(row.accepted_at ? { acceptedAt: new Date(String(row.accepted_at)) } : {}),
        })
      : undefined;
  }
  async markStale(workspaceId: string, projectId: string, id: string, expectedContentHash: string) {
    const result = (await this.source.query(
      "UPDATE qa_session_plan_proposals SET state='STALE',stale_at=clock_timestamp() WHERE workspace_id=$1 AND project_id=$2 AND id LIKE $3 AND content_hash=$4 AND state='CURRENT' RETURNING id",
      [workspaceId, projectId, `${id}:r%`, expectedContentHash],
    )) as readonly unknown[];
    if (result.length !== 1) throw new Error("SESSION_PLAN_STALE_CAS_CONFLICT");
  }
}
