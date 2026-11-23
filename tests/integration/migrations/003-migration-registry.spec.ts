import { describe, expect, it } from "vitest";

import { jiraMigrationRegistry } from "../../../packages/connector-jira-persistence-typeorm/src/index.ts";
import {
  coreMigrationRegistry,
  validateMigrationRegistry,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";

describe("Feature 003 migration ownership", () => {
  it("accepts connector ownership and preserves strict global order", () => {
    expect(jiraMigrationRegistry.map(({ order, owner }) => [order, owner])).toEqual([
      [3000, "connector:jira"],
      [3010, "connector:jira"],
      [3020, "connector:jira"],
      [3030, "connector:jira"],
      [3040, "connector:jira"],
      [3050, "connector:jira"],
    ]);
    expect(() =>
      validateMigrationRegistry([...coreMigrationRegistry, ...jiraMigrationRegistry]),
    ).not.toThrow();
  });

  it("rejects collisions and empty reserved migrations", () => {
    expect(() =>
      validateMigrationRegistry([
        jiraMigrationRegistry[0]!,
        { ...jiraMigrationRegistry[1]!, order: 3000 },
      ]),
    ).toThrow(/order/u);
    expect(
      jiraMigrationRegistry.every(
        ({ migration }) => !new migration().name.toLowerCase().includes("reserved"),
      ),
    ).toBe(true);
  });
});
