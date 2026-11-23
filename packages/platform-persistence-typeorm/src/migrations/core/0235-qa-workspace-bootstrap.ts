import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0235QaWorkspaceBootstrap1700000000235 implements MigrationInterface {
  readonly name = "M0235QaWorkspaceBootstrap1700000000235";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE qa_workspace_bootstrap (
        singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
        workspace_id uuid NOT NULL UNIQUE REFERENCES workspaces(id),
        configuration_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE TABLE qa_workspace_administrator_bootstrap (
        singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
        workspace_id uuid NOT NULL REFERENCES workspaces(id),
        principal_id uuid NOT NULL REFERENCES identities(id),
        role_assignment_id uuid NOT NULL REFERENCES role_assignments(id),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE TRIGGER qa_workspace_bootstrap_append_only BEFORE UPDATE OR DELETE
        ON qa_workspace_bootstrap FOR EACH ROW EXECUTE FUNCTION awp_append_only();
      CREATE TRIGGER qa_workspace_administrator_bootstrap_append_only BEFORE UPDATE OR DELETE
        ON qa_workspace_administrator_bootstrap FOR EACH ROW EXECUTE FUNCTION awp_append_only();
      UPDATE platform_schema_versions SET version=235,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(): Promise<void> {
    throw new Error("QA_WORKSPACE_ROLLBACK_REQUIRES_FORWARD_MIGRATION");
  }
}
