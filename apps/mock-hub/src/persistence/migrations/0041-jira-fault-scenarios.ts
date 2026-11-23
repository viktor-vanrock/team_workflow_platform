import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Compatibility migration for already-applied 0040 installations. Existing
 * issue rows and APIs remain unchanged; marker lookup gains a non-unique index
 * so the Mock Hub can faithfully expose Jira's possible MULTIPLE result.
 */
export class JiraFaultScenarios00411700000002041 implements MigrationInterface {
  readonly name = "JiraFaultScenarios00411700000002041";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS jira_mock_issues_marker_idx
        ON jira_mock_issues(marker)
        WHERE marker IS NOT NULL;
      ALTER TABLE jira_mock_issues
        DROP CONSTRAINT IF EXISTS jira_mock_issues_marker_key;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS jira_mock_issues_marker_idx;
      ALTER TABLE jira_mock_issues
        ADD CONSTRAINT jira_mock_issues_marker_key UNIQUE(marker);
    `);
  }
}
