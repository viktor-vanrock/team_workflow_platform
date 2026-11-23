import type { MigrationInterface, QueryRunner } from "typeorm";

export class M4020GitLabEffectArtifactReconciliation1700000004020 implements MigrationInterface {
  readonly name = "M4020GitLabEffectArtifactReconciliation1700000004020";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DO $block$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM platform_schema_versions WHERE namespace='connector:gitlab' AND version=4010) THEN
    RAISE EXCEPTION 'GITLAB_MIGRATION_4010_REQUIRED';
  END IF;
END
$block$;

CREATE TABLE gitlab_effect_reconciliations(
  effect_reconciliation_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  command_id uuid NOT NULL,
  effect_id text NOT NULL,
  connection_header_id uuid NOT NULL,
  connection_ref jsonb NOT NULL,
  profile_ref jsonb NOT NULL,
  numeric_project_id bigint NOT NULL CHECK(numeric_project_id>0),
  exact_ref_hash text NOT NULL,
  expected_commit_sha text NOT NULL,
  trigger_request_hash text NOT NULL,
  payload_hash text NOT NULL,
  marker_hash text NOT NULL,
  creation_window_start timestamptz NOT NULL,
  creation_window_end timestamptz NOT NULL CHECK(creation_window_end>=creation_window_start),
  effect_invocation_started_at timestamptz NULL,
  state text NOT NULL CHECK(state IN ('NOT_STARTED','EFFECT_STARTED','LOOKUP_REQUIRED','ONE_FOUND','CONFIRMED','AMBIGUOUS','FAILED_FINAL')),
  external_pipeline_id text NULL,
  lookup_query_hash text NULL,
  match_count integer NULL CHECK(match_count IS NULL OR match_count>=0),
  receipt_hash text NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0 AND attempt_count<=2),
  next_retry_at timestamptz NULL,
  lease_owner text NULL,
  lease_token bigint NOT NULL DEFAULT 0 CHECK(lease_token>=0),
  lease_until timestamptz NULL,
  resource_version bigint NOT NULL DEFAULT 1 CHECK(resource_version>0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(effect_id),
  UNIQUE(workspace_id,effect_reconciliation_id),
  UNIQUE(workspace_id,connection_header_id,numeric_project_id,effect_reconciliation_id),
  CHECK((state='NOT_STARTED' AND effect_invocation_started_at IS NULL)
    OR (state IN ('EFFECT_STARTED','LOOKUP_REQUIRED','ONE_FOUND','CONFIRMED','AMBIGUOUS') AND effect_invocation_started_at IS NOT NULL)
    OR state='FAILED_FINAL'),
  CHECK((state IN ('ONE_FOUND','CONFIRMED'))=(external_pipeline_id IS NOT NULL))
);
CREATE UNIQUE INDEX gitlab_effect_confirmed_pipeline
  ON gitlab_effect_reconciliations(connection_header_id,numeric_project_id,external_pipeline_id)
  WHERE external_pipeline_id IS NOT NULL;
CREATE INDEX gitlab_effect_reconciliation_due
  ON gitlab_effect_reconciliations(state,next_retry_at,lease_until);

CREATE TABLE gitlab_effect_lookup_observations(
  effect_lookup_observation_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  connection_header_id uuid NOT NULL,
  numeric_project_id bigint NOT NULL CHECK(numeric_project_id>0),
  effect_reconciliation_id uuid NOT NULL,
  lookup_query_hash text NOT NULL,
  observed_window_start timestamptz NOT NULL,
  observed_window_end timestamptz NOT NULL CHECK(observed_window_end>=observed_window_start),
  outcome text NOT NULL CHECK(outcome IN ('ZERO','EXACT_ONE','MULTIPLE')),
  match_count integer NOT NULL CHECK(match_count>=0),
  match_commitment_hashes jsonb NOT NULL,
  receipt_hash text NULL,
  observation_hash text NOT NULL,
  observed_at timestamptz NOT NULL,
  UNIQUE(workspace_id,effect_lookup_observation_id),
  UNIQUE(workspace_id,effect_reconciliation_id,observation_hash),
  CONSTRAINT gitlab_effect_lookup_reconciliation_fk
    FOREIGN KEY(workspace_id,connection_header_id,numeric_project_id,effect_reconciliation_id)
    REFERENCES gitlab_effect_reconciliations(workspace_id,connection_header_id,numeric_project_id,effect_reconciliation_id),
  CHECK((outcome='ZERO' AND match_count=0 AND receipt_hash IS NULL)
    OR (outcome='EXACT_ONE' AND match_count=1 AND receipt_hash IS NOT NULL)
    OR (outcome='MULTIPLE' AND match_count>1 AND receipt_hash IS NULL))
);
CREATE INDEX gitlab_effect_lookup_history
  ON gitlab_effect_lookup_observations(workspace_id,effect_reconciliation_id,observed_at);

