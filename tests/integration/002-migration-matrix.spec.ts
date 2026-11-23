import { afterEach, describe, expect, it } from "vitest";

import {
  createMockHubDataSource,
  mockHubMigrations,
} from "../../apps/mock-hub/src/persistence/data-source.ts";
import { createPlatformDataSource } from "../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../packages/platform-testkit/src/postgres.ts";
import {
  qaLocalEntities,
  qaLocalMigrationRegistry,
} from "../../packages/runtime-composition/src/qa/composition.ts";
import { historicalMigrations } from "../support/historical-migrations.ts";
import { POSTGRES_TEST_IMAGES } from "../testcontainers.config.ts";

interface QueryExecutor {
  query(sql: string): Promise<unknown>;
}
const qaLocalMigrations = historicalMigrations(qaLocalMigrationRegistry, {
  core: 95,
  "pack:dummy": 1000,
  "pack:qa": 2030,
});
class QaInjectedFailure20401700000002040 {
  readonly name = "QaInjectedFailure20401700000002040";
  async up(queryRunner: QueryExecutor): Promise<void> {
    await queryRunner.query("CREATE TABLE qa_failed_migration_probe(id integer PRIMARY KEY)");
    throw new Error("QA_INJECTED_MIGRATION_FAILURE");
  }
  async down(queryRunner: QueryExecutor): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS qa_failed_migration_probe");
  }
}
class MockInjectedFailure00401700000002040 {
  readonly name = "MockInjectedFailure00401700000002040";
  async up(queryRunner: QueryExecutor): Promise<void> {
    await queryRunner.query("CREATE TABLE mock_failed_migration_probe(id integer PRIMARY KEY)");
    throw new Error("MOCK_INJECTED_MIGRATION_FAILURE");
  }
  async down(queryRunner: QueryExecutor): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS mock_failed_migration_probe");
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

describe("Feature 002 PostgreSQL 17/18 migration matrix", () => {
  it.each(POSTGRES_TEST_IMAGES)(
    "runs QA and isolated Mock Hub fresh/repeat/current-1/failure recovery on %s",
    async (image) => {
      const postgres = await startPostgres(image);
      running.push(postgres);
      const admin = createPlatformDataSource({ url: postgres.url, entities: [], migrations: [] });
      await admin.initialize();
      for (const database of ["qa_upgrade", "qa_failed", "qa_mock", "mock_failed"])
        await admin.query(`CREATE DATABASE ${database}`);
      await admin.destroy();

      const fresh = createPlatformDataSource({
        url: postgres.url,
        entities: qaLocalEntities,
        migrations: qaLocalMigrations,
      });
      await fresh.initialize();
      await fresh.runMigrations({ transaction: "all" });
      // The original 2010–2030 migrations did not advance the namespace marker.
      expect(
        await fresh.query(
          "SELECT namespace,version FROM platform_schema_versions ORDER BY namespace",
        ),
      ).toEqual([
        { namespace: "core", version: 95 },
        { namespace: "pack:dummy", version: 1000 },
        { namespace: "pack:qa", version: 2000 },
      ]);
      expect(await fresh.query("SELECT to_regclass('public.qa_verdicts') AS verdicts")).toEqual([
        { verdicts: "qa_verdicts" },
      ]);
      expect(await fresh.runMigrations({ transaction: "all" })).toEqual([]);
      await fresh.destroy();

      const upgradeUrl = databaseUrl(postgres.url, "qa_upgrade");
      const previous = createPlatformDataSource({
        url: upgradeUrl,
        entities: qaLocalEntities,
        migrations: qaLocalMigrations.slice(0, -1),
      });
      await previous.initialize();
      await previous.runMigrations({ transaction: "all" });
      expect(await previous.query("SELECT to_regclass('public.qa_verdicts') AS verdicts")).toEqual([
        { verdicts: null },
      ]);
      await previous.destroy();
      const upgraded = createPlatformDataSource({
        url: upgradeUrl,
        entities: qaLocalEntities,
        migrations: qaLocalMigrations,
      });
      await upgraded.initialize();
      await upgraded.runMigrations({ transaction: "all" });
      expect(await upgraded.query("SELECT to_regclass('public.qa_verdicts') AS verdicts")).toEqual([
        { verdicts: "qa_verdicts" },
      ]);
      await upgraded.destroy();

      const failedUrl = databaseUrl(postgres.url, "qa_failed");
      const failedPrevious = createPlatformDataSource({
        url: failedUrl,
        entities: qaLocalEntities,
        migrations: qaLocalMigrations.slice(0, -1),
      });
      await failedPrevious.initialize();
      await failedPrevious.runMigrations({ transaction: "all" });
      await failedPrevious.destroy();
      const failing = createPlatformDataSource({
        url: failedUrl,
        entities: qaLocalEntities,
        migrations: [...qaLocalMigrations, QaInjectedFailure20401700000002040],
      });
      await failing.initialize();
      await expect(failing.runMigrations({ transaction: "all" })).rejects.toThrow(
        "QA_INJECTED_MIGRATION_FAILURE",
      );
      expect(
        await failing.query(
          "SELECT to_regclass('public.qa_failed_migration_probe') AS probe,to_regclass('public.qa_verdicts') AS verdicts",
        ),
      ).toEqual([{ probe: null, verdicts: null }]);
      await failing.destroy();
      const recovered = createPlatformDataSource({
        url: failedUrl,
        entities: qaLocalEntities,
        migrations: qaLocalMigrations,
      });
      await recovered.initialize();
      await recovered.runMigrations({ transaction: "all" });
      expect(await recovered.query("SELECT to_regclass('public.qa_verdicts') AS verdicts")).toEqual(
        [{ verdicts: "qa_verdicts" }],
      );
      await recovered.destroy();

      const mock = createMockHubDataSource(databaseUrl(postgres.url, "qa_mock"));
      await mock.initialize();
      await mock.runMigrations({ transaction: "all" });
      expect(await mock.query("SELECT count(*)::int AS count FROM mock_hub_migrations")).toEqual([
        { count: mockHubMigrations.length },
      ]);
      expect(await mock.runMigrations({ transaction: "all" })).toEqual([]);
      await mock.destroy();
      const mockFailed = createMockHubDataSource(databaseUrl(postgres.url, "mock_failed"), [
        ...mockHubMigrations,
        MockInjectedFailure00401700000002040,
      ]);
      await mockFailed.initialize();
      await expect(mockFailed.runMigrations({ transaction: "all" })).rejects.toThrow(
        "MOCK_INJECTED_MIGRATION_FAILURE",
      );
      expect(
        await mockFailed.query(
          "SELECT to_regclass('public.mock_failed_migration_probe') AS probe,to_regclass('public.operational_completion_effects') AS completion",
        ),
      ).toEqual([{ probe: null, completion: null }]);
      await mockFailed.destroy();
      const mockRecovered = createMockHubDataSource(databaseUrl(postgres.url, "mock_failed"));
      await mockRecovered.initialize();
      await mockRecovered.runMigrations({ transaction: "all" });
      expect(
        await mockRecovered.query("SELECT count(*)::int AS count FROM mock_hub_migrations"),
      ).toEqual([{ count: mockHubMigrations.length }]);
      await mockRecovered.destroy();
    },
    300_000,
  );
});
