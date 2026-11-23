import { afterEach, describe, expect, it } from "vitest";

import {
  createMockHubDataSource,
  mockHubMigrations,
} from "../../apps/mock-hub/src/persistence/data-source.ts";
import { migrateMockHub } from "../../apps/mock-hub/src/persistence/migration-runner.ts";
import {
  createPlatformDataSource,
  OneShotMigrationRunner,
} from "../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../packages/platform-testkit/src/postgres.ts";
import { localMigrationRegistry } from "../../packages/runtime-composition/src/migrations/composition.ts";
import { localEntities } from "../../packages/runtime-composition/src/persistence/entity-composition.ts";
import { historicalMigrations } from "../support/historical-migrations.ts";
import { POSTGRES_TEST_IMAGES } from "../testcontainers.config.ts";

interface QueryExecutor {
  query(sql: string): Promise<unknown>;
}
const localMigrations = historicalMigrations(localMigrationRegistry, {
  core: 95,
  "pack:dummy": 1000,
});

class M0075InjectedFailure1700000000075 {
  readonly name = "M0075InjectedFailure1700000000075";
  async up(queryRunner: QueryExecutor): Promise<void> {
    await queryRunner.query(
      "CREATE TABLE feature_001_failed_migration_probe(id integer PRIMARY KEY)",
    );
    throw new Error("FEATURE_001_INJECTED_MIGRATION_FAILURE");
  }
  async down(queryRunner: QueryExecutor): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS feature_001_failed_migration_probe");
  }
}

const running: RunningPostgres[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map(async (postgres) => await postgres.stop()));
});

function databaseUrl(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

describe("Feature 001 PostgreSQL 17/18 migration matrix", () => {
  it.each(POSTGRES_TEST_IMAGES)(
    "runs fresh/noop/upgrade/failure-recovery and isolated Mock Hub on %s",
    async (image) => {
      const postgres = await startPostgres(image);
      running.push(postgres);
      const admin = createPlatformDataSource({ url: postgres.url, entities: [], migrations: [] });
      await admin.initialize();
      for (const database of ["awp_upgrade", "awp_failed", "awp_mock"])
        await admin.query(`CREATE DATABASE ${database}`);
      await admin.destroy();

      const fresh = createPlatformDataSource({
        url: postgres.url,
        entities: localEntities,
        migrations: localMigrations,
      });
      await new OneShotMigrationRunner(fresh, "core", 95).run();
      expect(
        await fresh.query(
          "SELECT namespace,version FROM platform_schema_versions ORDER BY namespace",
        ),
      ).toEqual([
        { namespace: "core", version: 95 },
        { namespace: "pack:dummy", version: 1000 },
      ]);
      expect(await fresh.query("SELECT count(*)::int AS count FROM typeorm_migrations")).toEqual([
        { count: 12 },
      ]);
      expect(await fresh.runMigrations({ transaction: "all" })).toEqual([]);
      expect(await fresh.query("SELECT count(*)::int AS count FROM typeorm_migrations")).toEqual([
        { count: 12 },
      ]);
      await fresh.destroy();

      const upgradeUrl = databaseUrl(postgres.url, "awp_upgrade");
      const previous = createPlatformDataSource({
        url: upgradeUrl,
        entities: localEntities,
        migrations: localMigrations.slice(0, 8),
      });
      await new OneShotMigrationRunner(previous, "core", 70).run();
      expect(
        await previous.query(
          "SELECT to_regclass('public.audit_events') AS audit,to_regclass('public.dummy_requests') AS dummy",
        ),
      ).toEqual([{ audit: null, dummy: null }]);
      await previous.destroy();
      const upgraded = createPlatformDataSource({
        url: upgradeUrl,
        entities: localEntities,
        migrations: localMigrations,
      });
      await new OneShotMigrationRunner(upgraded, "core", 95).run();
      expect(
        await upgraded.query(
          "SELECT to_regclass('public.audit_events') AS audit,to_regclass('public.dummy_requests') AS dummy",
        ),
      ).toEqual([{ audit: "audit_events", dummy: "dummy_requests" }]);
      await upgraded.destroy();

      const failedUrl = databaseUrl(postgres.url, "awp_failed");
      const failedPrevious = createPlatformDataSource({
        url: failedUrl,
        entities: localEntities,
        migrations: localMigrations.slice(0, 8),
      });
      await new OneShotMigrationRunner(failedPrevious, "core", 70).run();
      await failedPrevious.destroy();
      const failing = createPlatformDataSource({
        url: failedUrl,
        entities: localEntities,
        migrations: [...localMigrations, M0075InjectedFailure1700000000075],
      });
      await failing.initialize();
      await expect(failing.runMigrations({ transaction: "all" })).rejects.toThrow(
        "FEATURE_001_INJECTED_MIGRATION_FAILURE",
      );
      expect(
        await failing.query(
          "SELECT to_regclass('public.feature_001_failed_migration_probe') AS probe",
        ),
      ).toEqual([{ probe: null }]);
      expect(
        await failing.query("SELECT version FROM platform_schema_versions WHERE namespace='core'"),
      ).toEqual([{ version: 70 }]);
      await failing.destroy();
      const recovered = createPlatformDataSource({
        url: failedUrl,
        entities: localEntities,
        migrations: localMigrations,
      });
      await new OneShotMigrationRunner(recovered, "core", 95).run();
      expect(
        await recovered.query(
          "SELECT namespace,version FROM platform_schema_versions ORDER BY namespace",
        ),
      ).toEqual([
        { namespace: "core", version: 95 },
        { namespace: "pack:dummy", version: 1000 },
      ]);
      await recovered.destroy();

      const mock = createMockHubDataSource(databaseUrl(postgres.url, "awp_mock"));
      await migrateMockHub(mock);
      expect(await mock.query("SELECT count(*)::int AS count FROM mock_hub_migrations")).toEqual([
        { count: mockHubMigrations.length },
      ]);
      expect(await mock.runMigrations({ transaction: "all" })).toEqual([]);
      expect(
        await mock.query(
          "SELECT to_regclass('public.mock_effects') AS effects,to_regclass('public.platform_schema_versions') AS platform",
        ),
      ).toEqual([{ effects: "mock_effects", platform: null }]);
      await mock.destroy();
    },
    240_000,
  );
});
