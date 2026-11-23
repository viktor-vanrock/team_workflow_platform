import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0090OperationalAuthority1700000000090 implements MigrationInterface {
  readonly name = "M0090OperationalAuthority1700000000090";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE work_items
        ADD COLUMN IF NOT EXISTS acceptance_source text NULL,
        ADD COLUMN IF NOT EXISTS operational_import_intent_id uuid NULL,
        ADD COLUMN IF NOT EXISTS operational_binding_id uuid NULL,
        ADD COLUMN IF NOT EXISTS title text NULL,
        ADD COLUMN IF NOT EXISTS normalized_status text NULL,
        ADD COLUMN IF NOT EXISTS requester_principal_id uuid NULL,
        ADD COLUMN IF NOT EXISTS assignee_principal_id uuid NULL,
        ADD COLUMN IF NOT EXISTS updated_at timestamptz NULL;

      CREATE TABLE operational_bindings (
        id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, work_item_id uuid NOT NULL,
        project_integration_binding_ref jsonb NOT NULL, connector_profile_ref jsonb NOT NULL,
        connection_header_id text NOT NULL, connection_ref jsonb NOT NULL, mapping_ref jsonb NOT NULL,
        adapter_family text NOT NULL, adapter_contract_version text NOT NULL,
        external_entity_type text NOT NULL, external_entity_id text NOT NULL,
        initial_external_display_key text NOT NULL, current_external_display_key text NOT NULL,
        acceptance_source text NOT NULL CHECK(acceptance_source IN ('CREATE_READ_BACK','VERIFIED_IMPORT')),
        current_projection_revision_id uuid NULL, current_external_revision_token text NULL,
        sync_state text NOT NULL CHECK(sync_state IN ('SYNCED','ERROR','CONFLICT','MAPPING_REQUIRED','AUTH_BLOCKED')),
        freshness_state text NOT NULL CHECK(freshness_state IN ('CURRENT','STALE','UNKNOWN')),
        fresh_until timestamptz NULL, last_observed_at timestamptz NULL, last_webhook_at timestamptz NULL,
        last_reconciled_at timestamptz NULL, last_error_code text NULL,
        created_at timestamptz NOT NULL, created_by uuid NOT NULL, updated_at timestamptz NOT NULL, row_version bigint NOT NULL DEFAULT 1,
        PRIMARY KEY(id), UNIQUE(workspace_id,project_id,id), UNIQUE(workspace_id,project_id,work_item_id),
        UNIQUE(connection_header_id,external_entity_type,external_entity_id),
        FOREIGN KEY(workspace_id,project_id,work_item_id) REFERENCES work_items(workspace_id,project_id,id)
      );
      CREATE TABLE operational_projection_revisions (
        id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, binding_id uuid NOT NULL,
        revision integer NOT NULL CHECK(revision > 0), observation_id text NOT NULL, observation_source text NOT NULL,
        configuration_refs jsonb NOT NULL, external_entity_id text NOT NULL, external_display_key text NOT NULL,
        external_web_url text NULL, external_revision_token text NOT NULL, authority_fields_hash text NOT NULL,
        observation_hash text NOT NULL, provider_updated_at timestamptz NOT NULL, provider_changelog_id text NULL,
        authority_snapshot jsonb NOT NULL, observed_at timestamptz NOT NULL, applied_at timestamptz NOT NULL,
        correlation_id uuid NOT NULL, causation_id uuid NOT NULL,
        PRIMARY KEY(id), UNIQUE(workspace_id,project_id,id), UNIQUE(binding_id,revision), UNIQUE(binding_id,observation_hash),
        FOREIGN KEY(workspace_id,project_id,binding_id) REFERENCES operational_bindings(workspace_id,project_id,id)
      );
      ALTER TABLE operational_bindings ADD CONSTRAINT operational_binding_current_projection_fk
        FOREIGN KEY(workspace_id,project_id,current_projection_revision_id)
        REFERENCES operational_projection_revisions(workspace_id,project_id,id) DEFERRABLE INITIALLY DEFERRED;
      ALTER TABLE work_items ADD CONSTRAINT work_item_operational_binding_fk
        FOREIGN KEY(workspace_id,project_id,operational_binding_id)
        REFERENCES operational_bindings(workspace_id,project_id,id) DEFERRABLE INITIALLY DEFERRED;

      CREATE TABLE operational_sync_conflicts (
        id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, binding_id uuid NOT NULL,
        command_id uuid NOT NULL, approval_id uuid NOT NULL, operation text NOT NULL,
        expected_external_revision_token text NOT NULL, expected_value_hash text NOT NULL,
        observed_external_revision_token text NOT NULL, observed_value_hash text NOT NULL,
        observed_projection_revision_id uuid NOT NULL, configuration_refs jsonb NOT NULL,
        reason_code text NOT NULL, state text NOT NULL CHECK(state IN ('OPEN','ACKNOWLEDGED','RESOLVED','SUPERSEDED')),
        detected_at timestamptz NOT NULL, resolution jsonb NULL, row_version bigint NOT NULL DEFAULT 1,
        PRIMARY KEY(id), UNIQUE(workspace_id,project_id,id),
        FOREIGN KEY(workspace_id,project_id,binding_id) REFERENCES operational_bindings(workspace_id,project_id,id),
        FOREIGN KEY(workspace_id,project_id,observed_projection_revision_id) REFERENCES operational_projection_revisions(workspace_id,project_id,id)
      );
      CREATE TABLE connector_command_configuration_pins (
        command_id uuid NOT NULL REFERENCES connector_commands(id), sequence integer NOT NULL CHECK(sequence >= 0),
        purpose text NOT NULL CHECK(purpose IN ('PRIMARY','AUXILIARY')), requirement_key text NOT NULL, logical_role text NOT NULL,
        project_integration_binding_ref jsonb NOT NULL, connector_profile_ref jsonb NOT NULL, mapping_ref jsonb NOT NULL,
        connection_ref jsonb NOT NULL, content_hash text NOT NULL, adapter_family text NOT NULL,
        adapter_contract_version text NOT NULL, authority_namespace_hash text NOT NULL,
        PRIMARY KEY(command_id,sequence), UNIQUE(command_id,logical_role)
      );
      CREATE UNIQUE INDEX connector_command_one_primary ON connector_command_configuration_pins(command_id) WHERE purpose='PRIMARY';
      CREATE TABLE connector_target_execution_lanes (
        connection_header_id text NOT NULL, external_entity_type text NOT NULL, external_entity_id text NOT NULL,
        active_command_id uuid NULL REFERENCES connector_commands(id), effect_id text NULL, lease_token bigint NOT NULL DEFAULT 0,
        lease_expires_at timestamptz NULL, attempt integer NOT NULL DEFAULT 0,
        state text NOT NULL CHECK(state IN ('CLAIMED','EFFECT_STARTED','AWAITING_RECONCILIATION','RELEASED')),
        resource_version bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
        PRIMARY KEY(connection_header_id,external_entity_type,external_entity_id)
      );
      ALTER TABLE webhook_receipts
        ADD COLUMN IF NOT EXISTS raw_body bytea NULL,
        ADD COLUMN IF NOT EXISTS content_type text NULL,
        ADD COLUMN IF NOT EXISTS body_size bigint NULL,
        ADD COLUMN IF NOT EXISTS verification_result text NULL,
        ADD COLUMN IF NOT EXISTS secret_key_version text NULL,
        ADD COLUMN IF NOT EXISTS retention_until timestamptz NULL;
      CREATE INDEX operational_bindings_scope_health ON operational_bindings(workspace_id,project_id,sync_state,freshness_state,fresh_until);
      CREATE INDEX operational_projection_binding_revision ON operational_projection_revisions(binding_id,revision DESC);
      CREATE INDEX operational_conflicts_open ON operational_sync_conflicts(workspace_id,project_id,state) WHERE state IN ('OPEN','ACKNOWLEDGED');
      CREATE INDEX connector_target_lane_lease ON connector_target_execution_lanes(lease_expires_at);
      UPDATE platform_schema_versions SET version=90, applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE connector_target_execution_lanes; DROP TABLE connector_command_configuration_pins; DROP TABLE operational_sync_conflicts; ALTER TABLE work_items DROP CONSTRAINT work_item_operational_binding_fk; ALTER TABLE operational_bindings DROP CONSTRAINT operational_binding_current_projection_fk; DROP TABLE operational_projection_revisions; DROP TABLE operational_bindings; UPDATE platform_schema_versions SET version=80 WHERE namespace='core';`,
    );
  }
}
