import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0030ExtensionRegistry1700000000030 implements MigrationInterface {
  readonly name = "M0030ExtensionRegistry1700000000030";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE competency_pack_registrations (
        id uuid PRIMARY KEY, pack_key text NOT NULL, pack_version text NOT NULL,
        manifest_schema_version integer NOT NULL, required_core_contract_range text NOT NULL,
        manifest_payload jsonb NOT NULL, manifest_hash text NOT NULL,
        registration_status text NOT NULL CHECK (registration_status IN ('REGISTERED','DISABLED')),
        registered_at timestamptz NOT NULL, UNIQUE(pack_key,pack_version)
      );
      CREATE TABLE extension_registration_attempts (
        id uuid PRIMARY KEY, source_component_ref text NOT NULL, observed_kind text NULL,
        observed_key text NULL, observed_version text NULL, observed_hash text NOT NULL,
        outcome text NOT NULL CHECK (outcome IN ('ACCEPTED','REJECTED')), diagnostics jsonb NOT NULL,
        boot_instance_id text NOT NULL, observed_at timestamptz NOT NULL
      );
      CREATE FUNCTION awp_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only table'; END $$;
      CREATE TRIGGER extension_attempt_append_only BEFORE UPDATE OR DELETE ON extension_registration_attempts FOR EACH ROW EXECUTE FUNCTION awp_append_only();
      CREATE TABLE work_type_definitions (
        id uuid PRIMARY KEY, pack_registration_id uuid NOT NULL REFERENCES competency_pack_registrations(id),
        work_type_key text NOT NULL, definition_version text NOT NULL, intake_schema jsonb NOT NULL, intake_schema_hash text NOT NULL,
        required_capabilities jsonb NOT NULL, definition_payload jsonb NOT NULL, definition_hash text NOT NULL,
        lifecycle_status text NOT NULL CHECK (lifecycle_status IN ('ACTIVE','RETIRED')), registered_at timestamptz NOT NULL,
        UNIQUE(work_type_key,definition_version)
      );
      CREATE TABLE workspace_work_types (
        id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), work_type_key text NOT NULL,
        active_definition_id uuid NOT NULL REFERENCES work_type_definitions(id), intake_state text NOT NULL CHECK (intake_state IN ('ENABLED','DISABLED')),
        changed_by uuid NOT NULL REFERENCES identities(id), changed_at timestamptz NOT NULL, reason text NOT NULL, row_version integer NOT NULL DEFAULT 1,
        UNIQUE(workspace_id,work_type_key)
      );
      CREATE TABLE connector_registrations (
        id uuid PRIMARY KEY, connector_key text NOT NULL, connector_version text NOT NULL,
        manifest_payload jsonb NOT NULL, manifest_hash text NOT NULL,
        registration_status text NOT NULL CHECK (registration_status IN ('REGISTERED','DISABLED')), registered_at timestamptz NOT NULL,
        UNIQUE(connector_key,connector_version)
      );
      CREATE TABLE capability_contracts (
        id uuid PRIMARY KEY, capability_key text NOT NULL, contract_version text NOT NULL,
        contract_payload jsonb NOT NULL, schema_hash text NOT NULL,
        lifecycle_status text NOT NULL CHECK (lifecycle_status IN ('ACTIVE','RETIRED')), registered_at timestamptz NOT NULL,
        UNIQUE(capability_key,contract_version)
      );
      CREATE TABLE connector_capability_implementations (
        connector_registration_id uuid NOT NULL REFERENCES connector_registrations(id), capability_key text NOT NULL,
        exact_contract_version text NOT NULL, operation text NOT NULL, handler_component_ref text NOT NULL,
        supported_idempotency_strategies jsonb NOT NULL, supported_confirmation_modes jsonb NOT NULL,
        PRIMARY KEY(connector_registration_id,capability_key,exact_contract_version,operation)
      );
      UPDATE platform_schema_versions SET version=30, applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE connector_capability_implementations; DROP TABLE capability_contracts; DROP TABLE connector_registrations; DROP TABLE workspace_work_types; DROP TABLE work_type_definitions; DROP TRIGGER extension_attempt_append_only ON extension_registration_attempts; DROP TABLE extension_registration_attempts; DROP TABLE competency_pack_registrations; UPDATE platform_schema_versions SET version=20 WHERE namespace='core';",
    );
  }
}
