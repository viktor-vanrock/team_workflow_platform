import type { MigrationInterface } from "typeorm";

export interface OwnedMigration {
  readonly order: number;
  readonly owner: "core" | `pack:${string}` | `connector:${string}` | `app:${string}`;
  readonly migration: new () => MigrationInterface;
}

export function validateMigrationRegistry(registry: readonly OwnedMigration[]): void {
  const orders = new Set<number>();
  const names = new Set<string>();
  let previous = -1;
  for (const entry of registry) {
    const instance = new entry.migration();
    const name = instance.name;
    if (!Number.isSafeInteger(entry.order) || entry.order <= previous)
      throw new Error(`Migrations must be strictly ordered: ${entry.order}`);
    if (orders.has(entry.order)) throw new Error(`Migration order collision: ${entry.order}`);
    if (!name || names.has(name))
      throw new Error(`Migration name is missing or duplicated: ${name}`);
    if (entry.owner === "core" && entry.order >= 1000)
      throw new Error(`Core cannot own extension migration order ${entry.order}`);
    if (entry.owner !== "core" && entry.order < 1000)
      throw new Error(`${entry.owner} cannot own Core migration order ${entry.order}`);
    previous = entry.order;
    orders.add(entry.order);
    names.add(name);
  }
}

export function migrationClasses(
  registry: readonly OwnedMigration[],
): readonly (new () => MigrationInterface)[] {
  validateMigrationRegistry(registry);
  return registry.map((entry) => entry.migration);
}
