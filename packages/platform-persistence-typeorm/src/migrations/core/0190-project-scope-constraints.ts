import type { MigrationInterface, QueryRunner } from "typeorm";

/** Additive repair: never rewrite an already published migration. */
export class M0190ProjectScopeConstraints1700000000190 implements MigrationInterface {
  readonly name = "M0190ProjectScopeConstraints1700000000190";
  private readonly tables = [
    "action_provenance_records",
    "agent_runs",
    "agent_tool_invocations",
    "external_interaction_receipts",
    "intake_candidate_decisions",
    "intake_candidate_source_observations",
    "intake_candidates",
    "intake_draft_confirmations",
    "intake_draft_revisions",
    "interaction_intents",
    "interaction_presentation_secrets",
    "notification_intents",
    "operational_import_intents",
    "queue_order_scope_heads",
    "reconciliation_cursors",
  ] as const;

  async up(runner: QueryRunner): Promise<void> {
    for (const table of this.tables) {
      // MATCH SIMPLE permits the documented workspace-only portfolio row (project_id NULL).
      // Validation fails atomically on existing orphan/cross-workspace rows; no data is deleted.
      await runner.query(
        `ALTER TABLE ${table} ADD CONSTRAINT ${table}_project_scope_fk FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id) NOT VALID`,
      );
      await runner.query(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${table}_project_scope_fk`);
    }
    await runner.query(
      "UPDATE platform_schema_versions SET version=190,applied_at=clock_timestamp() WHERE namespace='core'",
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    for (const table of [...this.tables].reverse())
      await runner.query(`ALTER TABLE ${table} DROP CONSTRAINT ${table}_project_scope_fk`);
    await runner.query(
      "UPDATE platform_schema_versions SET version=185,applied_at=clock_timestamp() WHERE namespace='core'",
    );
  }
}