CREATE TABLE gitlab_artifact_locator_revisions(
  artifact_locator_revision_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  core_artifact_reference_id uuid NOT NULL,
  connection_header_id uuid NOT NULL,
  connection_ref jsonb NOT NULL,
  profile_ref jsonb NOT NULL,
  numeric_project_id bigint NOT NULL CHECK(numeric_project_id>0),
  external_pipeline_id text NOT NULL,
  external_job_id text NOT NULL,
  artifact_path_hash text NOT NULL,
  sealed_locator bytea NOT NULL,
  checksum text NOT NULL,
  byte_size bigint NOT NULL CHECK(byte_size>=0),
  media_type text NOT NULL,
  artifact_kind text NOT NULL CHECK(artifact_kind IN ('RESULT','REPORT','LOG','SCREENSHOT','TRACE','OTHER')),
  classification text NOT NULL CHECK(classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED')),
  provider_expires_at timestamptz NOT NULL,
  descriptor_hash text NOT NULL,
  content_hash text NOT NULL,
  availability text NOT NULL CHECK(availability IN ('AVAILABLE','EXPIRED','MISSING','CHECKSUM_MISMATCH')),
  observed_at timestamptz NOT NULL,
  previous_revision_id uuid NULL,
  UNIQUE(workspace_id,artifact_locator_revision_id),
  UNIQUE(workspace_id,core_artifact_reference_id,content_hash),
  CONSTRAINT gitlab_artifact_locator_previous_fk
    FOREIGN KEY(workspace_id,previous_revision_id)
    REFERENCES gitlab_artifact_locator_revisions(workspace_id,artifact_locator_revision_id),
  CHECK(previous_revision_id IS NULL OR previous_revision_id<>artifact_locator_revision_id)
);
CREATE INDEX gitlab_artifact_locator_history
  ON gitlab_artifact_locator_revisions(workspace_id,core_artifact_reference_id,observed_at DESC);

CREATE TABLE gitlab_artifact_stream_receipts(
  artifact_stream_receipt_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  authorized_request_ref jsonb NOT NULL,
  artifact_locator_revision_id uuid NOT NULL,
  streamed_checksum text NULL,
  streamed_bytes bigint NULL CHECK(streamed_bytes IS NULL OR streamed_bytes>=0),
  outcome text NOT NULL CHECK(outcome IN ('STREAMED','EXPIRED','MISSING','CHECKSUM_MISMATCH','DENIED','PROVIDER_ERROR')),
  error_code text NULL,
  correlation_id text NOT NULL,
  content_hash text NOT NULL,
  streamed_at timestamptz NOT NULL,
  UNIQUE(workspace_id,artifact_stream_receipt_id),
  UNIQUE(workspace_id,authorized_request_ref,artifact_locator_revision_id,content_hash),
  CONSTRAINT gitlab_artifact_stream_locator_fk
    FOREIGN KEY(workspace_id,artifact_locator_revision_id)
    REFERENCES gitlab_artifact_locator_revisions(workspace_id,artifact_locator_revision_id),
  CHECK((outcome='STREAMED' AND streamed_checksum IS NOT NULL AND streamed_bytes IS NOT NULL AND error_code IS NULL)
    OR (outcome<>'STREAMED' AND error_code IS NOT NULL))
);

CREATE OR REPLACE FUNCTION gitlab_guard_effect_reconciliation()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE allowed boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'GITLAB_EFFECT_RECONCILIATION_DELETE_FORBIDDEN' USING ERRCODE='check_violation';
  END IF;
  allowed := CASE OLD.state
    WHEN 'NOT_STARTED' THEN NEW.state IN ('NOT_STARTED','EFFECT_STARTED','FAILED_FINAL')
    WHEN 'EFFECT_STARTED' THEN NEW.state IN ('EFFECT_STARTED','LOOKUP_REQUIRED','ONE_FOUND','AMBIGUOUS','FAILED_FINAL')
    WHEN 'LOOKUP_REQUIRED' THEN NEW.state IN ('LOOKUP_REQUIRED','ONE_FOUND','AMBIGUOUS','FAILED_FINAL')
    WHEN 'ONE_FOUND' THEN NEW.state IN ('ONE_FOUND','CONFIRMED','AMBIGUOUS','FAILED_FINAL')
    WHEN 'CONFIRMED' THEN NEW.state='CONFIRMED'
    WHEN 'AMBIGUOUS' THEN NEW.state='AMBIGUOUS'
    WHEN 'FAILED_FINAL' THEN NEW.state='FAILED_FINAL'
    ELSE false
  END;
  IF NOT allowed OR NEW.resource_version<>OLD.resource_version+1 OR NEW.lease_token<OLD.lease_token THEN
    RAISE EXCEPTION 'GITLAB_EFFECT_RECONCILIATION_TRANSITION_INVALID' USING ERRCODE='serialization_failure';
  END IF;
  IF OLD.effect_invocation_started_at IS NOT NULL
     AND NEW.effect_invocation_started_at IS DISTINCT FROM OLD.effect_invocation_started_at THEN
    RAISE EXCEPTION 'GITLAB_EFFECT_INVOCATION_MARKER_IMMUTABLE' USING ERRCODE='check_violation';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['state','external_pipeline_id','lookup_query_hash','match_count','receipt_hash','attempt_count','next_retry_at','lease_owner','lease_token','lease_until','resource_version','updated_at','effect_invocation_started_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['state','external_pipeline_id','lookup_query_hash','match_count','receipt_hash','attempt_count','next_retry_at','lease_owner','lease_token','lease_until','resource_version','updated_at','effect_invocation_started_at']) THEN
    RAISE EXCEPTION 'GITLAB_EFFECT_IDENTITY_IMMUTABLE' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER gitlab_effect_reconciliations_guard
  BEFORE UPDATE OR DELETE ON gitlab_effect_reconciliations
  FOR EACH ROW EXECUTE FUNCTION gitlab_guard_effect_reconciliation();
CREATE TRIGGER gitlab_effect_lookup_observations_append_only
  BEFORE UPDATE OR DELETE ON gitlab_effect_lookup_observations
  FOR EACH ROW EXECUTE FUNCTION gitlab_reject_append_only_mutation();
CREATE TRIGGER gitlab_artifact_locator_revisions_append_only
  BEFORE UPDATE OR DELETE ON gitlab_artifact_locator_revisions
  FOR EACH ROW EXECUTE FUNCTION gitlab_reject_append_only_mutation();
CREATE TRIGGER gitlab_artifact_stream_receipts_append_only
  BEFORE UPDATE OR DELETE ON gitlab_artifact_stream_receipts
  FOR EACH ROW EXECUTE FUNCTION gitlab_reject_append_only_mutation();

UPDATE platform_schema_versions SET version=4020,applied_at=clock_timestamp()
WHERE namespace='connector:gitlab';
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE gitlab_artifact_stream_receipts;
DROP TABLE gitlab_artifact_locator_revisions;
DROP TABLE gitlab_effect_lookup_observations;
DROP TABLE gitlab_effect_reconciliations;
DROP FUNCTION gitlab_guard_effect_reconciliation();
UPDATE platform_schema_versions SET version=4010,applied_at=clock_timestamp()
WHERE namespace='connector:gitlab';
`);
  }
}
