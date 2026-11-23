import type { MigrationInterface, QueryRunner } from "typeorm";

/** Team scope provisions exact entitlements; it never bypasses authorization. */
export class M0205WorkspaceTeamAccess1700000000205 implements MigrationInterface {
  readonly name = "M0205WorkspaceTeamAccess1700000000205";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE role_assignments
        ADD COLUMN project_access_scope text NOT NULL DEFAULT 'SELECTED_PROJECTS'
          CHECK(project_access_scope IN ('SELECTED_PROJECTS','ALL_PROJECTS')),
        ADD COLUMN classification_ceiling_key text REFERENCES classification_catalog(key),
        ADD CONSTRAINT role_assignment_team_scope CHECK(
          project_access_scope <> 'ALL_PROJECTS' OR
          (project_id IS NULL AND effect='ALLOW' AND classification_ceiling_key IS NOT NULL));
      CREATE INDEX workspace_team_roles ON role_assignments(workspace_id)
        WHERE project_access_scope='ALL_PROJECTS' AND revoked_at IS NULL;
      UPDATE platform_schema_versions SET version=205,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DROP INDEX workspace_team_roles;
      ALTER TABLE role_assignments DROP CONSTRAINT role_assignment_team_scope,
        DROP COLUMN project_access_scope,DROP COLUMN classification_ceiling_key;
      UPDATE platform_schema_versions SET version=200,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
}
