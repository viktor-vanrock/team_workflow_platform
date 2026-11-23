import type { MigrationInterface, QueryRunner } from "typeorm";

export class M4010GitLabWebhookRateReconciliation1700000004010 implements MigrationInterface {
  readonly name = "M4010GitLabWebhookRateReconciliation1700000004010";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DO $block$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM platform_schema_versions WHERE namespace='connector:gitlab' AND version=4000) THEN
    RAISE EXCEPTION 'GITLAB_MIGRATION_4000_REQUIRED';
  END IF;
END
$block$;

CREATE TABLE gitlab_webhook_receipts(
  webhook_receipt_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  core_inbox_receipt_ref jsonb NOT NULL,
  connection_header_id uuid NOT NULL,
  connection_ref jsonb NOT NULL,
  numeric_project_id bigint NOT NULL CHECK(numeric_project_id>0),
  adapter_family text NOT NULL CHECK(adapter_family='gitlab-rest-v4'),
  adapter_contract_version text NOT NULL,
  webhook_key_version_ref text NOT NULL,
  provider_delivery_id text NOT NULL,
  provider_retry_number integer NULL CHECK(provider_retry_number IS NULL OR provider_retry_number>=0),
  event_kind text NOT NULL CHECK(event_kind IN ('PIPELINE_HOOK','JOB_HOOK')),
  signature_valid boolean NOT NULL,
  freshness_valid boolean NOT NULL,
  replay_valid boolean NOT NULL,
  body_hash text NOT NULL,
  conflict_body_hash text NULL,
  normalized_signal_hash text NULL,
  status text NOT NULL CHECK(status IN ('ACCEPTED','DUPLICATE','REJECTED','SCOPE_PENDING','SECURITY_CONFLICT')),
  reason_code text NULL,
  received_at timestamptz NOT NULL,
  UNIQUE(workspace_id,webhook_receipt_id),
  UNIQUE(connection_header_id,numeric_project_id,provider_delivery_id),
  CHECK((status='SECURITY_CONFLICT')=(conflict_body_hash IS NOT NULL))
);
CREATE INDEX gitlab_webhook_receipt_scope_time
  ON gitlab_webhook_receipts(workspace_id,connection_header_id,numeric_project_id,received_at DESC);

CREATE TABLE gitlab_pipeline_observations(
  pipeline_observation_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  connection_header_id uuid NOT NULL,
  connection_ref jsonb NOT NULL,
  profile_ref jsonb NOT NULL,
  numeric_project_id bigint NOT NULL CHECK(numeric_project_id>0),
  external_pipeline_id text NOT NULL,
  external_job_ids jsonb NOT NULL,
  provider_status text NOT NULL,
  provider_revision_token text NOT NULL,
  provider_updated_at timestamptz NOT NULL,
  source_commit_sha text NOT NULL,
  source_ref_hash text NOT NULL,
  marker_hash text NULL,
  normalized_job_set_hash text NOT NULL,
  source_kind text NOT NULL CHECK(source_kind IN ('WEBHOOK_RECEIPT','POLL','RECONCILIATION')),
  source_ref jsonb NOT NULL,
  observation_hash text NOT NULL,
  observed_at timestamptz NOT NULL,
  UNIQUE(workspace_id,connection_header_id,numeric_project_id,pipeline_observation_id),
  UNIQUE(workspace_id,connection_header_id,numeric_project_id,external_pipeline_id,observation_hash)
);
CREATE INDEX gitlab_pipeline_observation_history
  ON gitlab_pipeline_observations(workspace_id,connection_header_id,numeric_project_id,external_pipeline_id,provider_updated_at DESC);

