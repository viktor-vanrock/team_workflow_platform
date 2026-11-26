import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { QaValidatedIncompleteResult21151700000002115 } from "../../../packages/competency-qa/src/persistence/migrations/2115-validated-incomplete-result.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "validated incomplete result migration",
  () => {
    let postgres: RunningPostgres, source: DataSource;
    beforeAll(async () => {
      postgres = await startPostgres();
      source = new DataSource({ type: "postgres", url: postgres.url });
      await source.initialize();
      await source.query(`CREATE TABLE platform_schema_versions(namespace text PRIMARY KEY,version integer,applied_at timestamptz);
      INSERT INTO platform_schema_versions VALUES ('pack:qa',2110,clock_timestamp());
      CREATE TABLE qa_automation_attempt_results (
        id text PRIMARY KEY, normalization_kind text NOT NULL, technical_outcome text NOT NULL,
        synthetic_reason_code text, source_result_artifact_ref text, external_pipeline_id text,
        external_job_ids jsonb NOT NULL, commit_sha text, duration_ms integer,
        CHECK ((normalization_kind='SCHEMA_VALIDATED' AND technical_outcome<>'INCOMPLETE'
          AND synthetic_reason_code IS NULL AND source_result_artifact_ref IS NOT NULL
          AND external_pipeline_id IS NOT NULL AND jsonb_array_length(external_job_ids)>=1
          AND commit_sha IS NOT NULL AND duration_ms IS NOT NULL)
          OR (normalization_kind='SYNTHETIC_INCOMPLETE' AND technical_outcome='INCOMPLETE' AND synthetic_reason_code IS NOT NULL))
      );
      INSERT INTO qa_automation_attempt_results VALUES
        ('pass','SCHEMA_VALIDATED','PASS',NULL,'ref','1','["2"]','sha',5),
        ('missing','SYNTHETIC_INCOMPLETE','INCOMPLETE','RESULT_MISSING',NULL,NULL,'[]',NULL,NULL);`);
    }, 120_000);
    afterAll(async () => {
      await source?.destroy();
      await postgres?.stop();
    }, 120_000);
    it("retains both historical forms and rejects rollback until new rows are explicitly handled", async () => {
      const runner = source.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        const migration = new QaValidatedIncompleteResult21151700000002115();
        await migration.up(runner);
        expect(
          await runner.query(
            "SELECT id,normalization_kind,technical_outcome FROM qa_automation_attempt_results ORDER BY id",
          ),
        ).toEqual([
          {
            id: "missing",
            normalization_kind: "SYNTHETIC_INCOMPLETE",
            technical_outcome: "INCOMPLETE",
          },
          { id: "pass", normalization_kind: "SCHEMA_VALIDATED", technical_outcome: "PASS" },
        ]);
        await runner.query(
          "INSERT INTO qa_automation_attempt_results VALUES ('valid-incomplete','SCHEMA_VALIDATED','INCOMPLETE',NULL,'ref','1','[\"2\"]','sha',5)",
        );
        await runner.query("SAVEPOINT rollback_attempt");
        await expect(migration.down(runner)).rejects.toThrow(
          "QA_VALIDATED_INCOMPLETE_ROLLBACK_REQUIRES_EXPLICIT_HANDLING",
        );
        await runner.query("ROLLBACK TO SAVEPOINT rollback_attempt");
        await runner.query("DELETE FROM qa_automation_attempt_results WHERE id='valid-incomplete'");
        await migration.down(runner);
        await runner.query("SAVEPOINT invalid_insert");
        await expect(
          runner.query(
            "INSERT INTO qa_automation_attempt_results VALUES ('invalid','SCHEMA_VALIDATED','INCOMPLETE',NULL,'ref','1','[\"2\"]','sha',5)",
          ),
        ).rejects.toThrow();
        await runner.query("ROLLBACK TO SAVEPOINT invalid_insert");
        expect(
          await runner.query(
            "SELECT version FROM platform_schema_versions WHERE namespace='pack:qa'",
          ),
        ).toEqual([{ version: 2110 }]);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });
  },
);
