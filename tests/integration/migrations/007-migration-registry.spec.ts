import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { qaEntities, qaMigrationContributions } from "../../../packages/competency-qa/src/node.ts";
import {
  coreMigrationRegistry,
  onboardingFoundationEntities,
  validateMigrationRegistry,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";

const root = resolve(import.meta.dirname, "../../..");
const corePaths = [
  "packages/platform-persistence-typeorm/src/migrations/core/0150-project-onboarding.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0155-project-binding-entitlements.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0160-artifact-retention-export.ts",
];
const qaPaths = [
  "packages/competency-qa/src/persistence/migrations/2080-project-resources.ts",
  "packages/competency-qa/src/persistence/migrations/2085-evidence-integrity.ts",
];
const read = (paths: readonly string[]) =>
  paths.map((path) => readFileSync(resolve(root, path), "utf8")).join("\n");
const createdTables = (source: string) =>
  [...source.matchAll(/CREATE\s+TABLE\s+([a-z0-9_]+)/giu)].map((match) => match[1]!);

describe("Feature 007 migration ownership registry", () => {
  it("adds the immutable Core 0150/0155/0160 chain without collisions", () => {
    expect(
      coreMigrationRegistry
        .filter(({ order }) => order >= 150 && order <= 160)
        .map(({ order, owner }) => ({ order, owner })),
    ).toEqual([
      { order: 150, owner: "core" },
      { order: 155, owner: "core" },
      { order: 160, owner: "core" },
    ]);
    expect(() => validateMigrationRegistry(coreMigrationRegistry)).not.toThrow();
    expect(coreMigrationRegistry.map(({ order }) => order)).toEqual(
      [...coreMigrationRegistry.map(({ order }) => order)].sort((a, b) => a - b),
    );
  });

  it("adds only QA-owned 2080/2085 tables after the immutable 2070 tail", () => {
    const tail = qaMigrationContributions.filter(({ order }) => order >= 2080 && order <= 2085);
    expect(tail.map(({ order, owner }) => ({ order, owner }))).toEqual([
      { order: 2080, owner: "pack:qa" },
      { order: 2085, owner: "pack:qa" },
    ]);
    expect(tail.flatMap(({ tables }) => tables).every((table) => table.startsWith("qa_"))).toBe(
      true,
    );
    const tables = qaMigrationContributions.flatMap(({ tables }) => tables);
    expect(new Set(tables)).toHaveProperty("size", tables.length);
  });

  it("keeps new-table DDL inside its owner and maps every owned table exactly once", () => {
    const core = read(corePaths);
    const qa = read(qaPaths);
    expect(core).not.toMatch(/CREATE\s+TABLE\s+qa_/iu);
    expect(qa).not.toMatch(
      /CREATE\s+TABLE\s+(?:project_|binding_|capability_|artifact_|evidence_export_)/iu,
    );

    const coreOwned = createdTables(core);
    const qaOwned = createdTables(qa);
    expect(new Set([...coreOwned, ...qaOwned]).size).toBe(coreOwned.length + qaOwned.length);
    const coreEntityTables = onboardingFoundationEntities.map(({ options }) =>
      String(options.tableName),
    );
    const qaEntityTables = qaEntities.map(({ options }) => String(options.tableName));
    for (const table of coreOwned) expect(coreEntityTables, table).toContain(table);
    for (const table of qaOwned) expect(qaEntityTables, table).toContain(table);
  });
});
