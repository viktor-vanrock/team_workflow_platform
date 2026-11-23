import type { MigrationInterface, QueryRunner } from "typeorm";
import { describe, expect, it } from "vitest";

import { gitLabMockMigrations } from "../../apps/mock-hub/src/gitlab/gitlab.module.ts";
import { createMockHubDataSource } from "../../apps/mock-hub/src/persistence/data-source.ts";
import { qaMigrationContributions } from "../../packages/competency-qa/src/node.ts";
import { gitLabMigrationRegistry } from "../../packages/connector-gitlab-persistence-typeorm/src/index.ts";
import {
  createPlatformDataSource,
  migrationClasses,
} from "../../packages/platform-persistence-typeorm/src/index.ts";
import { startPostgres } from "../../packages/platform-testkit/src/postgres.ts";
import { POSTGRES_TEST_IMAGES } from "../testcontainers.config.ts";

const FEATURE_005_POSTGRES_IMAGES = process.env.AWP_TEST_POSTGRES_IMAGE
  ? Object.freeze([process.env.AWP_TEST_POSTGRES_IMAGE])
  : POSTGRES_TEST_IMAGES;

async function executeMigrationQuery(queryRunner: QueryRunner, sql: string): Promise<void> {
  await queryRunner.query(sql);
}

class Feature005PlatformFailure1700000005998 implements MigrationInterface {
  readonly name = "Feature005PlatformFailure1700000005998";
  async up(queryRunner: QueryRunner): Promise<void> {
    await executeMigrationQuery(
      queryRunner,
      "CREATE TABLE feature_005_platform_failure_probe(id integer PRIMARY KEY)",
    );
    throw new Error("FEATURE_005_PLATFORM_MIGRATION_FAILURE");
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await executeMigrationQuery(
      queryRunner,
      "DROP TABLE IF EXISTS feature_005_platform_failure_probe",
    );
  }
}

class Feature005MockFailure1700000005999 implements MigrationInterface {
  readonly name = "Feature005MockFailure1700000005999";
  async up(queryRunner: QueryRunner): Promise<void> {
    await executeMigrationQuery(
      queryRunner,
      "CREATE TABLE feature_005_mock_failure_probe(id integer PRIMARY KEY)",
    );
    throw new Error("FEATURE_005_MOCK_MIGRATION_FAILURE");
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await executeMigrationQuery(queryRunner, "DROP TABLE IF EXISTS feature_005_mock_failure_probe");
  }
}

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

