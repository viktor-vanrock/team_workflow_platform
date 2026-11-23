import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0120NotificationIntents1700000000120 implements MigrationInterface {
  readonly name = "M0120NotificationIntents1700000000120";
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE notification_intents(id text PRIMARY KEY,workspace_id uuid NOT NULL,project_id uuid NOT NULL,dedupe_key text NOT NULL,source_event_ref text NOT NULL,target jsonb NOT NULL,target_hash text NOT NULL,payload_hash text NOT NULL,render_hash text NOT NULL,command_id uuid NOT NULL,state text NOT NULL,reconciliation jsonb NULL,expires_at timestamptz NOT NULL,row_version bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL,UNIQUE(workspace_id,project_id,dedupe_key),UNIQUE(command_id));CREATE TABLE notification_delivery_attempts(notification_intent_id text NOT NULL,attempt integer NOT NULL,fence bigint NOT NULL,started_at timestamptz NOT NULL,effect_invocation_started_at timestamptz NULL,outcome text NULL,selector_hash text NULL,PRIMARY KEY(notification_intent_id,attempt));UPDATE platform_schema_versions SET version=120,applied_at=clock_timestamp() WHERE namespace='core';`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP TABLE notification_delivery_attempts;DROP TABLE notification_intents;UPDATE platform_schema_versions SET version=110 WHERE namespace='core';`,
    );
  }
}
