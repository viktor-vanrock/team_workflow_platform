import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0230FirstLocalAdministrator1700000000230 implements MigrationInterface {
  readonly name = "M0230FirstLocalAdministrator1700000000230";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE platform_role_assignments DROP CONSTRAINT platform_role_assignments_source_check;
      ALTER TABLE platform_role_assignments ADD CONSTRAINT platform_role_assignments_source_check
        CHECK(source IN ('LOCAL_BOOTSTRAP','LOCAL_FIRST_LOGIN','CORPORATE_GROUP','CORPORATE_FIRST_LOGIN'));
      CREATE TABLE local_administrator_seed_history (
        principal_id uuid PRIMARY KEY REFERENCES identities(id),
        role_key text NOT NULL, source text NOT NULL,
        revoked_at timestamptz, created_at timestamptz NOT NULL,
        retired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        reason text NOT NULL DEFAULT 'Replace preassigned local admin with first local login'
      );
      INSERT INTO local_administrator_seed_history(principal_id,role_key,source,revoked_at,created_at)
        SELECT principal_id,role_key,source,revoked_at,created_at FROM platform_role_assignments
        WHERE source='LOCAL_BOOTSTRAP';
      CREATE TRIGGER local_administrator_seed_history_append_only BEFORE UPDATE OR DELETE
        ON local_administrator_seed_history FOR EACH ROW EXECUTE FUNCTION awp_append_only();
      DELETE FROM platform_role_assignments WHERE source='LOCAL_BOOTSTRAP';
      CREATE TABLE local_administrator_bootstrap (
        singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
        principal_id uuid NOT NULL REFERENCES identities(id),
        claimed_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE TRIGGER local_administrator_bootstrap_append_only BEFORE UPDATE OR DELETE
        ON local_administrator_bootstrap FOR EACH ROW EXECUTE FUNCTION awp_append_only();
      CREATE UNIQUE INDEX one_local_first_administrator ON platform_role_assignments(role_key)
        WHERE source='LOCAL_FIRST_LOGIN';
      UPDATE platform_schema_versions SET version=230,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(): Promise<void> {
    throw new Error("FIRST_LOCAL_ADMINISTRATOR_ROLLBACK_REQUIRES_FORWARD_MIGRATION");
  }
}
