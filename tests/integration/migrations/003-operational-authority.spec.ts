import { describe, expect, it } from "vitest";

import {
  jiraEntities,
  jiraMigrationRegistry,
} from "../../../packages/connector-jira-persistence-typeorm/src/index.ts";
import {
  coreEntities,
  coreMigrationRegistry,
  createPlatformDataSource,
  validateMigrationRegistry,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { startPostgres } from "../../../packages/platform-testkit/src/postgres.ts";
import { jiraLocalMigrationRegistry } from "../../../packages/runtime-composition/src/migrations/composition.ts";
import { jiraLocalEntities } from "../../../packages/runtime-composition/src/persistence/entity-composition.ts";
import { historicalMigrations } from "../../support/historical-migrations.ts";

interface QueryExecutor {
  query(sql: string): Promise<unknown>;
}
const jiraLocalMigrations = historicalMigrations(jiraLocalMigrationRegistry, {
  core: 140,
  "pack:dummy": 1000,
  "connector:jira": 3040,
});
class M3050InjectedFailure1700000003050 {
  readonly name = "M3050InjectedFailure1700000003050";
  async up(queryRunner: QueryExecutor): Promise<void> {
    await queryRunner.query("CREATE TABLE jira_failed_migration_probe(id integer PRIMARY KEY)");
    throw new Error("JIRA_INJECTED_MIGRATION_FAILURE");
  }
  async down(queryRunner: QueryExecutor): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS jira_failed_migration_probe");
  }
}
function databaseUrl(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

describe("Feature 003 operational-authority migrations", () => {
  it("keeps Core 0090/0095 registered beneath the current additive tail and Jira 3000..3040 with entity parity", () => {
    expect(
      coreMigrationRegistry
        .filter(({ order }) => order === 90 || order === 95)
        .map(({ order }) => order),
    ).toEqual([90, 95]);
    expect(coreMigrationRegistry.filter(({ order }) => order <= 140).at(-1)?.order).toBe(140);
    expect(
      jiraMigrationRegistry.filter(({ order }) => order <= 3040).map(({ order }) => order),
    ).toEqual([3000, 3010, 3020, 3030, 3040]);
    expect(() =>
      validateMigrationRegistry([...coreMigrationRegistry, ...jiraMigrationRegistry]),
    ).not.toThrow();
    const names = [...coreEntities, ...jiraEntities].map((entity) =>
      String(entity.options.tableName),
    );
    for (const table of [
      "operational_bindings",
      "operational_projection_revisions",
      "operational_import_intents",
      "jira_discovery_snapshots",
      "jira_effect_reconciliations",
    ])
      expect(names).toContain(table);
  });

  it("applies the combined Core, Pack and connector schema, survives restart and is a no-op on rerun", async () => {
    const postgres = await startPostgres();
    try {
      const admin = createPlatformDataSource({ url: postgres.url, entities: [], migrations: [] });
      await admin.initialize();
      await admin.query("CREATE DATABASE jira_upgrade");
      await admin.query("CREATE DATABASE jira_failed");
      await admin.destroy();

      const first = createPlatformDataSource({
        url: postgres.url,
        entities: jiraLocalEntities,
        migrations: jiraLocalMigrations,
      });
      await first.initialize();
      await first.runMigrations({ transaction: "all" });
      expect(
        await first.query(
          "SELECT namespace,version FROM platform_schema_versions ORDER BY namespace",
        ),
      ).toEqual([
        { namespace: "connector:jira", version: 3040 },
        { namespace: "core", version: 140 },
        { namespace: "pack:dummy", version: 1000 },
      ]);
      expect(
        await first.query(
          "SELECT to_regclass('public.operational_bindings') AS binding,to_regclass('public.external_principal_bindings') AS identity,to_regclass('public.jira_effect_reconciliations') AS effect",
        ),
      ).toEqual([
        {
          binding: "operational_bindings",
          identity: "external_principal_bindings",
          effect: "jira_effect_reconciliations",
        },
      ]);
      expect(await first.runMigrations({ transaction: "all" })).toEqual([]);
      await first.destroy();

      const restarted = createPlatformDataSource({
        url: postgres.url,
        entities: jiraLocalEntities,
        migrations: jiraLocalMigrations,
      });
      await restarted.initialize();
      expect(await restarted.runMigrations({ transaction: "all" })).toEqual([]);
      expect(
        await restarted.query("SELECT count(*)::int AS count FROM typeorm_migrations"),
      ).toEqual([{ count: jiraLocalMigrations.length }]);
      await restarted.destroy();

      const upgradeUrl = databaseUrl(postgres.url, "jira_upgrade");
      const previous = createPlatformDataSource({
        url: upgradeUrl,
        entities: jiraLocalEntities,
        migrations: jiraLocalMigrations.slice(0, -1),
      });
      await previous.initialize();
      await previous.runMigrations({ transaction: "all" });
      expect(
        await previous.query(
          "SELECT to_regclass('public.jira_effect_reconciliations') AS effect,(SELECT count(*)::int FROM information_schema.columns WHERE table_name='event_outbox' AND column_name='lease_token') AS outbox_lease_columns,(SELECT count(*)::int FROM information_schema.columns WHERE table_name='jira_effect_reconciliations' AND column_name='lease_owner') AS effect_owner_columns",
        ),
      ).toEqual([
        { effect: "jira_effect_reconciliations", outbox_lease_columns: 1, effect_owner_columns: 0 },
      ]);
      await previous.destroy();
      const upgraded = createPlatformDataSource({
        url: upgradeUrl,
        entities: jiraLocalEntities,
        migrations: jiraLocalMigrations,
      });
      await upgraded.initialize();
      await upgraded.runMigrations({ transaction: "all" });
      expect(
        await upgraded.query(
          "SELECT version FROM platform_schema_versions WHERE namespace='connector:jira'",
        ),
      ).toEqual([{ version: 3040 }]);
      await upgraded.destroy();

      const failedUrl = databaseUrl(postgres.url, "jira_failed");
      const failing = createPlatformDataSource({
        url: failedUrl,
        entities: jiraLocalEntities,
        migrations: [...jiraLocalMigrations, M3050InjectedFailure1700000003050],
      });
      await failing.initialize();
      await expect(failing.runMigrations({ transaction: "all" })).rejects.toThrow(
        "JIRA_INJECTED_MIGRATION_FAILURE",
      );
      expect(
        await failing.query(
          "SELECT to_regclass('public.jira_failed_migration_probe') AS probe,to_regclass('public.jira_effect_reconciliations') AS effect",
        ),
      ).toEqual([{ probe: null, effect: null }]);
      await failing.destroy();
      const recovered = createPlatformDataSource({
        url: failedUrl,
        entities: jiraLocalEntities,
        migrations: jiraLocalMigrations,
      });
      await recovered.initialize();
      await recovered.runMigrations({ transaction: "all" });
      expect(
        await recovered.query(
          "SELECT version FROM platform_schema_versions WHERE namespace='connector:jira'",
        ),
      ).toEqual([{ version: 3040 }]);
      await recovered.destroy();
    } finally {
      await postgres.stop();
    }
  }, 120_000);
});
