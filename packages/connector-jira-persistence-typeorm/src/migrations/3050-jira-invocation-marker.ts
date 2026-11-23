import type { MigrationInterface, QueryRunner } from "typeorm";

/** The search index cannot prove that an already invoked create was absent. */
export class M3050JiraInvocationMarker1700000003050 implements MigrationInterface {
  readonly name = "M3050JiraInvocationMarker1700000003050";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE jira_effect_reconciliations ADD COLUMN invocation_started_at timestamptz NULL;
      -- Older LOOKUP_REQUIRED rows may have lost their invocation state during
      -- recovery. Preserve uncertainty rather than permit an unproven write.
      UPDATE jira_effect_reconciliations SET invocation_started_at=created_at WHERE state<>'NOT_STARTED';
      UPDATE platform_schema_versions SET version=3050,applied_at=clock_timestamp() WHERE namespace='connector:jira';
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE jira_effect_reconciliations DROP COLUMN invocation_started_at;
      UPDATE platform_schema_versions SET version=3040,applied_at=clock_timestamp() WHERE namespace='connector:jira';
    `);
  }
}
