import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0020ProjectsEntitlements1700000000020 implements MigrationInterface {
  readonly name = "M0020ProjectsEntitlements1700000000020";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE projects (
        id uuid NOT NULL, workspace_id uuid NOT NULL REFERENCES workspaces(id), key text NOT NULL, name text NOT NULL,
        state text NOT NULL CHECK (state IN ('ACTIVE','SUSPENDED','ARCHIVED')),
        classification_key text NOT NULL REFERENCES classification_catalog(key),
        row_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(id), UNIQUE(workspace_id,id), UNIQUE(workspace_id,key)
      );
      ALTER TABLE role_assignments ADD CONSTRAINT role_assignment_project_scope_fk
        FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id,id);
      CREATE TABLE project_entitlements (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL, principal_id uuid NOT NULL REFERENCES identities(id),
        effect text NOT NULL CHECK (effect IN ('ALLOW','DENY')),
        classification_ceiling_key text NOT NULL REFERENCES classification_catalog(key), permissions jsonb NOT NULL,
        valid_from timestamptz NOT NULL, valid_until timestamptz NULL, revoked_at timestamptz NULL,
        row_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        FOREIGN KEY (workspace_id,project_id) REFERENCES projects(workspace_id,id),
        UNIQUE(id,workspace_id,project_id)
      );
      CREATE TABLE project_entitlement_permissions (
        entitlement_id uuid NOT NULL REFERENCES project_entitlements(id), permission_key text NOT NULL,
        PRIMARY KEY(entitlement_id,permission_key)
      );
      CREATE INDEX project_entitlement_authorization_idx ON project_entitlements(workspace_id,project_id,principal_id,effect);
      UPDATE platform_schema_versions SET version=20, applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE project_entitlement_permissions; DROP TABLE project_entitlements; ALTER TABLE role_assignments DROP CONSTRAINT role_assignment_project_scope_fk; DROP TABLE projects; UPDATE platform_schema_versions SET version=10 WHERE namespace='core';",
    );
  }
}
