import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0080Audit1700000000080 implements MigrationInterface {
  readonly name = "M0080Audit1700000000080";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE audit_events (
        id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NULL, occurred_at timestamptz NOT NULL,
        actor jsonb NOT NULL, action text NOT NULL, outcome text NOT NULL, reason_code text NOT NULL,
        correlation_id uuid NOT NULL, causation_id uuid NOT NULL, authorization_basis jsonb NULL,
        classification_key text NOT NULL REFERENCES classification_catalog(key), attributes jsonb NOT NULL,
        PRIMARY KEY(id,occurred_at), FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      ) PARTITION BY RANGE (occurred_at);
      CREATE TABLE audit_events_default PARTITION OF audit_events DEFAULT;
      CREATE INDEX audit_scope_time_idx ON audit_events(workspace_id,project_id,occurred_at DESC);
      CREATE INDEX audit_correlation_idx ON audit_events(correlation_id,occurred_at DESC);
      CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION awp_append_only();
      REVOKE UPDATE, DELETE ON audit_events FROM PUBLIC;
      REVOKE UPDATE, DELETE ON audit_events_default FROM PUBLIC;
      UPDATE platform_schema_versions SET version=80, applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE audit_events; UPDATE platform_schema_versions SET version=70 WHERE namespace='core';",
    );
  }
}
