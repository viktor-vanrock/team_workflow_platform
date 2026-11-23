import type { MigrationInterface, QueryRunner } from "typeorm";

/** Merge current role names everywhere; historical actors and explicit entitlement limits remain intact. */
export class M0210UnifiedSystemRoles1700000000210 implements MigrationInterface {
  readonly name = "M0210UnifiedSystemRoles1700000000210";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE role_merge_0210_snapshot AS SELECT id,role_key,permissions,row_version FROM role_assignments
        WHERE lower(replace(role_key,'_','-')) IN ('workspace-owner','integration-admin','integration-administrator','limited-reader','viewer');
      UPDATE role_assignments SET role_key=CASE
        WHEN lower(replace(role_key,'_','-')) IN ('limited-reader','viewer') THEN 'reader'
        ELSE 'system-administrator' END,row_version=row_version+1
        WHERE id IN(SELECT id FROM role_merge_0210_snapshot);
      UPDATE platform_schema_versions SET version=210,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(): Promise<void> {
    throw new Error("ROLE_MERGE_ROLLBACK_REQUIRES_REVIEWED_SNAPSHOT_RESTORE");
  }
}
