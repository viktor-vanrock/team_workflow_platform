import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0225FirstCorporateAdministrator1700000000225 implements MigrationInterface {
  readonly name = "M0225FirstCorporateAdministrator1700000000225";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE platform_role_assignments DROP CONSTRAINT platform_role_assignments_source_check;
      ALTER TABLE platform_role_assignments ADD CONSTRAINT platform_role_assignments_source_check
        CHECK(source IN ('LOCAL_BOOTSTRAP','CORPORATE_GROUP','CORPORATE_FIRST_LOGIN'));
      CREATE TABLE platform_administrator_bootstrap (
        singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
        principal_id uuid NOT NULL REFERENCES identities(id),
        source text NOT NULL CHECK(source IN ('CORPORATE_GROUP','CORPORATE_FIRST_LOGIN')),
        claimed_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      -- An existing corporate administrator, including a revoked one, closes bootstrap on upgrade.
      INSERT INTO platform_administrator_bootstrap(singleton,principal_id,source,claimed_at)
        SELECT true,principal_id,source,created_at FROM platform_role_assignments
        WHERE source='CORPORATE_GROUP' ORDER BY created_at,principal_id LIMIT 1;
      CREATE TRIGGER platform_administrator_bootstrap_append_only BEFORE UPDATE OR DELETE
        ON platform_administrator_bootstrap FOR EACH ROW EXECUTE FUNCTION awp_append_only();
      UPDATE platform_schema_versions SET version=225,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(): Promise<void> {
    throw new Error("FIRST_ADMINISTRATOR_ROLLBACK_REQUIRES_FORWARD_MIGRATION");
  }
}
