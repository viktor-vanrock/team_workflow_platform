import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0240DevBootstrapSource1700000000240 implements MigrationInterface {
  readonly name = "M0240DevBootstrapSource1700000000240";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE platform_role_assignments DROP CONSTRAINT platform_role_assignments_source_check;
      ALTER TABLE platform_role_assignments ADD CONSTRAINT platform_role_assignments_source_check
        CHECK(source IN ('LOCAL_BOOTSTRAP','LOCAL_FIRST_LOGIN','CORPORATE_GROUP','CORPORATE_FIRST_LOGIN','DEV_BOOTSTRAP'));
      UPDATE platform_schema_versions SET version=240,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    const rows = (await runner.query(
      "SELECT EXISTS(SELECT 1 FROM platform_role_assignments WHERE source='DEV_BOOTSTRAP') AS present",
    )) as { present: boolean }[];
    if (rows[0]?.present) throw new Error("DEV_BOOTSTRAP_ROLLBACK_REQUIRES_EXPLICIT_ROLE_HANDLING");
    await runner.query(`
      ALTER TABLE platform_role_assignments DROP CONSTRAINT platform_role_assignments_source_check;
      ALTER TABLE platform_role_assignments ADD CONSTRAINT platform_role_assignments_source_check
        CHECK(source IN ('LOCAL_BOOTSTRAP','LOCAL_FIRST_LOGIN','CORPORATE_GROUP','CORPORATE_FIRST_LOGIN'));
      UPDATE platform_schema_versions SET version=235,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
}