CREATE TABLE gitlab_pipeline_projection_heads(
  workspace_id uuid NOT NULL,
  connection_header_id uuid NOT NULL,
  numeric_project_id bigint NOT NULL CHECK(numeric_project_id>0),
  external_pipeline_id text NOT NULL,
  current_observation_id uuid NOT NULL,
  current_provider_updated_at timestamptz NOT NULL,
  last_reconciled_at timestamptz NULL,
  last_error_code text NULL,
  resource_version bigint NOT NULL DEFAULT 1 CHECK(resource_version>0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(workspace_id,connection_header_id,numeric_project_id,external_pipeline_id),
  CONSTRAINT gitlab_pipeline_head_observation_fk
    FOREIGN KEY(workspace_id,connection_header_id,numeric_project_id,current_observation_id)
    REFERENCES gitlab_pipeline_observations(workspace_id,connection_header_id,numeric_project_id,pipeline_observation_id)
);

CREATE TABLE gitlab_reconciliation_cursors(
  reconciliation_cursor_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  connection_header_id uuid NOT NULL,
  profile_ref jsonb NOT NULL,
  numeric_project_id bigint NOT NULL CHECK(numeric_project_id>0),
  lane text NOT NULL CHECK(lane IN ('ACTIVE_PIPELINES','WEBHOOK_REPAIR','ARTIFACT_REFRESH')),
  bounded_window_start timestamptz NOT NULL,
  bounded_window_end timestamptz NOT NULL CHECK(bounded_window_end>=bounded_window_start),
  cursor_value_hash text NULL,
  lease_owner text NULL,
  lease_token bigint NOT NULL DEFAULT 0 CHECK(lease_token>=0),
  lease_until timestamptz NULL,
  next_eligible_at timestamptz NOT NULL,
  last_error_code text NULL,
  resource_version bigint NOT NULL DEFAULT 1 CHECK(resource_version>0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(workspace_id,connection_header_id,numeric_project_id,profile_ref,lane)
);
CREATE INDEX gitlab_reconciliation_cursor_due
  ON gitlab_reconciliation_cursors(lane,next_eligible_at,lease_until);

CREATE TABLE gitlab_rate_limit_snapshots(
  rate_limit_snapshot_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  connection_header_id uuid NOT NULL,
  profile_ref jsonb NOT NULL,
  numeric_project_id bigint NOT NULL CHECK(numeric_project_id>0),
  lane text NOT NULL CHECK(lane IN ('DISCOVERY','READ','TRIGGER','ARTIFACT')),
  http_status integer NULL,
  remaining integer NULL CHECK(remaining IS NULL OR remaining>=0),
  reset_at timestamptz NULL,
  retry_after_seconds integer NULL CHECK(retry_after_seconds IS NULL OR retry_after_seconds>=0),
  decision text NOT NULL CHECK(decision IN ('AVAILABLE','BACKOFF','AUTH_DEGRADED','UNAVAILABLE')),
  next_eligible_at timestamptz NULL,
  error_code text NULL,
  observed_at timestamptz NOT NULL,
  content_hash text NOT NULL,
  UNIQUE(workspace_id,rate_limit_snapshot_id),
  UNIQUE(workspace_id,connection_header_id,numeric_project_id,profile_ref,lane,content_hash)
);
CREATE INDEX gitlab_rate_limit_scope_time
  ON gitlab_rate_limit_snapshots(workspace_id,connection_header_id,numeric_project_id,lane,observed_at DESC);

CREATE OR REPLACE FUNCTION gitlab_guard_webhook_receipt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'GITLAB_WEBHOOK_RECEIPT_DELETE_FORBIDDEN' USING ERRCODE='check_violation';
  END IF;
  IF OLD.status NOT IN ('ACCEPTED','DUPLICATE','SCOPE_PENDING') OR NEW.status<>'SECURITY_CONFLICT'
     OR NEW.conflict_body_hash IS NULL
     OR (to_jsonb(NEW)-ARRAY['status','conflict_body_hash','reason_code'])
        IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','conflict_body_hash','reason_code']) THEN
    RAISE EXCEPTION 'GITLAB_WEBHOOK_RECEIPT_MUTATION_FORBIDDEN' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION gitlab_guard_pipeline_head()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE observation_time timestamptz;
BEGIN
  SELECT provider_updated_at INTO observation_time
  FROM gitlab_pipeline_observations
  WHERE workspace_id=NEW.workspace_id AND connection_header_id=NEW.connection_header_id
    AND numeric_project_id=NEW.numeric_project_id AND pipeline_observation_id=NEW.current_observation_id
    AND external_pipeline_id=NEW.external_pipeline_id;
  IF observation_time IS NULL OR observation_time<>NEW.current_provider_updated_at THEN
    RAISE EXCEPTION 'GITLAB_PIPELINE_HEAD_SCOPE_INVALID' USING ERRCODE='foreign_key_violation';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.resource_version<>OLD.resource_version+1 OR NEW.current_provider_updated_at<OLD.current_provider_updated_at) THEN
    RAISE EXCEPTION 'GITLAB_PIPELINE_HEAD_REGRESSION' USING ERRCODE='serialization_failure';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION gitlab_guard_reconciliation_cursor()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF TG_OP='DELETE' OR NEW.resource_version<>OLD.resource_version+1 OR NEW.lease_token<OLD.lease_token THEN
    RAISE EXCEPTION 'GITLAB_RECONCILIATION_CURSOR_CAS_INVALID' USING ERRCODE='serialization_failure';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER gitlab_webhook_receipts_guard
  BEFORE UPDATE OR DELETE ON gitlab_webhook_receipts
  FOR EACH ROW EXECUTE FUNCTION gitlab_guard_webhook_receipt_mutation();
CREATE TRIGGER gitlab_pipeline_observations_append_only
  BEFORE UPDATE OR DELETE ON gitlab_pipeline_observations
  FOR EACH ROW EXECUTE FUNCTION gitlab_reject_append_only_mutation();
CREATE TRIGGER gitlab_pipeline_projection_heads_guard
  BEFORE INSERT OR UPDATE ON gitlab_pipeline_projection_heads
  FOR EACH ROW EXECUTE FUNCTION gitlab_guard_pipeline_head();
CREATE TRIGGER gitlab_reconciliation_cursors_guard
  BEFORE UPDATE OR DELETE ON gitlab_reconciliation_cursors
  FOR EACH ROW EXECUTE FUNCTION gitlab_guard_reconciliation_cursor();
CREATE TRIGGER gitlab_rate_limit_snapshots_append_only
  BEFORE UPDATE OR DELETE ON gitlab_rate_limit_snapshots
  FOR EACH ROW EXECUTE FUNCTION gitlab_reject_append_only_mutation();

UPDATE platform_schema_versions SET version=4010,applied_at=clock_timestamp()
WHERE namespace='connector:gitlab';
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE gitlab_rate_limit_snapshots;
DROP TABLE gitlab_reconciliation_cursors;
DROP TABLE gitlab_pipeline_projection_heads;
DROP TABLE gitlab_pipeline_observations;
DROP TABLE gitlab_webhook_receipts;
DROP FUNCTION gitlab_guard_reconciliation_cursor();
DROP FUNCTION gitlab_guard_pipeline_head();
DROP FUNCTION gitlab_guard_webhook_receipt_mutation();
UPDATE platform_schema_versions SET version=4000,applied_at=clock_timestamp()
WHERE namespace='connector:gitlab';
`);
  }
}
