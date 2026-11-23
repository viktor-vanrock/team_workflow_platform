import type { DataSource } from "typeorm";

import { localMigrationRegistry } from "../migrations/composition.ts";
import { schemaVersions } from "../pilot/composition.ts";
import { type LocalSeedResult, runLocalSeed } from "../seed/local-seed.ts";

export interface LocalBootstrapResult {
  readonly profile: "local";
  readonly schema: "ready";
  readonly seed: LocalSeedResult;
}

export async function migrateLocalDatabase(
  dataSource: DataSource,
  options: Readonly<{
    profile: string;
    expectedVersions?: Readonly<Record<string, number>>;
  }>,
): Promise<void> {
  if (options.profile !== "local") throw new Error("LOCAL_BOOTSTRAP_PROFILE_REQUIRED");
  if (!dataSource.isInitialized) await dataSource.initialize();
  await dataSource.query("SELECT pg_advisory_lock(hashtext('awp:migrate:local-composition'))");
  try {
    await dataSource.runMigrations({ transaction: "all" });
    const expectedVersions: Readonly<Record<string, number>> =
      options.expectedVersions ?? schemaVersions(localMigrationRegistry);
    const namespaces = Object.keys(expectedVersions).sort();
    const versions = (await dataSource.query(
      "SELECT namespace,version FROM platform_schema_versions WHERE namespace = ANY($1::text[]) ORDER BY namespace",
      [namespaces],
    )) as readonly { namespace: string; version: number }[];
    const current = new Map(versions.map((row) => [row.namespace, row.version]));
    if (
      versions.length !== namespaces.length ||
      namespaces.some((namespace) => current.get(namespace) !== expectedVersions[namespace])
    ) {
      throw new Error("LOCAL_SCHEMA_NOT_CURRENT");
    }
  } finally {
    await dataSource.query("SELECT pg_advisory_unlock(hashtext('awp:migrate:local-composition'))");
  }
}

export async function bootstrapLocalDatabase(
  dataSource: DataSource,
  options: Readonly<{ profile: string }>,
): Promise<LocalBootstrapResult> {
  await migrateLocalDatabase(dataSource, options);
  const seed = await runLocalSeed(dataSource);
  return Object.freeze({ profile: "local", schema: "ready", seed });
}
