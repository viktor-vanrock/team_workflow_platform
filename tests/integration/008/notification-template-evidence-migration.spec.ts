import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { M0255NotificationTemplateEvidence1700000000255 } from "../../../packages/platform-persistence-typeorm/src/migrations/core/0255-notification-template-evidence.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";

describe.runIf(process.env.AWP_RUN_CONTAINER_TESTS === "true")(
  "notification template evidence migration",
  () => {
    let postgres: RunningPostgres, source: DataSource;
    beforeAll(async () => {
      postgres = await startPostgres();
      source = new DataSource({ type: "postgres", url: postgres.url });
      await source.initialize();
      await source.query(
        "CREATE TABLE platform_schema_versions(namespace text PRIMARY KEY,version integer,applied_at timestamptz); INSERT INTO platform_schema_versions VALUES ('core',250,clock_timestamp())",
      );
      await source.query(
        "CREATE TABLE notification_intents(id text PRIMARY KEY, state text NOT NULL); INSERT INTO notification_intents VALUES ('old','QUEUED')",
      );
    });
    afterAll(async () => {
      await source?.destroy();
      await postgres?.stop();
    });
    it("preserves old rows and refuses rollback while evidence exists", async () => {
      const runner = source.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      const migration = new M0255NotificationTemplateEvidence1700000000255();
      await migration.up(runner);
      expect(
        await runner.query(
          "SELECT id,state,template_evidence FROM notification_intents WHERE id='old'",
        ),
      ).toEqual([{ id: "old", state: "QUEUED", template_evidence: null }]);
      await runner.query(
        "INSERT INTO notification_intents(id,state,template_evidence) VALUES('new','QUEUED','{}'::jsonb)",
      );
      await expect(migration.down(runner)).rejects.toThrow(
        "NOTIFICATION_EVIDENCE_ROLLBACK_REQUIRES_EXPLICIT_HANDLING",
      );
      await runner.query("DELETE FROM notification_intents WHERE id='new'");
      await migration.down(runner);
      expect(
        await runner.query("SELECT id,state FROM notification_intents WHERE id='old'"),
      ).toEqual([{ id: "old", state: "QUEUED" }]);
      await runner.rollbackTransaction();
      await runner.release();
    });
  },
);
