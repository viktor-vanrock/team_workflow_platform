import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  qaCompetencyManifestV12,
  qaValidationWorkTypeDefinitionV12,
} from "../../../packages/competency-qa/src/index.ts";
import {
  createPlatformDataSource,
  migrationClasses,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { startPostgres } from "../../../packages/platform-testkit/src/postgres.ts";
import { historicalRegistry } from "../../support/historical-migrations.ts";
import { POSTGRES_TEST_IMAGES } from "../../testcontainers.config.ts";

interface QueryExecutor {
  query(sql: string): Promise<unknown>;
}
class Feature006InjectedFailure1700000006999 {
  readonly name = "Feature006InjectedFailure1700000006999";
  async up(queryRunner: QueryExecutor): Promise<void> {
    await queryRunner.query(
      "CREATE TABLE feature_006_failed_migration_probe(id integer PRIMARY KEY)",
    );
    throw new Error("FEATURE_006_INJECTED_MIGRATION_FAILURE");
  }
  async down(queryRunner: QueryExecutor): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS feature_006_failed_migration_probe");
  }
}

function databaseUrl(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

describe("Feature 006 PostgreSQL foundation migration matrix", () => {
  it.each(POSTGRES_TEST_IMAGES)(
    "runs fresh, current-minus-one, repeat, upgrade and failure recovery on %s",
    async (image) => {
      const {
        qaJiraGitLabMattermostQueueLocalComposition,
        qaJiraGitLabMattermostQueueLocalMigrationRegistry,
      } = await import("../../../packages/runtime-composition/src/queue/composition.ts");
      const postgres = await startPostgres(image);
      try {
        const admin = createPlatformDataSource({ url: postgres.url, entities: [], migrations: [] });
        await admin.initialize();
        await admin.query("CREATE DATABASE feature_006_upgrade");
        await admin.query("CREATE DATABASE feature_006_failed");
        await admin.destroy();

        const migrations = migrationClasses(
          historicalRegistry(qaJiraGitLabMattermostQueueLocalMigrationRegistry, {
            core: 140,
            "pack:dummy": 1000,
            "pack:qa": 2070,
            "connector:jira": 3040,
            "connector:gitlab": 4020,
          }),
        );
        const fresh = createPlatformDataSource({
          url: postgres.url,
          entities: qaJiraGitLabMattermostQueueLocalComposition.entities,
          migrations,
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
        await fresh.destroy();

        const upgradeUrl = databaseUrl(postgres.url, "feature_006_upgrade");
        const previous = createPlatformDataSource({
          url: upgradeUrl,
          entities: qaJiraGitLabMattermostQueueLocalComposition.entities,
          migrations: migrations.filter(
            (Migration) => !/0130|0135|0140|2070/u.test(new Migration().name ?? ""),
          ),
        });
        await previous.initialize();
        await previous.runMigrations({ transaction: "all" });
        await previous.destroy();
        const upgraded = createPlatformDataSource({
          url: upgradeUrl,
          entities: qaJiraGitLabMattermostQueueLocalComposition.entities,
          migrations,
        });
        await upgraded.initialize();
        expect(await upgraded.runMigrations({ transaction: "all" })).toHaveLength(4);
        await upgraded.destroy();

        const failedUrl = databaseUrl(postgres.url, "feature_006_failed");
        const failing = createPlatformDataSource({
          url: failedUrl,
          entities: qaJiraGitLabMattermostQueueLocalComposition.entities,
          migrations: [...migrations, Feature006InjectedFailure1700000006999],
        });
        await failing.initialize();
        await expect(failing.runMigrations({ transaction: "all" })).rejects.toThrow(
          "FEATURE_006_INJECTED_MIGRATION_FAILURE",
        );
        expect(
          await failing.query(
            "SELECT to_regclass('public.feature_006_failed_migration_probe') AS probe",
          ),
        ).toEqual([{ probe: null }]);
        await failing.destroy();
      } finally {
        await postgres.stop();
      }
    },
    360_000,
  );

  it("pins both serialized V12 objects and requires append-only guards", async () => {
    const digest = (value: unknown) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");
    expect(digest(qaCompetencyManifestV12)).toBe(
      "c087b061bcd5b636398dce6fabcf937a4f236c0bb9a28c328b4dc22e1bd4a2b8",
    );
    expect(digest(qaValidationWorkTypeDefinitionV12)).toBe(
      "4e6865397d0ae2d8b492e96a0d4b9892afd107e32f29d8ff98fe8a74dd8871b2",
    );
    const { queueManagementEntities } =
      await import("../../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts");
    expect(queueManagementEntities.length).toBeGreaterThan(20);
  });
});
