import { describe, expect, it } from "vitest";

import {
  createPlatformDataSource,
  migrationClasses,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { startPostgres } from "../../../packages/platform-testkit/src/postgres.ts";
import {
  qaJiraMattermostLocalComposition,
  qaJiraMattermostLocalMigrationRegistry,
} from "../../../packages/runtime-composition/src/qa/composition.ts";

interface QueryExecutor {
  query(sql: string): Promise<unknown>;
}
class Feature004InjectedFailure1700000009999 {
  readonly name = "Feature004InjectedFailure1700000009999";
  async up(query: QueryExecutor) {
    await query.query("CREATE TABLE feature_004_failed_probe(id integer PRIMARY KEY)");
    throw new Error("FEATURE_004_INJECTED_MIGRATION_FAILURE");
  }
  async down(query: QueryExecutor) {
    await query.query("DROP TABLE IF EXISTS feature_004_failed_probe");
  }
}
const databaseUrl = (url: string, database: string) => {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
};

describe("Feature 004 PostgreSQL migration contour", () => {
  it("applies fresh, upgrades/backfills, repeats as no-op and recovers from a failed transaction", async () => {
    const latestCoreVersion = Math.max(
      ...qaJiraMattermostLocalMigrationRegistry
        .filter(({ owner }) => owner === "core")
        .map(({ order }) => order),
    );
    const latestQaVersion = Math.max(
      ...qaJiraMattermostLocalMigrationRegistry
        .filter(({ owner }) => owner === "pack:qa")
        .map(({ order }) => order),
    );
    const postgres = await startPostgres();
    try {
      const admin = createPlatformDataSource({ url: postgres.url, entities: [], migrations: [] });
      await admin.initialize();
      await admin.query("CREATE DATABASE feature004_upgrade");
      await admin.query("CREATE DATABASE feature004_failed");
      await admin.destroy();
      const started = Date.now();
      const source = createPlatformDataSource({
        url: postgres.url,
        entities: qaJiraMattermostLocalComposition.entities,
        migrations: qaJiraMattermostLocalComposition.migrations,
      });
      await source.initialize();
      await source.runMigrations({ transaction: "all" });
      expect(await source.runMigrations({ transaction: "all" })).toEqual([]);
      const versions = (await source.query(
        "SELECT namespace,version FROM platform_schema_versions WHERE namespace IN ('core','pack:qa') ORDER BY namespace",
      )) as unknown;
      expect(versions).toEqual([
        { namespace: "core", version: latestCoreVersion },
        { namespace: "pack:qa", version: latestQaVersion },
      ]);
      expect(Date.now() - started).toBeLessThan(120_000);
      await source.destroy();

      const previousRegistry = qaJiraMattermostLocalMigrationRegistry.filter(
        ({ owner, order }) =>
          !(owner === "core" && order >= 100) && !(owner === "pack:qa" && order >= 2040),
      );
      const previous = migrationClasses(previousRegistry);
      const upgradeUrl = databaseUrl(postgres.url, "feature004_upgrade");
      const before = createPlatformDataSource({
        url: upgradeUrl,
        entities: qaJiraMattermostLocalComposition.entities,
        migrations: previous,
      });
      await before.initialize();
      await before.runMigrations({ transaction: "all" });
      await before.query(
        "INSERT INTO identities(id,issuer,subject,kind,display_name) VALUES('00000000-0000-4000-8000-000000000001','test','legacy','HUMAN','Legacy')",
      );
      await before.query(
        "INSERT INTO workspaces(id,key,name,state) VALUES('00000000-0000-4000-8000-000000000002','legacy','Legacy','ACTIVE')",
      );
      await before.query(
        "INSERT INTO projects(id,workspace_id,key,name,state,classification_key) VALUES('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','legacy','Legacy','ACTIVE','INTERNAL')",
      );
      await before.query(
        "INSERT INTO competency_pack_registrations(id,pack_key,pack_version,manifest_schema_version,required_core_contract_range,manifest_payload,manifest_hash,registration_status,registered_at) VALUES('00000000-0000-4000-8000-000000000004','legacy','1',1,'*','{}','sha256:legacy','REGISTERED',clock_timestamp())",
      );
      await before.query(
        "INSERT INTO work_type_definitions(id,pack_registration_id,work_type_key,definition_version,intake_schema,intake_schema_hash,required_capabilities,definition_payload,definition_hash,lifecycle_status,registered_at) VALUES('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004','legacy','1','{}','sha256:legacy','[]','{}','sha256:legacy','ACTIVE',clock_timestamp())",
      );
      await before.query(
        "INSERT INTO intake_drafts(id,workspace_id,project_id,work_type_definition_id,created_by,state,intake_payload,intake_schema_ref,created_at) VALUES('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','DRAFT','{\"title\":\"legacy\"}','{}',clock_timestamp())",
      );
      await before.destroy();
      const upgraded = createPlatformDataSource({
        url: upgradeUrl,
        entities: qaJiraMattermostLocalComposition.entities,
        migrations: qaJiraMattermostLocalComposition.migrations,
      });
      await upgraded.initialize();
      await upgraded.runMigrations({ transaction: "all" });
      expect(
        await upgraded.query(
          "SELECT d.current_revision,d.current_content_hash,r.content->>'title' AS title FROM intake_drafts d JOIN intake_draft_revisions r ON r.draft_id=d.id WHERE d.id='00000000-0000-4000-8000-000000000006'",
        ),
      ).toEqual([
        { current_revision: 1, current_content_hash: expect.any(String), title: "legacy" },
      ]);
      expect(await upgraded.runMigrations({ transaction: "all" })).toEqual([]);
      await upgraded.destroy();

      const failedUrl = databaseUrl(postgres.url, "feature004_failed");
      const failing = createPlatformDataSource({
        url: failedUrl,
        entities: qaJiraMattermostLocalComposition.entities,
        migrations: [
          ...qaJiraMattermostLocalComposition.migrations,
          Feature004InjectedFailure1700000009999,
        ],
      });
      await failing.initialize();
      await expect(failing.runMigrations({ transaction: "all" })).rejects.toThrow(
        "FEATURE_004_INJECTED_MIGRATION_FAILURE",
      );
      expect(
        await failing.query(
          "SELECT to_regclass('public.feature_004_failed_probe') AS probe,to_regclass('public.notification_intents') AS notifications",
        ),
      ).toEqual([{ probe: null, notifications: null }]);
      await failing.destroy();
      const recovered = createPlatformDataSource({
        url: failedUrl,
        entities: qaJiraMattermostLocalComposition.entities,
        migrations: qaJiraMattermostLocalComposition.migrations,
      });
      await recovered.initialize();
      await recovered.runMigrations({ transaction: "all" });
      expect(
        await recovered.query(
          "SELECT version FROM platform_schema_versions WHERE namespace='core'",
        ),
      ).toEqual([{ version: latestCoreVersion }]);
      await recovered.destroy();
    } finally {
      await postgres.stop();
    }
  }, 120_000);
});
