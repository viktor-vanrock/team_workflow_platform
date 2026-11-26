import type { MigrationInterface, QueryRunner } from "typeorm";

export class M0245PilotCommandAdmission1700000000245 implements MigrationInterface {
  readonly name = "M0245PilotCommandAdmission1700000000245";

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE pilot_command_admissions (
        workspace_id uuid NOT NULL, project_id uuid NOT NULL, command_id uuid NOT NULL,
        principal_id uuid NOT NULL REFERENCES identities(id),
        purpose text NOT NULL CHECK(purpose IN ('BUSINESS','SANDBOX_CONFORMANCE')),
        payload_hash text NOT NULL CHECK(payload_hash ~ '^sha256:[a-f0-9]{64}$'),
        target_hash text NOT NULL CHECK(target_hash ~ '^sha256:[a-f0-9]{64}$'),
        expected_onboarding_version integer NOT NULL CHECK(expected_onboarding_version > 0),
        deployment_ref jsonb NOT NULL CHECK(jsonb_typeof(deployment_ref)='object'),
        cohort_ref jsonb NOT NULL CHECK(jsonb_typeof(cohort_ref)='object'),
        fence_ref jsonb NOT NULL CHECK(jsonb_typeof(fence_ref)='object'),
        created_at timestamptz NOT NULL,
        PRIMARY KEY(workspace_id,project_id,command_id),
        FOREIGN KEY(workspace_id,project_id,command_id)
          REFERENCES connector_commands(workspace_id,project_id,id) DEFERRABLE INITIALLY DEFERRED
      );
      CREATE TRIGGER pilot_command_admissions_append_only
        BEFORE UPDATE OR DELETE ON pilot_command_admissions
        FOR EACH ROW EXECUTE FUNCTION awp_append_only();
      UPDATE platform_schema_versions SET version=245,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error("PILOT_ADMISSION_ROLLBACK_TRANSACTION_REQUIRED");
    await runner.query("LOCK TABLE pilot_command_admissions IN ACCESS EXCLUSIVE MODE");
    const rows = (await runner.query(
      "SELECT EXISTS(SELECT 1 FROM pilot_command_admissions) AS present",
    )) as { present: boolean }[];
    if (rows[0]?.present) throw new Error("PILOT_ADMISSION_ROLLBACK_REQUIRES_EXPLICIT_HANDLING");
    await runner.query(`
      DROP TABLE pilot_command_admissions;
      UPDATE platform_schema_versions SET version=240,applied_at=clock_timestamp() WHERE namespace='core';
    `);
  }
}
