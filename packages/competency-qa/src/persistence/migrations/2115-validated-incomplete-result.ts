import type { MigrationInterface, QueryRunner } from "typeorm";

/** Accept the existing result schema's valid INCOMPLETE outcome without rewriting history. */
export class QaValidatedIncompleteResult21151700000002115 implements MigrationInterface {
  readonly name = "QaValidatedIncompleteResult21151700000002115";

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DO $$
      DECLARE constraint_name text; matching_count integer;
      BEGIN
        SELECT count(*), min(c.conname::text) INTO matching_count, constraint_name
        FROM pg_constraint c
        WHERE c.conrelid='qa_automation_attempt_results'::regclass AND c.contype='c'
          AND pg_get_constraintdef(c.oid) LIKE '%normalization_kind%'
          AND pg_get_constraintdef(c.oid) LIKE '%synthetic_reason_code%'
          AND pg_get_constraintdef(c.oid) LIKE '%source_result_artifact_ref%';
        IF matching_count <> 1 THEN RAISE EXCEPTION 'QA_RESULT_NORMALIZATION_CONSTRAINT_NOT_UNIQUE'; END IF;
        EXECUTE format('ALTER TABLE qa_automation_attempt_results DROP CONSTRAINT %I', constraint_name);
      END $$;
      ALTER TABLE qa_automation_attempt_results ADD CONSTRAINT qa_automation_result_normalization_check CHECK (
        (normalization_kind='SCHEMA_VALIDATED' AND synthetic_reason_code IS NULL
          AND source_result_artifact_ref IS NOT NULL AND external_pipeline_id IS NOT NULL
          AND jsonb_array_length(external_job_ids)>=1 AND commit_sha IS NOT NULL AND duration_ms IS NOT NULL)
        OR (normalization_kind='SYNTHETIC_INCOMPLETE' AND technical_outcome='INCOMPLETE'
          AND synthetic_reason_code IS NOT NULL)
      );
      UPDATE platform_schema_versions SET version=2115,applied_at=clock_timestamp() WHERE namespace='pack:qa';
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      LOCK TABLE qa_automation_attempt_results IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM qa_automation_attempt_results WHERE normalization_kind='SCHEMA_VALIDATED' AND technical_outcome='INCOMPLETE')
        THEN RAISE EXCEPTION 'QA_VALIDATED_INCOMPLETE_ROLLBACK_REQUIRES_EXPLICIT_HANDLING'; END IF;
      END $$;
      ALTER TABLE qa_automation_attempt_results DROP CONSTRAINT qa_automation_result_normalization_check;
      ALTER TABLE qa_automation_attempt_results ADD CONSTRAINT qa_automation_result_normalization_check CHECK (
        (normalization_kind='SCHEMA_VALIDATED' AND technical_outcome<>'INCOMPLETE'
          AND synthetic_reason_code IS NULL AND source_result_artifact_ref IS NOT NULL
          AND external_pipeline_id IS NOT NULL AND jsonb_array_length(external_job_ids)>=1
          AND commit_sha IS NOT NULL AND duration_ms IS NOT NULL)
        OR (normalization_kind='SYNTHETIC_INCOMPLETE' AND technical_outcome='INCOMPLETE'
          AND synthetic_reason_code IS NOT NULL)
      );
      UPDATE platform_schema_versions SET version=2110,applied_at=clock_timestamp() WHERE namespace='pack:qa';
    `);
  }
}
