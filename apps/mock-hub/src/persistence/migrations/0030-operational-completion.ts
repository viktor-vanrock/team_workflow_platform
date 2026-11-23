import type { MigrationInterface, QueryRunner } from "typeorm";

export class OperationalCompletion00301700000002030 implements MigrationInterface {
  readonly name = "OperationalCompletion00301700000002030";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE operational_requests DROP CONSTRAINT IF EXISTS operational_requests_raw_external_state_check,DROP CONSTRAINT IF EXISTS operational_requests_normalized_status_check;
      ALTER TABLE operational_requests ADD COLUMN completion_summary jsonb NULL,ADD COLUMN completion_summary_digest text NULL,ADD COLUMN completion_summary_receipt jsonb NULL;
      ALTER TABLE operational_requests ADD CONSTRAINT operational_requests_raw_external_state_0030 CHECK(raw_external_state IN('MOCK_NEW','MOCK_READY','MOCK_DONE'));
      ALTER TABLE operational_requests ADD CONSTRAINT operational_requests_normalized_status_0030 CHECK(normalized_status IN('NEW','READY','DONE'));
      ALTER TABLE operational_requests ADD CONSTRAINT operational_requests_completion_shape_0030 CHECK(
        (normalized_status<>'DONE' AND completion_summary IS NULL AND completion_summary_digest IS NULL AND completion_summary_receipt IS NULL)
        OR (normalized_status='DONE' AND completion_summary IS NOT NULL AND completion_summary_digest IS NOT NULL AND completion_summary_receipt IS NOT NULL)
      );
      CREATE TABLE operational_completion_effects(
        effect_idempotency_key text PRIMARY KEY,request_hash text NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,external_entity_id text NOT NULL REFERENCES operational_requests(external_entity_id),
        summary jsonb NOT NULL,summary_digest text NOT NULL,comment_receipt jsonb NOT NULL,expected_external_version text NOT NULL,confirmed_external_version text NOT NULL,
        partial_effect_ledger jsonb NOT NULL DEFAULT '[]'::jsonb,recorded_at timestamptz NOT NULL,
        UNIQUE(workspace_id,project_id,external_entity_id,summary_digest),CHECK(jsonb_typeof(summary)='object' AND jsonb_typeof(comment_receipt)='object' AND jsonb_typeof(partial_effect_ledger)='array')
      );
      CREATE INDEX operational_completion_effects_scope_idx ON operational_completion_effects(workspace_id,project_id,effect_idempotency_key);
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE operational_completion_effects;
      ALTER TABLE operational_requests DROP CONSTRAINT IF EXISTS operational_requests_completion_shape_0030,DROP CONSTRAINT IF EXISTS operational_requests_normalized_status_0030,DROP CONSTRAINT IF EXISTS operational_requests_raw_external_state_0030;
      ALTER TABLE operational_requests DROP COLUMN completion_summary_receipt,DROP COLUMN completion_summary_digest,DROP COLUMN completion_summary;
      ALTER TABLE operational_requests ADD CONSTRAINT operational_requests_raw_external_state_check CHECK(raw_external_state IN('MOCK_NEW','MOCK_READY'));
      ALTER TABLE operational_requests ADD CONSTRAINT operational_requests_normalized_status_check CHECK(normalized_status IN('NEW','READY'));
    `);
  }
}
