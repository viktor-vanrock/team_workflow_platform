import type { MigrationInterface, QueryRunner } from "typeorm";

export class OperationalDefects00221700000002002 implements MigrationInterface {
  readonly name = "OperationalDefects00221700000002002";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
    CREATE TABLE operational_defects(
      external_entity_id text PRIMARY KEY,workspace_id uuid NOT NULL,project_id uuid NOT NULL,authority_scope_key text NOT NULL,natural_key text NOT NULL,
      source_work_item_id uuid NOT NULL,summary text NOT NULL,description text NOT NULL,data_classification_key text NOT NULL,source_refs jsonb NOT NULL,
      external_version bigint NOT NULL CHECK(external_version=1),raw_external_state text NOT NULL CHECK(raw_external_state='MOCK_NEW'),normalized_status text NOT NULL CHECK(normalized_status='NEW'),
      profile_id uuid NOT NULL,profile_version integer NOT NULL CHECK(profile_version>=3),created_at timestamptz NOT NULL,UNIQUE(workspace_id,project_id,natural_key));
    CREATE INDEX operational_defects_scope_idx ON operational_defects(workspace_id,project_id,external_entity_id);
    CREATE TABLE operational_defect_effects(
      effect_idempotency_key text PRIMARY KEY,request_hash text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,profile_id uuid NOT NULL,profile_version integer NOT NULL CHECK(profile_version>=3),
      external_entity_id text NOT NULL REFERENCES operational_defects(external_entity_id),result jsonb NOT NULL,effect_count integer NOT NULL CHECK(effect_count=1),recorded_at timestamptz NOT NULL);
    CREATE INDEX operational_defect_effects_scope_idx ON operational_defect_effects(workspace_id,project_id,effect_idempotency_key);
  `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE operational_defect_effects;DROP TABLE operational_defects");
  }
}
