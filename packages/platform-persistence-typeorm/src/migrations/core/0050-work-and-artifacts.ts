import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0050WorkAndArtifacts1700000000050 implements MigrationInterface {
  readonly name = "M0050WorkAndArtifacts1700000000050";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE intake_drafts (
        id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        work_type_definition_id uuid NOT NULL REFERENCES work_type_definitions(id),
        created_by uuid NOT NULL REFERENCES identities(id), state text NOT NULL CHECK(state IN ('DRAFT','SUBMITTED','CANCELLED')),
        intake_payload jsonb NOT NULL, intake_schema_ref jsonb NOT NULL, row_version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL, submitted_at timestamptz NULL,
        PRIMARY KEY(id), UNIQUE(workspace_id,project_id,id), FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE TABLE work_items (
        id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        work_type_definition_id uuid NOT NULL REFERENCES work_type_definitions(id), source_draft_id uuid NULL,
        created_by uuid NOT NULL REFERENCES identities(id), state text NOT NULL,
        classification_key text NOT NULL REFERENCES classification_catalog(key), row_version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL, PRIMARY KEY(id), UNIQUE(workspace_id,project_id,id),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
        FOREIGN KEY(workspace_id,project_id,source_draft_id) REFERENCES intake_drafts(workspace_id,project_id,id)
      );
      CREATE TABLE artifact_references (
        id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        owner_entity_type text NOT NULL, owner_entity_id uuid NOT NULL, artifact_kind text NOT NULL,
        storage_provider_kind text NOT NULL, opaque_locator text NOT NULL, object_version_or_etag text NOT NULL,
        file_name text NOT NULL, media_type text NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes >= 0),
        checksum_algorithm text NOT NULL CHECK(checksum_algorithm IN ('SHA256')), checksum text NOT NULL,
        classification_key text NOT NULL REFERENCES classification_catalog(key),
        availability text NOT NULL CHECK(availability IN ('AVAILABLE','EXPIRED','QUARANTINED','UNAVAILABLE')),
        created_by uuid NOT NULL REFERENCES identities(id), created_at timestamptz NOT NULL, expires_at timestamptz NULL,
        PRIMARY KEY(id), UNIQUE(workspace_id,project_id,id),
        FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      UPDATE platform_schema_versions SET version=50, applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE artifact_references; DROP TABLE work_items; DROP TABLE intake_drafts; UPDATE platform_schema_versions SET version=40 WHERE namespace='core';",
    );
  }
}
