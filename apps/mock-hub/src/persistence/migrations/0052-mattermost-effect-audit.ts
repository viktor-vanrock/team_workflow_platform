import type { MigrationInterface, QueryRunner } from "typeorm";

export class MattermostEffectAudit00521700000002052 implements MigrationInterface {
  readonly name = "MattermostEffectAudit00521700000002052";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE mattermost_mock_effect_calls (
        sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        effect_key text NOT NULL,
        operation text NOT NULL,
        request_body jsonb NOT NULL,
        outcome text NOT NULL,
        external_post_id text NULL,
        recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE INDEX mattermost_mock_effect_calls_key_idx
        ON mattermost_mock_effect_calls(effect_key, sequence);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE mattermost_mock_effect_calls;");
  }
}
