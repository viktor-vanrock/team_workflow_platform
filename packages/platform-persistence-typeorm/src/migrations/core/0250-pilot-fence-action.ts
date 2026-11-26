import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0250PilotFenceAction1700000000250 implements MigrationInterface {
  readonly name = "M0250PilotFenceAction1700000000250";

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE project_operational_action_candidates
        DROP CONSTRAINT project_operational_action_candidates_action_kind_check;
      ALTER TABLE project_operational_action_candidates
        ADD CONSTRAINT project_operational_action_candidates_action_kind_check
        CHECK(action_kind IN ('BINDING_PUBLISH','BINDING_RETIRE','PROJECT_RESUME','ONBOARDING_PILOT_ACTIVATE','PILOT_FENCE_PUBLISH'));
      UPDATE platform_schema_versions SET version=250,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error("PILOT_FENCE_ACTION_ROLLBACK_TRANSACTION_REQUIRED");
    await runner.query("LOCK TABLE project_operational_action_candidates IN ACCESS EXCLUSIVE MODE");
    const rows = (await runner.query(
      "SELECT EXISTS(SELECT 1 FROM project_operational_action_candidates WHERE action_kind='PILOT_FENCE_PUBLISH') AS present",
    )) as { present: boolean }[];
    if (rows[0]?.present) throw new Error("PILOT_FENCE_ACTION_ROLLBACK_REQUIRES_EXPLICIT_HANDLING");
    await runner.query(`
      ALTER TABLE project_operational_action_candidates
        DROP CONSTRAINT project_operational_action_candidates_action_kind_check;
      ALTER TABLE project_operational_action_candidates
        ADD CONSTRAINT project_operational_action_candidates_action_kind_check
        CHECK(action_kind IN ('BINDING_PUBLISH','BINDING_RETIRE','PROJECT_RESUME','ONBOARDING_PILOT_ACTIVATE'));
      UPDATE platform_schema_versions SET version=245,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
}
