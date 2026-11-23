import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0010IdentityWorkspace1700000000010 implements MigrationInterface {
  readonly name = "M0010IdentityWorkspace1700000000010";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE identities (
        id uuid PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL,
        kind text NOT NULL CHECK (kind IN ('HUMAN','SERVICE')), display_name text NOT NULL,
        row_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        UNIQUE (issuer, subject)
      );
      CREATE TABLE workspaces (
        id uuid PRIMARY KEY, key text NOT NULL UNIQUE, name text NOT NULL,
        state text NOT NULL CHECK (state IN ('ACTIVE','SUSPENDED')),
        row_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE TABLE workspace_memberships (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
        principal_id uuid NOT NULL REFERENCES identities(id), state text NOT NULL CHECK (state IN ('ACTIVE','SUSPENDED','REVOKED')),
        valid_from timestamptz NOT NULL, valid_until timestamptz NULL, revoked_at timestamptz NULL,
        row_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        UNIQUE (workspace_id, principal_id, id)
      );
      CREATE TABLE role_assignments (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), project_id uuid NULL,
        principal_id uuid NOT NULL REFERENCES identities(id), role_key text NOT NULL,
        effect text NOT NULL CHECK (effect IN ('ALLOW','DENY')), permissions jsonb NOT NULL,
        valid_from timestamptz NOT NULL, valid_until timestamptz NULL, revoked_at timestamptz NULL,
        row_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      UPDATE platform_schema_versions SET version=10, applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE role_assignments; DROP TABLE workspace_memberships; DROP TABLE workspaces; DROP TABLE identities; UPDATE platform_schema_versions SET version=1 WHERE namespace='core';",
    );
  }
}
