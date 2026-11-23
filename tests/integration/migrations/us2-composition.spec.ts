import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  coreMigrationRegistry,
  createPlatformDataSource,
  OneShotMigrationRunner,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";
import {
  type RunningPostgres,
  startPostgres,
} from "../../../packages/platform-testkit/src/postgres.ts";
import {
  localMigrationRegistry,
  localMigrations,
} from "../../../packages/runtime-composition/src/migrations/composition.ts";
import { localEntities } from "../../../packages/runtime-composition/src/persistence/entity-composition.ts";

describe("US2 composed Core + local Pack migration chain", () => {
  let postgres: RunningPostgres;
  let dataSource: ReturnType<typeof createPlatformDataSource>;
  beforeAll(async () => {
    postgres = await startPostgres();
    dataSource = createPlatformDataSource({
      url: postgres.url,
      entities: localEntities,
      migrations: localMigrations,
    });
    await new OneShotMigrationRunner(dataSource, "core", coreMigrationRegistry.at(-1)!.order).run();
  }, 120_000);
  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    if (postgres) await postgres.stop();
  });

  it("applies the current monotonic Core prefix before the local Pack migrations", async () => {
    const versions = (await dataSource.query(
      "SELECT namespace,version FROM platform_schema_versions ORDER BY namespace",
    )) as readonly { namespace: string; version: number }[];
    expect(versions).toEqual([
      { namespace: "core", version: coreMigrationRegistry.at(-1)!.order },
      { namespace: "pack:dummy", version: 1000 },
      { namespace: "pack:tech-writing", version: 1100 },
    ]);
    expect(localMigrationRegistry.slice(0, coreMigrationRegistry.length)).toEqual(
      coreMigrationRegistry,
    );
    expect(localMigrationRegistry.slice(coreMigrationRegistry.length)).toMatchObject([
      { owner: "pack:dummy", order: 1000 },
      { owner: "pack:tech-writing", order: 1100 },
    ]);
    expect(localMigrations.map((Migration) => new Migration().name)).toEqual(
      localMigrationRegistry.map(({ migration: Migration }) => new Migration().name),
    );
  });

  it("keeps Dummy storage Pack-owned but present only in the local composition", async () => {
    const rows = (await dataSource.query(
      "SELECT to_regclass('public.dummy_requests') AS dummy, to_regclass('public.work_items') AS work",
    )) as readonly { dummy: string; work: string }[];
    expect(rows[0]).toEqual({ dummy: "dummy_requests", work: "work_items" });
    expect(localEntities.some((entity) => entity.options.tableName === "dummy_requests")).toBe(
      true,
    );
  });
});
