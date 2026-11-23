import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { qaEntities, qaMigrationContributions } from "../../../packages/competency-qa/src/node.ts";
import {
  coreMigrationRegistry,
  validateMigrationRegistry,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string): string =>
  existsSync(resolve(root, path)) ? readFileSync(resolve(root, path), "utf8") : "";

function createdTables(source: string): readonly string[] {
  return [...source.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?([a-z0-9_]+)/giu)]
    .map((match) => match[1]!)
    .sort();
}

describe("Feature 006 migration ownership and entity parity", () => {
  it("registers Core 0130/0135/0140 and QA 2070 in monotonic non-colliding owner ranges", () => {
    expect(
      coreMigrationRegistry
        .filter(({ order }) => order >= 130 && order <= 140)
        .map(({ order, owner }) => [order, owner]),
    ).toEqual([
      [130, "core"],
      [135, "core"],
      [140, "core"],
    ]);
    expect(qaMigrationContributions.find(({ order }) => order === 2070)).toMatchObject({
      order: 2070,
      owner: "pack:qa",
    });
    expect(() =>
      validateMigrationRegistry([...coreMigrationRegistry, ...qaMigrationContributions]),
    ).not.toThrow();
  });

  it("keeps schema-only owner DDL on the correct side of the Core/QA boundary", () => {
    const core = [
      "packages/platform-persistence-typeorm/src/migrations/core/0130-queue-policy-calendar.ts",
      "packages/platform-persistence-typeorm/src/migrations/core/0135-queue-projection-sla.ts",
      "packages/platform-persistence-typeorm/src/migrations/core/0140-queue-controls-capacity.ts",
    ]
      .map(read)
      .join("\n");
    const qa = read("packages/competency-qa/src/persistence/migrations/2070-qa-queue-facts.ts");
    expect(core.length).toBeGreaterThan(1_000);
    expect(qa.length).toBeGreaterThan(500);
    expect(core).not.toMatch(/CREATE\s+TABLE\s+qa_|REFERENCES\s+qa_/iu);
    expect(qa).not.toMatch(
      /CREATE\s+TABLE\s+(?:queue_|workspace_queue_|sla_|capacity_|work_item_queue_)/iu,
    );
    expect(`${core}\n${qa}`).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*(?:qa_|queue_|workspace_queue_|sla_|capacity_)/iu,
    );
  });

  it("maps every owned Feature 006 table to exactly one entity", async () => {
    const coreSource = [130, 135, 140]
      .map((order) =>
        read(
          `packages/platform-persistence-typeorm/src/migrations/core/0${order}-${order === 130 ? "queue-policy-calendar" : order === 135 ? "queue-projection-sla" : "queue-controls-capacity"}.ts`,
        ),
      )
      .join("\n");
    const qaSource = read(
      "packages/competency-qa/src/persistence/migrations/2070-qa-queue-facts.ts",
    );
    const { queueManagementEntities } =
      await import("../../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts");
    const coreEntityTables = queueManagementEntities.map(({ options }) =>
      String(options.tableName),
    );
    const qaEntityTables = qaEntities.map(({ options }) => String(options.tableName));
    const allOwnedTables = [...createdTables(coreSource), ...createdTables(qaSource)];
    expect(allOwnedTables.length).toBeGreaterThan(20);
    expect(new Set(allOwnedTables).size).toBe(allOwnedTables.length);
    for (const table of createdTables(coreSource)) expect(coreEntityTables, table).toContain(table);
    for (const table of createdTables(qaSource)) expect(qaEntityTables, table).toContain(table);
  });
});
