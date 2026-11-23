import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0070ConnectorDelivery1700000000070 implements MigrationInterface {
  readonly name = "M0070ConnectorDelivery1700000000070";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE connector_commands (
        id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL, actor jsonb NOT NULL,
        capability_key text NOT NULL, capability_version text NOT NULL, operation text NOT NULL,
        target jsonb NOT NULL, payload jsonb NOT NULL, binding_ref jsonb NOT NULL, profile_ref jsonb NOT NULL,
        effect_idempotency_key text NOT NULL UNIQUE, state text NOT NULL, result jsonb NULL,
        correlation_id uuid NOT NULL, causation_id uuid NOT NULL, row_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL,
        PRIMARY KEY(id), UNIQUE(workspace_id,project_id,id), FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id)
      );
      CREATE TABLE command_outbox (
        id uuid PRIMARY KEY, command_id uuid NOT NULL, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
        state text NOT NULL, available_at timestamptz NOT NULL, lease_until timestamptz NULL, next_republish_at timestamptz NULL,
        attempts integer NOT NULL DEFAULT 0, envelope_hash text NOT NULL, created_at timestamptz NOT NULL,
        FOREIGN KEY(workspace_id,project_id,command_id) REFERENCES connector_commands(workspace_id,project_id,id)
      );
      CREATE INDEX command_outbox_delivery_idx ON command_outbox(state,available_at,next_republish_at);
      CREATE TABLE webhook_receipts (connector_key text NOT NULL, delivery_id text NOT NULL, body_hash text NOT NULL, received_at timestamptz NOT NULL, PRIMARY KEY(connector_key,delivery_id));
      CREATE TABLE consumer_inbox (consumer_key text NOT NULL, message_id text NOT NULL, message_hash text NOT NULL, processed_at timestamptz NOT NULL, PRIMARY KEY(consumer_key,message_id));
      CREATE TABLE event_outbox (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL, event_type text NOT NULL, envelope jsonb NOT NULL, envelope_hash text NOT NULL, state text NOT NULL, created_at timestamptz NOT NULL, FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id));
      UPDATE platform_schema_versions SET version=70, applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE event_outbox; DROP TABLE consumer_inbox; DROP TABLE webhook_receipts; DROP TABLE command_outbox; DROP TABLE connector_commands; UPDATE platform_schema_versions SET version=60 WHERE namespace='core';",
    );
  }
}
