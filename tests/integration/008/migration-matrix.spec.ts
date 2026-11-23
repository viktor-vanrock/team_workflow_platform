import { describe, expect, it } from "vitest";

import { qaMigrationContributions } from "../../../packages/competency-qa/src/persistence/migrations/index.ts";
import {
  coreMigrationRegistry,
  createPlatformDataSource,
  migrationClasses,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { startPostgres } from "../../../packages/platform-testkit/src/postgres.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

class Feature008InjectedFailure1700000009998 {
  readonly name = "Feature008InjectedFailure1700000009998";

  async up(runner: { query(sql: string): Promise<void> }): Promise<void> {
    await runner.query("CREATE TABLE feature_008_failed_migration_probe(id integer PRIMARY KEY)");
    throw new Error("FEATURE_008_INJECTED_MIGRATION_FAILURE");
  }

  async down(runner: { query(sql: string): Promise<void> }): Promise<void> {
    await runner.query("DROP TABLE IF EXISTS feature_008_failed_migration_probe");
  }
}

function databaseUrl(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

const runPostgresMatrix =
  process.env.AWP_RUN_CONTAINER_TESTS === "true" ||
  process.env.AWP_TEST_POSTGRES_IMAGE !== undefined;
const selectedPostgresImages = process.env.AWP_TEST_POSTGRES_IMAGE
  ? POSTGRES_TEST_IMAGES.filter((image) => image === process.env.AWP_TEST_POSTGRES_IMAGE)
  : POSTGRES_TEST_IMAGES;

describe.runIf(runPostgresMatrix)("Feature 008 PostgreSQL 17/18 migration matrix", () => {
  it.each(selectedPostgresImages)(
    "runs fresh, 0160/2085 upgrade, repeat, immutability and failed recovery on %s",
    async (image) => {
      const postgres = await startPostgres(image);
      try {
        const admin = createPlatformDataSource({ url: postgres.url, entities: [], migrations: [] });
        await admin.initialize();
        await admin.query("CREATE DATABASE feature_008_upgrade");
        await admin.query("CREATE DATABASE feature_008_failed");
        await admin.destroy();

        const full = migrationClasses([...coreMigrationRegistry, ...qaMigrationContributions]);
        const previous = migrationClasses([
          ...coreMigrationRegistry.filter(({ order }) => order <= 160),
          ...qaMigrationContributions.filter(({ order }) => order <= 2085),
        ]);

        const fresh = createPlatformDataSource({
          url: postgres.url,
          entities: [],
          migrations: full,
        });
        await fresh.initialize();
        await fresh.runMigrations({ transaction: "all" });
        expect(await fresh.runMigrations({ transaction: "all" })).toEqual([]);
        expect(
          await fresh.query(
            "SELECT namespace,version FROM platform_schema_versions WHERE namespace IN('core','pack:qa') ORDER BY namespace",
          ),
        ).toEqual([
          { namespace: "core", version: 220 },
          { namespace: "pack:qa", version: 2110 },
        ]);
        await fresh.destroy();

        const upgradeUrl = databaseUrl(postgres.url, "feature_008_upgrade");
        const baseline = createPlatformDataSource({
          url: upgradeUrl,
          entities: [],
          migrations: previous,
        });
        await baseline.initialize();
        await baseline.runMigrations({ transaction: "all" });
        const identityId = "00000000-0000-4000-8000-000000008025";
        const workspaceId = "00000000-0000-4000-8000-000000008001";
        const projectId = "00000000-0000-4000-8000-000000008011";
        const approvalId = "00000000-0000-4000-8000-000000008060";
        await baseline.query(
          "INSERT INTO classification_catalog(key,rank) VALUES('INTERNAL',20) ON CONFLICT(key) DO NOTHING",
        );
        await baseline.query(
          "INSERT INTO identities(id,issuer,subject,kind,display_name,row_version,created_at) VALUES($1,'fixture','owner','HUMAN','Owner',1,clock_timestamp())",
          [identityId],
        );
        await baseline.query(
          "INSERT INTO workspaces(id,key,name,state,row_version,created_at) VALUES($1,'feature-008','Feature 008','ACTIVE',1,clock_timestamp())",
          [workspaceId],
        );
        await baseline.query(
          "INSERT INTO projects(id,workspace_id,key,name,state,classification_key,row_version,created_at) VALUES($1,$2,'project-a','Project A','ACTIVE','INTERNAL',1,clock_timestamp())",
          [projectId, workspaceId],
        );
        await baseline.query(
          "INSERT INTO approvals(id,workspace_id,project_id,action_kind,action_id,subject,subject_hash,decision_state,effect_authorization_state,initiator_id,expires_at,created_at) VALUES($1,$2,$3,'EXTERNAL_COMMAND',$4,$5::jsonb,$6,'PENDING','NOT_AUTHORIZED',$7,clock_timestamp()+interval '1 day',clock_timestamp())",
          [
            approvalId,
            workspaceId,
            projectId,
            "00000000-0000-4000-8000-000000008061",
            JSON.stringify({ schemaVersion: 1, subject: "historical" }),
            `sha256:${"a".repeat(64)}`,
            identityId,
          ],
        );
        await baseline.destroy();

        const upgraded = createPlatformDataSource({
          url: upgradeUrl,
          entities: [],
          migrations: full,
        });
        await upgraded.initialize();
        expect(await upgraded.runMigrations({ transaction: "all" })).toHaveLength(14);
        expect(
          await upgraded.query("SELECT id::text,subject_hash FROM approvals WHERE id=$1", [
            approvalId,
          ]),
        ).toEqual([{ id: approvalId, subject_hash: `sha256:${"a".repeat(64)}` }]);
        await expect(
          upgraded.query("DELETE FROM approvals WHERE id=$1", [approvalId]),
        ).rejects.toThrow();
        const pilotRecordId = "00000000-0000-4000-8000-000000008065";
        await upgraded.query(
          "INSERT INTO pilot_record_revisions(workspace_id,project_id,record_id,kind,version,schema_version,actor_ref,correlation_id,created_at,semantic_body,content_hash) VALUES($1,$2,$3,'GATE_EXECUTION',1,1,$4,'migration-matrix',clock_timestamp(),'{}'::jsonb,$5)",
          [workspaceId, projectId, pilotRecordId, identityId, `sha256:${"b".repeat(64)}`],
        );
        await expect(
          upgraded.query(
            "UPDATE pilot_record_revisions SET semantic_body='{\"changed\":true}'::jsonb WHERE record_id=$1",
            [pilotRecordId],
          ),
        ).rejects.toThrow();
        expect(await upgraded.runMigrations({ transaction: "all" })).toEqual([]);
        for (const table of [
          "capability_probe_requests",
          "project_incident_dispositions",
          "pilot_record_revisions",
          "corporate_session_states",
          "pilot_runtime_registrations",
          "runtime_configuration_revisions",
          "pilot_dead_letters",
          "qa_evidence_uploads",
          "qa_defect_draft_proposals",
        ]) {
          expect(
            await upgraded.query("SELECT to_regclass($1) AS table_name", [`public.${table}`]),
          ).toEqual([{ table_name: table }]);
        }
        await upgraded.destroy();

        const failedUrl = databaseUrl(postgres.url, "feature_008_failed");
        const failing = createPlatformDataSource({
          url: failedUrl,
          entities: [],
          migrations: [...full, Feature008InjectedFailure1700000009998],
        });
        await failing.initialize();
        await expect(failing.runMigrations({ transaction: "all" })).rejects.toThrow(
          "FEATURE_008_INJECTED_MIGRATION_FAILURE",
        );
        expect(
          await failing.query(
            "SELECT to_regclass('public.feature_008_failed_migration_probe') AS probe, to_regclass('public.platform_schema_versions') AS versions",
          ),
        ).toEqual([{ probe: null, versions: null }]);
        await failing.destroy();

        const recovered = createPlatformDataSource({
          url: failedUrl,
          entities: [],
          migrations: full,
        });
        await recovered.initialize();
        await recovered.runMigrations({ transaction: "all" });
        expect(
          await recovered.query(
            "SELECT namespace,version FROM platform_schema_versions WHERE namespace IN('core','pack:qa') ORDER BY namespace",
          ),
        ).toEqual([
          { namespace: "core", version: 220 },
          { namespace: "pack:qa", version: 2110 },
        ]);
        await recovered.destroy();
      } finally {
        await postgres.stop();
      }
    },
    360_000,
  );
});
