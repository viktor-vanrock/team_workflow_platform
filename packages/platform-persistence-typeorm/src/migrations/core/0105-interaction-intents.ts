import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0105InteractionIntents1700000000105 implements MigrationInterface {
  readonly name = "M0105InteractionIntents1700000000105";
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE external_interaction_receipts(id uuid PRIMARY KEY,workspace_id uuid NOT NULL,project_id uuid NOT NULL,connection_id text NOT NULL,transport_kind text NOT NULL,transport_attempt_key text NOT NULL,external_delivery_id text NULL,body_hash text NOT NULL,normalized_envelope jsonb NOT NULL,state text NOT NULL,result_ref text NULL,received_at timestamptz NOT NULL,retain_until timestamptz NOT NULL,UNIQUE(connection_id,transport_kind,transport_attempt_key));CREATE TABLE interaction_intents(id text PRIMARY KEY,workspace_id uuid NOT NULL,project_id uuid NOT NULL,actor_principal_id uuid NOT NULL,action jsonb NOT NULL,subject jsonb NOT NULL,transport jsonb NOT NULL,nonce_hash text NOT NULL UNIQUE,token_handling jsonb NOT NULL,state text NOT NULL,result_ref text NULL,result_hash text NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL,UNIQUE(workspace_id,project_id,id));CREATE TABLE interaction_presentation_secrets(id text PRIMARY KEY,workspace_id uuid NOT NULL,project_id uuid NOT NULL,intent_id text NOT NULL,capsule jsonb NOT NULL,aad_hash text NOT NULL,ciphertext bytea NOT NULL,ciphertext_hash text NOT NULL,retain_until timestamptz NOT NULL,erased_at timestamptz NULL,UNIQUE(intent_id));UPDATE platform_schema_versions SET version=105,applied_at=clock_timestamp() WHERE namespace='core';`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP TABLE interaction_presentation_secrets;DROP TABLE interaction_intents;DROP TABLE external_interaction_receipts;UPDATE platform_schema_versions SET version=100 WHERE namespace='core';`,
    );
  }
}
