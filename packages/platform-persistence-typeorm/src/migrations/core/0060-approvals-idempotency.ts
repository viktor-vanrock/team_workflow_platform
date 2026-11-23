import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0060ApprovalsIdempotency1700000000060 implements MigrationInterface {
  readonly name = "M0060ApprovalsIdempotency1700000000060";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE approvals (
        id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, action_kind text NOT NULL, action_id uuid NOT NULL,
        subject jsonb NOT NULL, subject_hash text NOT NULL, decision_state text NOT NULL, effect_authorization_state text NOT NULL,
        initiator_id uuid NOT NULL REFERENCES identities(id), approver_id uuid NULL REFERENCES identities(id), expires_at timestamptz NOT NULL,
        row_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL,
        PRIMARY KEY(id), UNIQUE(workspace_id,project_id,id), UNIQUE(action_kind,action_id), FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE TRIGGER approvals_append_only_identity BEFORE DELETE ON approvals FOR EACH ROW EXECUTE FUNCTION awp_append_only();
      CREATE TABLE platform_actions (
        id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, action_kind text NOT NULL,
        candidate_ref jsonb NOT NULL, candidate_hash text NOT NULL, state text NOT NULL, result jsonb NULL,
        row_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL,
        PRIMARY KEY(id), UNIQUE(workspace_id,project_id,id), FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE TABLE client_request_idempotency (
        workspace_id uuid NOT NULL, project_id uuid NOT NULL, actor_id uuid NOT NULL, operation text NOT NULL,
        client_key text NOT NULL, request_hash text NOT NULL, result_ref jsonb NULL, created_at timestamptz NOT NULL,
        PRIMARY KEY(workspace_id,project_id,actor_id,operation,client_key), FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      UPDATE platform_schema_versions SET version=60, applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE client_request_idempotency; DROP TABLE platform_actions; DROP TRIGGER approvals_append_only_identity ON approvals; DROP TABLE approvals; UPDATE platform_schema_versions SET version=50 WHERE namespace='core';",
    );
  }
}
