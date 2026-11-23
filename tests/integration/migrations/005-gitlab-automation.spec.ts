import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createPlatformDataSource,
  migrationClasses,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { startPostgres } from "../../../packages/platform-testkit/src/postgres.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

interface QueryExecutor {
  query(sql: string): Promise<unknown>;
}
class Feature005InjectedFailure1700000004999 {
  readonly name = "Feature005InjectedFailure1700000004999";
  async up(queryRunner: QueryExecutor): Promise<void> {
    await queryRunner.query(
      "CREATE TABLE feature_005_failed_migration_probe(id integer PRIMARY KEY)",
    );
    throw new Error("FEATURE_005_INJECTED_MIGRATION_FAILURE");
  }
  async down(queryRunner: QueryExecutor): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS feature_005_failed_migration_probe");
  }
}

function databaseUrl(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

describe("Feature 005 PostgreSQL migration matrix", () => {
  it.each(POSTGRES_TEST_IMAGES)(
    "runs fresh, current-minus-one, repeat and failure recovery on %s",
    async (image) => {
      const { qaJiraGitLabLocalComposition, qaJiraGitLabLocalMigrationRegistry } =
        await import("../../../packages/runtime-composition/src/gitlab/composition.ts");
      const latestQaVersion = Math.max(
        ...qaJiraGitLabLocalMigrationRegistry
          .filter(({ owner }) => owner === "pack:qa")
          .map(({ order }) => order),
      );
      const postgres = await startPostgres(image);
      try {
        const admin = createPlatformDataSource({ url: postgres.url, entities: [], migrations: [] });
        await admin.initialize();
        await admin.query("CREATE DATABASE feature_005_upgrade");
        await admin.query("CREATE DATABASE feature_005_failed");
        await admin.destroy();

        const migrations = migrationClasses(qaJiraGitLabLocalMigrationRegistry);
        const fresh = createPlatformDataSource({
          url: postgres.url,
          entities: qaJiraGitLabLocalComposition.entities,
          migrations,
        });
        await fresh.initialize();
        await fresh.runMigrations({ transaction: "all" });
        expect(await fresh.runMigrations({ transaction: "all" })).toEqual([]);
        expect(
          await fresh.query(
            "SELECT namespace,version FROM platform_schema_versions WHERE namespace IN('pack:qa','connector:gitlab') ORDER BY namespace",
          ),
        ).toEqual([
          { namespace: "connector:gitlab", version: 4020 },
          { namespace: "pack:qa", version: latestQaVersion },
        ]);
        await fresh.destroy();

        const upgradeUrl = databaseUrl(postgres.url, "feature_005_upgrade");
        const previous = createPlatformDataSource({
          url: upgradeUrl,
          entities: qaJiraGitLabLocalComposition.entities,
          migrations: migrations.slice(0, -1),
        });
        await previous.initialize();
        await previous.runMigrations({ transaction: "all" });
        await previous.destroy();
        const upgraded = createPlatformDataSource({
          url: upgradeUrl,
          entities: qaJiraGitLabLocalComposition.entities,
          migrations,
        });
        await upgraded.initialize();
        expect(await upgraded.runMigrations({ transaction: "all" })).toHaveLength(1);
        await upgraded.destroy();

        const failedUrl = databaseUrl(postgres.url, "feature_005_failed");
        const failing = createPlatformDataSource({
          url: failedUrl,
          entities: qaJiraGitLabLocalComposition.entities,
          migrations: [...migrations, Feature005InjectedFailure1700000004999],
        });
        await failing.initialize();
        await expect(failing.runMigrations({ transaction: "all" })).rejects.toThrow(
          "FEATURE_005_INJECTED_MIGRATION_FAILURE",
        );
        expect(
          await failing.query(
            "SELECT to_regclass('public.feature_005_failed_migration_probe') AS probe,to_regclass('public.qa_attempt_identities') AS attempts",
          ),
        ).toEqual([{ probe: null, attempts: null }]);
        await failing.destroy();
        const recovered = createPlatformDataSource({
          url: failedUrl,
          entities: qaJiraGitLabLocalComposition.entities,
          migrations,
        });
        await recovered.initialize();
        await recovered.runMigrations({ transaction: "all" });
        await recovered.destroy();
      } finally {
        await postgres.stop();
      }
    },
    300_000,
  );

  it("keeps Feature 002 bytes pinned and declares deterministic MANUAL Attempt backfill", () => {
    const root = resolve(import.meta.dirname, "../../..");
    const report = JSON.parse(
      readFileSync(
        resolve(root, "reports/005-gitlab-automated-validation/prerequisites.json"),
        "utf8",
      ),
    ) as {
      readonly manifest: Readonly<{
        feature002ManualContracts: readonly Readonly<{ path: string; sha256: string }>[];
      }>;
    };
    for (const requirement of report.manifest.feature002ManualContracts) {
      const digest = `sha256:${createHash("sha256")
        .update(readFileSync(resolve(root, requirement.path)))
        .digest("hex")}`;
      expect(digest, requirement.path).toBe(requirement.sha256);
    }
    const migration = readFileSync(
      resolve(
        root,
        "packages/competency-qa/src/persistence/migrations/2050-qa-automation-foundation.ts",
      ),
      "utf8",
    );
    expect(migration).toMatch(
      /INSERT\s+INTO\s+qa_attempt_identities[\s\S]*FROM\s+qa_manual_attempts/iu,
    );
    expect(migration).toMatch(/MANUAL[\s\S]*HUMAN_MANUAL/iu);
  });
});
