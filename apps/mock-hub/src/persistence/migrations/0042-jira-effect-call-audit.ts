import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Durable wire-level audit for Jira write requests received by Mock Hub.
 *
 * The row is written before fault injection or the simulated provider effect,
 * so it counts HTTP write attempts independently from idempotent state tables.
 */
export class JiraEffectCallAudit00421700000002042 implements MigrationInterface {
  readonly name = "JiraEffectCallAudit00421700000002042";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE jira_mock_effect_calls(
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        operation text NOT NULL
          CHECK(operation IN ('CREATE','PROPERTY','LINK','COMMENT')),
        request_body jsonb NOT NULL,
        received_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE INDEX jira_mock_effect_calls_operation_idx
        ON jira_mock_effect_calls(operation, id);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE jira_mock_effect_calls;");
  }
}
