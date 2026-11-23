import type { MigrationInterface, QueryRunner } from "typeorm";
import { describe, expect, it } from "vitest";

import {
  createMockHubDataSource,
  mockHubMigrations,
} from "../../apps/mock-hub/src/persistence/data-source.ts";
import {
  createPlatformDataSource,
  migrationClasses,
} from "../../packages/platform-persistence-typeorm/src/index.ts";
import { startPostgres } from "../../packages/platform-testkit/src/postgres.ts";
import {
  qaJiraGitLabMattermostQueueLocalComposition,
  qaJiraGitLabMattermostQueueLocalMigrationRegistry,
} from "../../packages/runtime-composition/src/queue/composition.ts";
import { queueProjectionReadState } from "../../packages/runtime-composition/src/queue/projection-rebuild.ts";
import { historicalRegistry } from "../support/historical-migrations.ts";
import { POSTGRES_TEST_IMAGES } from "../testcontainers.config.ts";

const FEATURE_006_POSTGRES_IMAGES = process.env.AWP_TEST_POSTGRES_IMAGE
  ? Object.freeze([process.env.AWP_TEST_POSTGRES_IMAGE])
  : POSTGRES_TEST_IMAGES;
const featureOrders = new Set([130, 135, 140, 2070]);

async function execute(queryRunner: QueryRunner, sql: string): Promise<void> {
  await (queryRunner.query as (query: string) => Promise<unknown>)(sql);
}

class Feature006InjectedFailure1700000006999 implements MigrationInterface {
  readonly name = "Feature006InjectedFailure1700000006999";
  async up(queryRunner: QueryRunner): Promise<void> {
    await execute(
      queryRunner,
      "CREATE TABLE feature_006_failed_migration_probe(id integer PRIMARY KEY)",
    );
    throw new Error("FEATURE_006_MIGRATION_FAILURE");
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await execute(queryRunner, "DROP TABLE IF EXISTS feature_006_failed_migration_probe");
  }
}

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

