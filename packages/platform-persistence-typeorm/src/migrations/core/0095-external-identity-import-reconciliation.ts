import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0095ExternalIdentityImportReconciliation1700000000095 implements MigrationInterface {
  readonly name = "M0095ExternalIdentityImportReconciliation1700000000095";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE external_principal_bindings (
        id uuid NOT NULL, workspace_id uuid NOT NULL, connection_header_id text NOT NULL, provider_namespace text NOT NULL,
        external_principal_kind text NOT NULL CHECK(external_principal_kind IN ('EXTERNAL_HUMAN','EXTERNAL_SERVICE')),
        external_principal_id text NOT NULL, principal_id uuid NOT NULL,
        state text NOT NULL CHECK(state IN ('PENDING','VERIFIED','REVOKED','CONFLICT')),
        verification_method text NULL, verification_evidence_hash text NULL, verified_by uuid NULL, verified_at timestamptz NULL,
        revoked_by uuid NULL, revoked_at timestamptz NULL, revoke_reason text NULL,
        resource_version bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        PRIMARY KEY(id), UNIQUE(workspace_id,id)
      );
      CREATE UNIQUE INDEX external_principal_active_subject ON external_principal_bindings(workspace_id,connection_header_id,provider_namespace,external_principal_kind,external_principal_id) WHERE state IN ('PENDING','VERIFIED','CONFLICT');
      CREATE TABLE operational_import_intents (
        id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NULL, connection_header_id text NOT NULL,
        connection_ref jsonb NOT NULL, profile_ref jsonb NOT NULL, project_integration_binding_ref jsonb NULL,
        external_entity_type text NOT NULL, external_entity_id text NOT NULL, external_display_key text NOT NULL,
        discovery_source text NOT NULL CHECK(discovery_source IN ('WEBHOOK','IMPORT_RECONCILIATION','OPERATOR_REPLAY')),
        discovery_payload_hash text NOT NULL, authoritative_read_hash text NOT NULL, external_revision_token text NOT NULL,
        external_creator_id text NOT NULL, external_principal_binding_ref jsonb NULL, project_discriminator text NOT NULL,
        state text NOT NULL CHECK(state IN ('DISCOVERED','ROUTED','IDENTITY_VERIFIED','ADOPTED','AWAITING_CONFIRMATION','BLOCKED_MAPPING','FAILED_RETRYABLE','IGNORED_OUT_OF_SCOPE','REJECTED_SECURITY')),
        reason_code text NULL, result_work_item_id uuid NULL, result_binding_id uuid NULL,
        adopted_at timestamptz NULL, next_attempt_at timestamptz NULL, attempt_count integer NOT NULL DEFAULT 0,
        correlation_id uuid NOT NULL, causation_id uuid NOT NULL, resource_version bigint NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        PRIMARY KEY(id), UNIQUE(workspace_id,id), UNIQUE(connection_header_id,external_entity_type,external_entity_id)
      );
      CREATE TABLE reconciliation_cursors (
        id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, profile_ref jsonb NOT NULL, connection_ref jsonb NOT NULL,
        lane text NOT NULL CHECK(lane IN ('IMPORT_DISCOVERY','BOUND_REFRESH','FULL_DRIFT_SWEEP')),
        watermark_updated_at timestamptz NOT NULL, watermark_external_key text NOT NULL, overlap_seconds integer NOT NULL CHECK(overlap_seconds > 0),
        page_size integer NOT NULL CHECK(page_size > 0), max_concurrency integer NOT NULL CHECK(max_concurrency > 0), budget_class text NOT NULL,
        next_due_at timestamptz NOT NULL, last_success_at timestamptz NULL, last_full_success_at timestamptz NULL,
        lease_owner text NULL, lease_token bigint NOT NULL DEFAULT 0, lease_until timestamptz NULL, resource_version bigint NOT NULL DEFAULT 1,
        PRIMARY KEY(id), UNIQUE(workspace_id,project_id,id), UNIQUE(workspace_id,project_id,profile_ref,lane)
      );
      CREATE TABLE reconciliation_runs (
        id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, cursor_id uuid NOT NULL,
        profile_ref jsonb NOT NULL, connection_ref jsonb NOT NULL, lane text NOT NULL,
        start_watermark jsonb NOT NULL, transient_page_state jsonb NULL,
        state text NOT NULL CHECK(state IN ('PENDING','RUNNING','SUCCEEDED','PARTIAL','FAILED','CANCELLED')),
        counts jsonb NOT NULL, rate_limit_snapshot jsonb NULL, terminal_code text NULL,
        started_at timestamptz NOT NULL, finished_at timestamptz NULL, next_retry_at timestamptz NULL,
        correlation_id uuid NOT NULL, resource_version bigint NOT NULL DEFAULT 1,
        PRIMARY KEY(id), UNIQUE(workspace_id,project_id,id),
        FOREIGN KEY(workspace_id,project_id,cursor_id) REFERENCES reconciliation_cursors(workspace_id,project_id,id)
      );
      CREATE TABLE reconciliation_run_items (
        run_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        external_entity_id text NOT NULL, external_key text NOT NULL, provider_updated_at timestamptz NOT NULL,
        result text NOT NULL CHECK(result IN ('APPLIED','DUPLICATE','STALE','GAP','IMPORTED','IGNORED','MAPPING_REQUIRED','NOT_FOUND','ERROR')),
        refs jsonb NOT NULL, safe_code text NULL, content_hash text NOT NULL, duration_ms integer NOT NULL, created_at timestamptz NOT NULL,
        PRIMARY KEY(run_id,external_entity_id,provider_updated_at),
        FOREIGN KEY(workspace_id,project_id,run_id) REFERENCES reconciliation_runs(workspace_id,project_id,id)
      );
      ALTER TABLE work_items ADD CONSTRAINT work_item_acceptance_source_check CHECK(
        acceptance_source IS NULL OR
        (acceptance_source='PLATFORM_DRAFT' AND source_draft_id IS NOT NULL AND operational_import_intent_id IS NULL) OR
        (acceptance_source='OPERATIONAL_IMPORT' AND source_draft_id IS NULL AND operational_import_intent_id IS NOT NULL)
      ) NOT VALID;
      CREATE INDEX operational_import_retry ON operational_import_intents(state,next_attempt_at);
      CREATE INDEX reconciliation_cursor_due ON reconciliation_cursors(next_due_at);
      CREATE INDEX reconciliation_run_state ON reconciliation_runs(state,started_at);
      UPDATE platform_schema_versions SET version=95, applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE work_items DROP CONSTRAINT work_item_acceptance_source_check; DROP TABLE reconciliation_run_items; DROP TABLE reconciliation_runs; DROP TABLE reconciliation_cursors; DROP TABLE operational_import_intents; DROP TABLE external_principal_bindings; UPDATE platform_schema_versions SET version=90 WHERE namespace='core';`,
    );
  }
}
