import type { MigrationInterface, QueryRunner } from "typeorm";

export class QaHermesProposals20401700000002040 implements MigrationInterface {
  readonly name = "QaHermesProposals20401700000002040";
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE qa_triage_assessments(id text PRIMARY KEY,workspace_id uuid NOT NULL,project_id uuid NOT NULL,subject jsonb NOT NULL,revision integer NOT NULL,content jsonb NOT NULL,content_hash text NOT NULL,source_fact_set_hash text NOT NULL,state text NOT NULL,expires_at timestamptz NOT NULL,stale_at timestamptz NULL,stale_reason_code text NULL,action_provenance_ref text NOT NULL,created_at timestamptz NOT NULL,UNIQUE(workspace_id,project_id,id,revision));CREATE TABLE qa_session_plan_proposals(id text PRIMARY KEY,workspace_id uuid NOT NULL,project_id uuid NOT NULL,subject jsonb NOT NULL,revision integer NOT NULL,content jsonb NOT NULL,content_hash text NOT NULL,source_fact_set_hash text NOT NULL,state text NOT NULL,expires_at timestamptz NOT NULL,stale_at timestamptz NULL,accepted_plan_ref text NULL,accepted_by text NULL,accepted_at timestamptz NULL,action_provenance_ref text NOT NULL,created_at timestamptz NOT NULL,UNIQUE(workspace_id,project_id,id,revision));UPDATE platform_schema_versions SET version=2040,applied_at=clock_timestamp() WHERE namespace='pack:qa';`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP TABLE qa_session_plan_proposals;DROP TABLE qa_triage_assessments;UPDATE platform_schema_versions SET version=2030 WHERE namespace='pack:qa';`,
    );
  }
}
