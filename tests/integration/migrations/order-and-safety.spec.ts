import { describe, expect, it } from "vitest";

import {
  coreMigrationRegistry,
  createPlatformDataSource,
  migrationClasses,
  OneShotMigrationRunner,
  validateMigrationRegistry,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";

describe("migration prefix order and safety", () => {
  it("pins the foundation prefix 0001 -> 0010 -> 0020 -> 0030 -> 0040", () => {
    expect(coreMigrationRegistry.slice(0, 5).map(({ order }) => order)).toEqual([
      1, 10, 20, 30, 40,
    ]);
    expect(() => validateMigrationRegistry(coreMigrationRegistry)).not.toThrow();
    expect(() =>
      validateMigrationRegistry([
        { order: 1, owner: "pack:bad", migration: coreMigrationRegistry[0]!.migration },
      ]),
    ).toThrow(/cannot own Core/u);
  });

  it("hard-codes synchronize:false and one-shot migration ownership", () => {
    const dataSource = createPlatformDataSource({
      url: "postgresql://unused:unused@127.0.0.1:1/unused",
      entities: [],
      migrations: migrationClasses(coreMigrationRegistry.slice(0, 5)),
    });
    expect(dataSource.options.synchronize).toBe(false);
    expect(dataSource.options.migrationsRun).toBe(false);
    expect(dataSource.options.migrations).toHaveLength(5);
  });

  it("fails fast when the durable schema version is not current", async () => {
    const fake = { isInitialized: true, query: async () => [{ version: 30 }] };
    const runner = new OneShotMigrationRunner(fake as never, "core", 40);
    await expect(runner.assertCurrentSchema()).rejects.toThrow(/expected 40/u);
  });
});
