import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0160ArtifactRetentionExport1700000000160 implements MigrationInterface {
  readonly name = "M0160ArtifactRetentionExport1700000000160";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE artifact_availability_heads(
        artifact_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        current_version integer NOT NULL CHECK(current_version>=1), current_state text NOT NULL CHECK(current_state IN ('AVAILABLE','EXPIRED','QUARANTINED','UNAVAILABLE')),
        row_version bigint NOT NULL DEFAULT 1 CHECK(row_version>=1),
        PRIMARY KEY(artifact_id), UNIQUE(workspace_id,project_id,artifact_id),
        FOREIGN KEY(workspace_id,project_id,artifact_id) REFERENCES artifact_references(workspace_id,project_id,id)
      );
      CREATE TABLE artifact_availability_revisions(
        availability_revision_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, artifact_id uuid NOT NULL,
        version integer NOT NULL CHECK(version>=1), state text NOT NULL CHECK(state IN ('AVAILABLE','EXPIRED','QUARANTINED','UNAVAILABLE')),
        reason_code text NOT NULL, observed_object_version_or_etag text NULL, observed_checksum text NULL,
        observed_at timestamptz NOT NULL, source text NOT NULL CHECK(source IN ('PROVIDER','RETENTION_WORKER','SECURITY_REVIEW')),
        previous_revision_id uuid NULL, previous_version integer NULL, previous_content_hash text NULL,
        semantic_body jsonb NOT NULL, content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(availability_revision_id), UNIQUE(workspace_id,project_id,artifact_id,version),
        UNIQUE(availability_revision_id,workspace_id,project_id,artifact_id,version,content_hash),
        FOREIGN KEY(workspace_id,project_id,artifact_id) REFERENCES artifact_availability_heads(workspace_id,project_id,artifact_id),
        FOREIGN KEY(previous_revision_id,workspace_id,project_id,artifact_id,previous_version,previous_content_hash)
          REFERENCES artifact_availability_revisions(availability_revision_id,workspace_id,project_id,artifact_id,version,content_hash) DEFERRABLE INITIALLY DEFERRED,
        CHECK((version=1 AND previous_revision_id IS NULL AND previous_version IS NULL AND previous_content_hash IS NULL)
          OR (version>1 AND previous_revision_id IS NOT NULL AND previous_version=version-1 AND previous_content_hash IS NOT NULL))
      );
      CREATE TRIGGER artifact_availability_revisions_append_only BEFORE UPDATE OR DELETE ON artifact_availability_revisions FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE artifact_retention_decisions(
        decision_id uuid NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version=1), workspace_id uuid NOT NULL, project_id uuid NOT NULL, artifact_id uuid NOT NULL,
        retention_policy_ref jsonb NOT NULL, legal_hold_ref jsonb NULL,
        decision text NOT NULL CHECK(decision IN ('RETAIN','EXPIRE','QUARANTINE')), eligible_at timestamptz NOT NULL, effective_at timestamptz NULL,
        owner_principal_id uuid NOT NULL REFERENCES identities(id), reason_code text NOT NULL, created_at timestamptz NOT NULL,
        semantic_body jsonb NOT NULL, content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(decision_id), UNIQUE(workspace_id,project_id,decision_id),
        FOREIGN KEY(workspace_id,project_id,artifact_id) REFERENCES artifact_references(workspace_id,project_id,id),
        CHECK(NOT(decision='EXPIRE' AND legal_hold_ref IS NOT NULL AND effective_at IS NOT NULL))
      );
      CREATE TRIGGER artifact_retention_decisions_append_only BEFORE UPDATE OR DELETE ON artifact_retention_decisions FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      CREATE TABLE evidence_export_records(
        export_id uuid NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version=1), workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        subject_ref jsonb NOT NULL, requested_by jsonb NOT NULL, authorization_basis_ref jsonb NOT NULL,
        redaction_policy_ref jsonb NOT NULL, export_policy_ref jsonb NOT NULL,
        included_manifest_refs jsonb NOT NULL, included_artifact_refs jsonb NOT NULL,
        result_hash text NULL CHECK(result_hash IS NULL OR result_hash ~ '^sha256:[a-f0-9]{64}$'),
        status text NOT NULL CHECK(status IN ('COMPLETED','DENIED','FAILED')), safe_reason_code text NULL,
        correlation_id text NOT NULL, created_at timestamptz NOT NULL,
        semantic_body jsonb NOT NULL, content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[a-f0-9]{64}$'),
        PRIMARY KEY(export_id), UNIQUE(workspace_id,project_id,export_id), FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
        CHECK((status='COMPLETED' AND result_hash IS NOT NULL AND safe_reason_code IS NULL) OR (status<>'COMPLETED' AND safe_reason_code IS NOT NULL))
      );
      CREATE INDEX evidence_export_audit_scope_idx ON evidence_export_records(workspace_id,project_id,created_at DESC);
      CREATE TRIGGER evidence_export_records_append_only BEFORE UPDATE OR DELETE ON evidence_export_records FOR EACH ROW EXECUTE FUNCTION awp_append_only();

      INSERT INTO artifact_availability_heads(artifact_id,workspace_id,project_id,current_version,current_state,row_version)
        SELECT id,workspace_id,project_id,1,availability,1 FROM artifact_references;
      INSERT INTO artifact_availability_revisions(availability_revision_id,workspace_id,project_id,artifact_id,version,state,reason_code,observed_object_version_or_etag,observed_checksum,observed_at,source,semantic_body,content_hash)
        SELECT id,workspace_id,project_id,id,1,availability,'HISTORICAL_BOOTSTRAP',object_version_or_etag,checksum,created_at,'PROVIDER',
          jsonb_build_object('artifactId',id,'version',1,'state',availability,'reasonCode','HISTORICAL_BOOTSTRAP','observedChecksum',checksum),
          'sha256:'||md5(id::text||':availability')||md5(workspace_id::text||':'||project_id::text||':'||id::text)
        FROM artifact_references;

      UPDATE platform_schema_versions SET version=160,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE evidence_export_records;
      DROP TABLE artifact_retention_decisions;
      DROP TABLE artifact_availability_revisions;
      DROP TABLE artifact_availability_heads;
      UPDATE platform_schema_versions SET version=155,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
}
