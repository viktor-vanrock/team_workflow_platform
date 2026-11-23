import type { DataSource, EntityManager } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";

import {
  QaTriageAssessmentAggregate,
  type QaTriageAssessmentSnapshot,
  type QaTriageStaleReason,
} from "../domain/triage-assessment.ts";

type Row = Readonly<Record<string, unknown>>;

const rows = (value: unknown): readonly Row[] =>
  Array.isArray(value) && Array.isArray(value[0])
    ? (value[0] as readonly Row[])
    : (value as readonly Row[]);

const json = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;

function snapshot(row: Row): QaTriageAssessmentSnapshot {
  const value = {
    id: String(row.id).replace(/:r\d+$/u, ""),
    workspaceId: String(row.workspace_id),
    projectId: String(row.project_id),
    subject: json<QaTriageAssessmentSnapshot["subject"]>(row.subject),
    revision: Number(row.revision),
    content: json<Readonly<Record<string, unknown>>>(row.content),
    contentHash: String(row.content_hash) as QaTriageAssessmentSnapshot["contentHash"],
    sourceFactSetHash: String(
      row.source_fact_set_hash,
    ) as QaTriageAssessmentSnapshot["sourceFactSetHash"],
    state: String(row.state) as QaTriageAssessmentSnapshot["state"],
    expiresAt: new Date(String(row.expires_at)),
    ...(row.stale_at ? { staleAt: new Date(String(row.stale_at)) } : {}),
    ...(row.stale_reason_code
      ? { staleReasonCode: String(row.stale_reason_code) as QaTriageStaleReason }
      : {}),
  };
  return QaTriageAssessmentAggregate.restore(value).snapshot();
}

export class TypeOrmQaTriageAssessmentRepository {
  constructor(private readonly source: DataSource) {}

  async save(
    value: QaTriageAssessmentSnapshot,
    actionProvenanceRef: string,
    createdAt = new Date(),
    executor?: EntityManager,
    modelPolicyRef?: Readonly<{ id: string; version: number; contentHash: string }>,
  ): Promise<QaTriageAssessmentSnapshot> {
    QaTriageAssessmentAggregate.restore(value);
    const run = async (manager: EntityManager) => {
      const existing = rows(
        await manager.query(
          "SELECT * FROM qa_triage_assessments WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
          [value.workspaceId, value.projectId, `${value.id}:r${value.revision}`],
        ),
      );
      if (existing[0]) {
        if (existing[0].content_hash !== value.contentHash)
          throw new Error("TRIAGE_ASSESSMENT_REVISION_CONFLICT");
        if (
          sha256((existing[0].model_policy_ref ?? null) as JsonValue) !==
          sha256((modelPolicyRef ?? null) as JsonValue)
        )
          throw new Error("QA_HERMES_POLICY_CHANGED");
        return snapshot(existing[0]);
      }
      const current = rows(
        await manager.query(
          "SELECT id,revision FROM qa_triage_assessments WHERE workspace_id=$1 AND project_id=$2 AND subject->>'kind'=$3 AND subject->>'id'=$4 AND state='CURRENT' FOR UPDATE",
          [value.workspaceId, value.projectId, value.subject.kind, value.subject.id],
        ),
      );
      if (current.some((row) => Number(row.revision) >= value.revision))
        throw new Error("TRIAGE_ASSESSMENT_REVISION_CONFLICT");
      await manager.query(
        "UPDATE qa_triage_assessments SET state='SUPERSEDED' WHERE workspace_id=$1 AND project_id=$2 AND subject->>'kind'=$3 AND subject->>'id'=$4 AND state='CURRENT'",
        [value.workspaceId, value.projectId, value.subject.kind, value.subject.id],
      );
      await manager.query(
        "INSERT INTO qa_triage_assessments(id,workspace_id,project_id,subject,revision,content,content_hash,source_fact_set_hash,state,expires_at,stale_at,stale_reason_code,action_provenance_ref,created_at,model_policy_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
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
          value.staleReasonCode ?? null,
          actionProvenanceRef,
          createdAt,
          modelPolicyRef ?? null,
        ],
      );
      return value;
    };
    return executor ? await run(executor) : await this.source.transaction("SERIALIZABLE", run);
  }

  async revision(
    workspaceId: string,
    projectId: string,
    id: string,
    revision: number,
  ): Promise<QaTriageAssessmentSnapshot | undefined> {
    const result = rows(
      await this.source.query(
        "SELECT * FROM qa_triage_assessments WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        [workspaceId, projectId, `${id}:r${revision}`],
      ),
    );
    return result[0] ? snapshot(result[0]) : undefined;
  }

  async history(
    workspaceId: string,
    projectId: string,
    subjectKind: string,
    subjectId: string,
  ): Promise<readonly QaTriageAssessmentSnapshot[]> {
    const result = rows(
      await this.source.query(
        "SELECT * FROM qa_triage_assessments WHERE workspace_id=$1 AND project_id=$2 AND subject->>'kind'=$3 AND subject->>'id'=$4 ORDER BY revision ASC",
        [workspaceId, projectId, subjectKind, subjectId],
      ),
    );
    return Object.freeze(result.map(snapshot));
  }

  async current(
    workspaceId: string,
    projectId: string,
    subjectKind: string,
    subjectId: string,
  ): Promise<QaTriageAssessmentSnapshot | undefined> {
    const result = rows(
      await this.source.query(
        "SELECT * FROM qa_triage_assessments WHERE workspace_id=$1 AND project_id=$2 AND subject->>'kind'=$3 AND subject->>'id'=$4 ORDER BY revision DESC LIMIT 1",
        [workspaceId, projectId, subjectKind, subjectId],
      ),
    );
    return result[0] ? snapshot(result[0]) : undefined;
  }

  async markStale(
    workspaceId: string,
    projectId: string,
    id: string,
    expectedContentHash: string,
    reasonCode: QaTriageStaleReason = "SOURCE_CHANGED",
  ): Promise<void> {
    const result = rows(
      await this.source.query(
        "UPDATE qa_triage_assessments SET state='STALE',stale_at=clock_timestamp(),stale_reason_code=$5 WHERE workspace_id=$1 AND project_id=$2 AND id LIKE $3 AND content_hash=$4 AND state='CURRENT' RETURNING id",
        [workspaceId, projectId, `${id}:r%`, expectedContentHash, reasonCode],
      ),
    );
    if (result.length !== 1) throw new Error("TRIAGE_STALE_CAS_CONFLICT");
  }
}
