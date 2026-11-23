import {
  migrationClasses,
  type OwnedMigration,
} from "../../packages/platform-persistence-typeorm/src/index.ts";

/** Freeze an old feature's migration boundary, without rewriting published migrations.
 * Current runtime/008 matrices independently exercise the complete registry.
 */
export function historicalRegistry(
  registry: readonly OwnedMigration[],
  versions: Readonly<Record<string, number>>,
): readonly OwnedMigration[] {
  return registry.filter(
    ({ owner, order }) => versions[owner] !== undefined && order <= versions[owner]!,
  );
}

export function historicalMigrations(
  registry: readonly OwnedMigration[],
  versions: Readonly<Record<string, number>>,
) {
  return migrationClasses(historicalRegistry(registry, versions));
}
