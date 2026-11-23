import type { MigrationInterface, QueryRunner } from "typeorm";

export class M4000GitLabDiscoveryProfiles1700000004000 implements MigrationInterface {
  readonly name = "M4000GitLabDiscoveryProfiles1700000004000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION gitlab_reject_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'GITLAB_APPEND_ONLY_MUTATION_FORBIDDEN:%', TG_TABLE_NAME USING ERRCODE='check_violation';
END
$function$;

CREATE TABLE gitlab_discovery_snapshots(
  discovery_snapshot_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  connection_ref jsonb NOT NULL,
  connector_version text NOT NULL,
  adapter_family text NOT NULL CHECK(adapter_family='gitlab-rest-v4'),
  adapter_contract_version text NOT NULL,
  edition text NOT NULL CHECK(edition IN ('CE','EE')),
  exact_version text NOT NULL,
  exact_build text NOT NULL,
  api_family text NOT NULL CHECK(api_family='v4'),
  tls_endpoint_fingerprint text NOT NULL,
  numeric_project_id bigint NOT NULL CHECK(numeric_project_id>0),
  canonical_project_path_hash text NOT NULL,
  default_branch text NULL,
  exact_ref text NOT NULL,
  ref_commit_sha text NOT NULL,
  supported_features jsonb NOT NULL,
  identity_permission_probe_hash text NOT NULL,
  runner_readiness_hash text NOT NULL,
  network_readiness_hash text NOT NULL,
  production_denied boolean NOT NULL CHECK(production_denied),
  sanitized_metadata jsonb NOT NULL,
  schema_ref jsonb NOT NULL,
  schema_digest text NOT NULL,
  content_hash text NOT NULL,
  validation_status text NOT NULL CHECK(validation_status IN ('VALID','INVALID')),
  collected_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK(expires_at>collected_at),
  UNIQUE(workspace_id,discovery_snapshot_id),
  UNIQUE(workspace_id,connection_ref,numeric_project_id,content_hash)
);
CREATE INDEX gitlab_discovery_connection_project
  ON gitlab_discovery_snapshots(workspace_id,numeric_project_id,collected_at DESC);

CREATE TABLE gitlab_profile_validation_details(
  profile_validation_detail_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  profile_ref jsonb NOT NULL,
  candidate_content_hash text NOT NULL,
  discovery_snapshot_id uuid NOT NULL,
  numeric_project_id bigint NOT NULL CHECK(numeric_project_id>0),
  external_scope_hash text NOT NULL,
  allowed_refs_hash text NOT NULL,
  allowed_environments_hash text NOT NULL,
  input_mapping_hash text NOT NULL,
  result_contract_hash text NOT NULL,
  artifact_contract_hash text NOT NULL,
  permission_probe jsonb NOT NULL,
  ci_lint_probe jsonb NOT NULL,
  no_deploy_probe jsonb NOT NULL,
  non_production_probe jsonb NOT NULL,
  lookup_marker_probe jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('VALID','INVALID')),
  issues jsonb NOT NULL,
  preview_hash text NOT NULL,
  probe_set_hash text NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(workspace_id,profile_validation_detail_id),
  UNIQUE(workspace_id,profile_ref,candidate_content_hash,discovery_snapshot_id),
  CONSTRAINT gitlab_profile_validation_discovery_fk
    FOREIGN KEY(workspace_id,discovery_snapshot_id)
    REFERENCES gitlab_discovery_snapshots(workspace_id,discovery_snapshot_id)
);
CREATE INDEX gitlab_profile_validation_profile
  ON gitlab_profile_validation_details(workspace_id,profile_ref,created_at DESC);

CREATE TABLE gitlab_suite_contract_probes(
  suite_contract_probe_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  profile_ref jsonb NOT NULL,
  discovery_snapshot_id uuid NOT NULL,
  numeric_project_id bigint NOT NULL CHECK(numeric_project_id>0),
  suite_key_hash text NOT NULL,
  logical_execution_contract_hash text NOT NULL,
  exact_ref_hash text NOT NULL,
  result_contract_hash text NOT NULL,
  artifact_policy_hash text NOT NULL,
  source_fact_set_hash text NOT NULL,
  dry_run_hash text NOT NULL,
  fixture_result_hash text NOT NULL,
  artifact_probe_hash text NOT NULL,
  status text NOT NULL CHECK(status IN ('VALID','INVALID')),
  issues jsonb NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(workspace_id,suite_contract_probe_id),
  UNIQUE(workspace_id,profile_ref,suite_key_hash,content_hash),
  CONSTRAINT gitlab_suite_probe_discovery_fk
    FOREIGN KEY(workspace_id,discovery_snapshot_id)
    REFERENCES gitlab_discovery_snapshots(workspace_id,discovery_snapshot_id)
);
CREATE INDEX gitlab_suite_probe_profile
  ON gitlab_suite_contract_probes(workspace_id,profile_ref,created_at DESC);

CREATE TRIGGER gitlab_discovery_snapshots_append_only
  BEFORE UPDATE OR DELETE ON gitlab_discovery_snapshots
  FOR EACH ROW EXECUTE FUNCTION gitlab_reject_append_only_mutation();
CREATE TRIGGER gitlab_profile_validation_details_append_only
  BEFORE UPDATE OR DELETE ON gitlab_profile_validation_details
  FOR EACH ROW EXECUTE FUNCTION gitlab_reject_append_only_mutation();
CREATE TRIGGER gitlab_suite_contract_probes_append_only
  BEFORE UPDATE OR DELETE ON gitlab_suite_contract_probes
  FOR EACH ROW EXECUTE FUNCTION gitlab_reject_append_only_mutation();

INSERT INTO platform_schema_versions(namespace,version,applied_at)
VALUES('connector:gitlab',4000,clock_timestamp())
ON CONFLICT(namespace) DO UPDATE SET version=EXCLUDED.version,applied_at=EXCLUDED.applied_at;
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE gitlab_suite_contract_probes;
DROP TABLE gitlab_profile_validation_details;
DROP TABLE gitlab_discovery_snapshots;
DROP FUNCTION gitlab_reject_append_only_mutation();
DELETE FROM platform_schema_versions WHERE namespace='connector:gitlab';
`);
  }
}
