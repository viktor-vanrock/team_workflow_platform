import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0040IntegrationConfiguration1700000000040 implements MigrationInterface {
  readonly name = "M0040IntegrationConfiguration1700000000040";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE connection_headers (id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), key text NOT NULL, current_published_version integer NULL, row_version integer NOT NULL DEFAULT 1, UNIQUE(workspace_id,key), UNIQUE(workspace_id,id));
      CREATE TABLE connector_mapping_headers (id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), key text NOT NULL, current_published_version integer NULL, row_version integer NOT NULL DEFAULT 1, UNIQUE(workspace_id,key), UNIQUE(workspace_id,id));
      CREATE TABLE connector_profile_headers (id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), key text NOT NULL, current_published_version integer NULL, row_version integer NOT NULL DEFAULT 1, UNIQUE(workspace_id,key), UNIQUE(workspace_id,id));
      CREATE TABLE project_integration_binding_headers (id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), project_id uuid NOT NULL, key text NOT NULL, current_published_version integer NULL, row_version integer NOT NULL DEFAULT 1, FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id), UNIQUE(workspace_id,project_id,key), UNIQUE(workspace_id,id), UNIQUE(workspace_id,project_id,id));
      CREATE TABLE connection_revisions (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, header_id uuid NOT NULL, version integer NOT NULL, status text NOT NULL, content jsonb NOT NULL, content_hash text NOT NULL, created_at timestamptz NOT NULL, FOREIGN KEY(workspace_id,header_id) REFERENCES connection_headers(workspace_id,id), UNIQUE(workspace_id,header_id,version));
      CREATE TABLE connector_mapping_revisions (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, header_id uuid NOT NULL, version integer NOT NULL, status text NOT NULL, content jsonb NOT NULL, content_hash text NOT NULL, created_at timestamptz NOT NULL, FOREIGN KEY(workspace_id,header_id) REFERENCES connector_mapping_headers(workspace_id,id), UNIQUE(workspace_id,header_id,version));
      CREATE TABLE connector_profile_revisions (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, header_id uuid NOT NULL, version integer NOT NULL, status text NOT NULL, content jsonb NOT NULL, content_hash text NOT NULL, created_at timestamptz NOT NULL, FOREIGN KEY(workspace_id,header_id) REFERENCES connector_profile_headers(workspace_id,id), UNIQUE(workspace_id,header_id,version));
      CREATE TABLE project_integration_binding_revisions (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL, header_id uuid NOT NULL, version integer NOT NULL, status text NOT NULL, content jsonb NOT NULL, content_hash text NOT NULL, created_at timestamptz NOT NULL, FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id), FOREIGN KEY(workspace_id,project_id,header_id) REFERENCES project_integration_binding_headers(workspace_id,project_id,id), UNIQUE(workspace_id,header_id,version));
      CREATE TABLE integration_validation_reports (id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), project_id uuid NULL, subject_kind text NOT NULL, subject_id uuid NOT NULL, subject_version integer NOT NULL, outcome text NOT NULL, content_hash text NOT NULL, report jsonb NOT NULL, created_at timestamptz NOT NULL, FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id));
      CREATE TABLE connection_health (workspace_id uuid NOT NULL, connection_id uuid NOT NULL, state text NOT NULL, checked_at timestamptz NOT NULL, details jsonb NOT NULL, PRIMARY KEY(workspace_id,connection_id), FOREIGN KEY(workspace_id,connection_id) REFERENCES connection_headers(workspace_id,id));
      UPDATE platform_schema_versions SET version=40, applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE connection_health; DROP TABLE integration_validation_reports; DROP TABLE project_integration_binding_revisions; DROP TABLE connector_profile_revisions; DROP TABLE connector_mapping_revisions; DROP TABLE connection_revisions; DROP TABLE project_integration_binding_headers; DROP TABLE connector_profile_headers; DROP TABLE connector_mapping_headers; DROP TABLE connection_headers; UPDATE platform_schema_versions SET version=30 WHERE namespace='core';",
    );
  }
}
