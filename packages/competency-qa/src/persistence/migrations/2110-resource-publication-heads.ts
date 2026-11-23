import type { MigrationInterface, QueryRunner } from "typeorm";

/** Publication selects a current head; historical published snapshots remain immutable. */
export class QaResourcePublicationHeads21101700000002110 implements MigrationInterface {
  readonly name = "QaResourcePublicationHeads21101700000002110";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query("DROP INDEX qa_project_environment_one_published_idx");
    await runner.query(
      "CREATE INDEX qa_project_environment_published_history_idx ON qa_project_environment_revisions(workspace_id,project_id,environment_id,version) WHERE state='PUBLISHED'",
    );
    await runner.query(
      "UPDATE platform_schema_versions SET version=2110,applied_at=clock_timestamp() WHERE namespace='pack:qa'",
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    // Restoring the old invariant refuses a downgrade if multiple immutable publications exist.
    await runner.query(
      "CREATE UNIQUE INDEX qa_project_environment_one_published_idx ON qa_project_environment_revisions(workspace_id,project_id,environment_id) WHERE state='PUBLISHED'",
    );
    await runner.query("DROP INDEX qa_project_environment_published_history_idx");
    await runner.query(
      "UPDATE platform_schema_versions SET version=2100,applied_at=clock_timestamp() WHERE namespace='pack:qa'",
    );
  }
}