describe("Feature 005 aggregate PostgreSQL 17/18 migration matrix", () => {
  it.each(FEATURE_005_POSTGRES_IMAGES)(
    "runs all nine migrations fresh, upgrade, repeat, current-minus-one and failure recovery on %s",
    async (image) => {
      const { qaJiraGitLabLocalComposition, qaJiraGitLabLocalMigrationRegistry } =
        await import("../../packages/runtime-composition/src/gitlab/composition.ts");
      const platformMigrations = migrationClasses(qaJiraGitLabLocalMigrationRegistry);
      const featurePlatformNames = [
        ...qaMigrationContributions.filter(({ order }) => order >= 2050 && order <= 2060),
        ...gitLabMigrationRegistry,
      ].map(({ migration }) => new migration().name);
      const latestQaVersion = Math.max(
        ...qaJiraGitLabLocalMigrationRegistry
          .filter(({ owner }) => owner === "pack:qa")
          .map(({ order }) => order),
      );
      const featureMockNames = gitLabMockMigrations.map((Migration) => new Migration().name);
      expect(featurePlatformNames).toHaveLength(6);
      expect(featureMockNames).toHaveLength(3);
      expect(new Set([...featurePlatformNames, ...featureMockNames]).size).toBe(9);

      const postgres = await startPostgres(image);
      try {
        const admin = createPlatformDataSource({ url: postgres.url, entities: [], migrations: [] });
        await admin.initialize();
        for (const database of ["feature_005_upgrade", "feature_005_failed"])
          await admin.query(`CREATE DATABASE ${database}`);
        await admin.destroy();

        const freshPlatform = createPlatformDataSource({
          url: postgres.url,
          entities: qaJiraGitLabLocalComposition.entities,
          migrations: platformMigrations,
        });
        await freshPlatform.initialize();
        await freshPlatform.runMigrations({ transaction: "all" });
        expect(await freshPlatform.runMigrations({ transaction: "all" })).toEqual([]);
        const appliedPlatform = (await freshPlatform.query(
          "SELECT name FROM typeorm_migrations WHERE name=ANY($1::text[]) ORDER BY name",
          [featurePlatformNames],
        )) as readonly Readonly<{ name: string }>[];
        expect(appliedPlatform.map(({ name }) => name)).toEqual([...featurePlatformNames].sort());
        expect(
          await freshPlatform.query(
            "SELECT namespace,version FROM platform_schema_versions WHERE namespace IN('pack:qa','connector:gitlab') ORDER BY namespace",
          ),
        ).toEqual([
          { namespace: "connector:gitlab", version: 4020 },
          { namespace: "pack:qa", version: latestQaVersion },
        ]);
        await freshPlatform.destroy();

        const freshMock = createMockHubDataSource(postgres.url, gitLabMockMigrations);
        await freshMock.initialize();
        await freshMock.runMigrations({ transaction: "all" });
        expect(await freshMock.runMigrations({ transaction: "all" })).toEqual([]);
        const appliedMock = (await freshMock.query(
          "SELECT name FROM mock_hub_migrations ORDER BY name",
        )) as readonly Readonly<{ name: string }>[];
        expect(appliedMock.map(({ name }) => name)).toEqual([...featureMockNames].sort());
        await freshMock.destroy();

        const upgradeUrl = databaseUrl(postgres.url, "feature_005_upgrade");
        const previousPlatform = createPlatformDataSource({
          url: upgradeUrl,
          entities: qaJiraGitLabLocalComposition.entities,
          migrations: platformMigrations.slice(0, -1),
        });
        await previousPlatform.initialize();
        await previousPlatform.runMigrations({ transaction: "all" });
        await previousPlatform.destroy();
        const upgradedPlatform = createPlatformDataSource({
          url: upgradeUrl,
          entities: qaJiraGitLabLocalComposition.entities,
          migrations: platformMigrations,
        });
        await upgradedPlatform.initialize();
        expect(await upgradedPlatform.runMigrations({ transaction: "all" })).toHaveLength(1);
        await upgradedPlatform.destroy();

        const previousMock = createMockHubDataSource(upgradeUrl, gitLabMockMigrations.slice(0, -1));
        await previousMock.initialize();
        await previousMock.runMigrations({ transaction: "all" });
        await previousMock.destroy();
        const upgradedMock = createMockHubDataSource(upgradeUrl, gitLabMockMigrations);
        await upgradedMock.initialize();
        expect(await upgradedMock.runMigrations({ transaction: "all" })).toHaveLength(1);
        await upgradedMock.destroy();

        const failedUrl = databaseUrl(postgres.url, "feature_005_failed");
        const failedPlatform = createPlatformDataSource({
          url: failedUrl,
          entities: qaJiraGitLabLocalComposition.entities,
          migrations: [...platformMigrations, Feature005PlatformFailure1700000005998],
        });
        await failedPlatform.initialize();
        await expect(failedPlatform.runMigrations({ transaction: "all" })).rejects.toThrow(
          "FEATURE_005_PLATFORM_MIGRATION_FAILURE",
        );
        expect(
          await failedPlatform.query(
            "SELECT to_regclass('public.feature_005_platform_failure_probe') AS probe,to_regclass('public.qa_attempt_identities') AS feature_table",
          ),
        ).toEqual([{ probe: null, feature_table: null }]);
        await failedPlatform.destroy();

        const failedMock = createMockHubDataSource(failedUrl, [
          ...gitLabMockMigrations,
          Feature005MockFailure1700000005999,
        ]);
        await failedMock.initialize();
        await expect(failedMock.runMigrations({ transaction: "all" })).rejects.toThrow(
          "FEATURE_005_MOCK_MIGRATION_FAILURE",
        );
        expect(
          await failedMock.query(
            "SELECT to_regclass('public.feature_005_mock_failure_probe') AS probe,to_regclass('public.mock_gitlab_projects') AS feature_table",
          ),
        ).toEqual([{ probe: null, feature_table: null }]);
        await failedMock.destroy();

        const recoveredPlatform = createPlatformDataSource({
          url: failedUrl,
          entities: qaJiraGitLabLocalComposition.entities,
          migrations: platformMigrations,
        });
        await recoveredPlatform.initialize();
        await recoveredPlatform.runMigrations({ transaction: "all" });
        await recoveredPlatform.destroy();
        const recoveredMock = createMockHubDataSource(failedUrl, gitLabMockMigrations);
        await recoveredMock.initialize();
        await recoveredMock.runMigrations({ transaction: "all" });
        await recoveredMock.destroy();
      } finally {
        await postgres.stop();
      }
    },
    300_000,
  );
});