describe("Feature 006 aggregate PostgreSQL 17/18 migration matrix", () => {
  it.each(FEATURE_006_POSTGRES_IMAGES)(
    "runs fresh, repeat, current-minus-one, failure recovery and runtime readiness on %s",
    async (image) => {
      const fullRegistry = historicalRegistry(qaJiraGitLabMattermostQueueLocalMigrationRegistry, {
        core: 140,
        "pack:dummy": 1000,
        "pack:qa": 2070,
        "connector:jira": 3040,
        "connector:gitlab": 4020,
      });
      const previousRegistry = fullRegistry.filter(({ order }) => !featureOrders.has(order));
      const fullMigrations = migrationClasses(fullRegistry);
      const previousMigrations = migrationClasses(previousRegistry);
      const featureNames = fullRegistry
        .filter(({ order }) => featureOrders.has(order))
        .map(({ migration }) => new migration().name);
      expect(featureNames).toHaveLength(4);
      expect(qaJiraGitLabMattermostQueueLocalComposition.key).toBe(
        "qa-jira-gitlab-mattermost-queue-local",
      );
      expect(queueProjectionReadState([{ state: "ACTIVE" }, { state: "BUILDING" }])).toBe(
        "REBUILDING",
      );

      const postgres = await startPostgres(image);
      try {
        const admin = createPlatformDataSource({ url: postgres.url, entities: [], migrations: [] });
        await admin.initialize();
        for (const database of ["feature_006_upgrade", "feature_006_failed", "feature_006_mock"])
          await admin.query(`CREATE DATABASE ${database}`);
        await admin.destroy();

        const fresh = createPlatformDataSource({
          url: postgres.url,
          entities: qaJiraGitLabMattermostQueueLocalComposition.entities,
          migrations: fullMigrations,
        });
        await fresh.initialize();
        await fresh.runMigrations({ transaction: "all" });
        expect(await fresh.runMigrations({ transaction: "all" })).toEqual([]);
        expect(
          await fresh.query(
            "SELECT namespace,version FROM platform_schema_versions WHERE namespace IN('core','pack:qa') ORDER BY namespace",
          ),
        ).toEqual([
          { namespace: "core", version: 140 },
          { namespace: "pack:qa", version: 2070 },
        ]);
        expect(
          await fresh.query(`SELECT
        to_regclass('public.queue_entry_heads') AS queue,
        to_regclass('public.sla_clock_heads') AS sla,
        to_regclass('public.workspace_capacity_heads') AS capacity,
        to_regclass('public.qa_queue_fact_heads') AS qa_facts`),
        ).toEqual([
          {
            queue: "queue_entry_heads",
            sla: "sla_clock_heads",
            capacity: "workspace_capacity_heads",
            qa_facts: "qa_queue_fact_heads",
          },
        ]);
        const applied = (await fresh.query(
          "SELECT name FROM typeorm_migrations WHERE name=ANY($1::text[]) ORDER BY name",
          [featureNames],
        )) as readonly Readonly<{ name: string }>[];
        expect(applied.map(({ name }) => name)).toEqual([...featureNames].sort());
        await fresh.destroy();

        const upgradeUrl = databaseUrl(postgres.url, "feature_006_upgrade");
        const previous = createPlatformDataSource({
          url: upgradeUrl,
          entities: qaJiraGitLabMattermostQueueLocalComposition.entities,
          migrations: previousMigrations,
        });
        await previous.initialize();
        await previous.runMigrations({ transaction: "all" });
        expect(
          await previous.query(
            "SELECT to_regclass('public.queue_entry_heads') AS queue,to_regclass('public.qa_queue_fact_heads') AS qa_facts",
          ),
        ).toEqual([{ queue: null, qa_facts: null }]);
        await previous.destroy();
        const upgraded = createPlatformDataSource({
          url: upgradeUrl,
          entities: qaJiraGitLabMattermostQueueLocalComposition.entities,
          migrations: fullMigrations,
        });
        await upgraded.initialize();
        expect(await upgraded.runMigrations({ transaction: "all" })).toHaveLength(4);
        expect(await upgraded.runMigrations({ transaction: "all" })).toEqual([]);
        await upgraded.destroy();

        const failedUrl = databaseUrl(postgres.url, "feature_006_failed");
        const failedPrevious = createPlatformDataSource({
          url: failedUrl,
          entities: qaJiraGitLabMattermostQueueLocalComposition.entities,
          migrations: previousMigrations,
        });
        await failedPrevious.initialize();
        await failedPrevious.runMigrations({ transaction: "all" });
        await failedPrevious.destroy();
        const failing = createPlatformDataSource({
          url: failedUrl,
          entities: qaJiraGitLabMattermostQueueLocalComposition.entities,
          migrations: [...fullMigrations, Feature006InjectedFailure1700000006999],
        });
        await failing.initialize();
        await expect(failing.runMigrations({ transaction: "all" })).rejects.toThrow(
          "FEATURE_006_MIGRATION_FAILURE",
        );
        expect(
          await failing.query(
            "SELECT to_regclass('public.feature_006_failed_migration_probe') AS probe,to_regclass('public.queue_entry_heads') AS queue",
          ),
        ).toEqual([{ probe: null, queue: null }]);
        await failing.destroy();
        const recovered = createPlatformDataSource({
          url: failedUrl,
          entities: qaJiraGitLabMattermostQueueLocalComposition.entities,
          migrations: fullMigrations,
        });
        await recovered.initialize();
        expect(await recovered.runMigrations({ transaction: "all" })).toHaveLength(4);
        await recovered.destroy();

        const mock = createMockHubDataSource(databaseUrl(postgres.url, "feature_006_mock"));
        await mock.initialize();
        await mock.runMigrations({ transaction: "all" });
        expect(await mock.runMigrations({ transaction: "all" })).toEqual([]);
        expect(await mock.query("SELECT count(*)::int AS count FROM mock_hub_migrations")).toEqual([
          { count: mockHubMigrations.length },
        ]);
        await mock.destroy();
      } finally {
        await postgres.stop();
      }
    },
    300_000,
  );
});
