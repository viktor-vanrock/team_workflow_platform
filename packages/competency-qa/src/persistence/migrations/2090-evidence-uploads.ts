import type { MigrationInterface, QueryRunner } from "typeorm";

export class QaEvidenceUploads20901700000002090 implements MigrationInterface {
  readonly name = "QaEvidenceUploads20901700000002090";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE qa_evidence_uploads (
        id uuid PRIMARY KEY, content_upload_ref uuid NOT NULL UNIQUE,
        workspace_id uuid NOT NULL, project_id uuid NOT NULL, work_item_id uuid NOT NULL, session_id text NOT NULL,
        actor_id uuid NOT NULL REFERENCES identities(id), owner jsonb NOT NULL,
        media_type text NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
        classification_key text NOT NULL REFERENCES classification_catalog(key), storage_policy_ref jsonb NOT NULL,
        artifact_id uuid NOT NULL UNIQUE, evidence_link_id uuid NOT NULL UNIQUE,
        state text NOT NULL CHECK(state IN ('AUTHORIZED','UPLOAD_PENDING','UPLOADED','FINALIZED')),
        row_version integer NOT NULL CHECK(row_version BETWEEN 1 AND 3),
        checksum text NULL CHECK(checksum ~ '^sha256:[a-f0-9]{64}$'), storage_ref jsonb NULL,
        lease_id uuid NULL, lease_until timestamptz NULL, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
        finalized_at timestamptz NULL, authorization_basis_hash text NOT NULL CHECK(authorization_basis_hash ~ '^sha256:[a-f0-9]{64}$'),
        UNIQUE(workspace_id,project_id,id),
        FOREIGN KEY(workspace_id,project_id,work_item_id) REFERENCES work_items(workspace_id,project_id,id),
        FOREIGN KEY(session_id,workspace_id,project_id) REFERENCES qa_test_sessions(session_id,workspace_id,project_id),
        CHECK(expires_at>created_at),
        CHECK((state='AUTHORIZED' AND row_version=1 AND checksum IS NULL AND storage_ref IS NULL AND lease_id IS NULL AND lease_until IS NULL AND finalized_at IS NULL)
          OR (state='UPLOAD_PENDING' AND row_version=1 AND checksum IS NOT NULL AND storage_ref IS NULL AND lease_id IS NOT NULL AND lease_until IS NOT NULL AND finalized_at IS NULL)
          OR (state='UPLOADED' AND row_version=2 AND checksum IS NOT NULL AND storage_ref IS NOT NULL AND lease_id IS NULL AND lease_until IS NULL AND finalized_at IS NULL)
          OR (state='FINALIZED' AND row_version=3 AND checksum IS NOT NULL AND storage_ref IS NOT NULL AND lease_id IS NULL AND lease_until IS NULL AND finalized_at IS NOT NULL))
      );
      CREATE INDEX qa_evidence_upload_expiry ON qa_evidence_uploads(expires_at) WHERE state<>'FINALIZED';
      CREATE FUNCTION qa_evidence_upload_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$
      BEGIN
        IF ROW(NEW.id,NEW.content_upload_ref,NEW.workspace_id,NEW.project_id,NEW.work_item_id,NEW.session_id,NEW.actor_id,NEW.owner,
          NEW.media_type,NEW.size_bytes,NEW.classification_key,NEW.storage_policy_ref,NEW.artifact_id,NEW.evidence_link_id,NEW.created_at,NEW.expires_at,NEW.authorization_basis_hash)
          IS DISTINCT FROM ROW(OLD.id,OLD.content_upload_ref,OLD.workspace_id,OLD.project_id,OLD.work_item_id,OLD.session_id,OLD.actor_id,OLD.owner,
          OLD.media_type,OLD.size_bytes,OLD.classification_key,OLD.storage_policy_ref,OLD.artifact_id,OLD.evidence_link_id,OLD.created_at,OLD.expires_at,OLD.authorization_basis_hash)
          OR (OLD.checksum IS NOT NULL AND NEW.checksum IS DISTINCT FROM OLD.checksum)
          OR (OLD.storage_ref IS NOT NULL AND NEW.storage_ref IS DISTINCT FROM OLD.storage_ref)
          OR OLD.state='FINALIZED'
          OR NOT ((OLD.state='AUTHORIZED' AND NEW.state='UPLOAD_PENDING') OR (OLD.state='UPLOAD_PENDING' AND NEW.state IN ('UPLOAD_PENDING','UPLOADED')) OR (OLD.state='UPLOADED' AND NEW.state='FINALIZED'))
        THEN RAISE EXCEPTION 'QA_EVIDENCE_UPLOAD_IMMUTABLE_CONFLICT'; END IF;
        RETURN NEW;
      END; $guard$;
      CREATE TRIGGER qa_evidence_upload_immutable BEFORE UPDATE ON qa_evidence_uploads FOR EACH ROW EXECUTE FUNCTION qa_evidence_upload_guard();
      UPDATE platform_schema_versions SET version=2090,applied_at=clock_timestamp() WHERE namespace='pack:qa';
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      "DROP TABLE qa_evidence_uploads; DROP FUNCTION qa_evidence_upload_guard(); UPDATE platform_schema_versions SET version=2085,applied_at=clock_timestamp() WHERE namespace='pack:qa';",
    );
  }
}
