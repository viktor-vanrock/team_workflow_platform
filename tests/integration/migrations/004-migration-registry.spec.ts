import { describe, expect, it } from "vitest";

import {
  mattermostMockEntities,
  mattermostMockMigrations,
} from "../../../apps/mock-hub/src/mattermost/mattermost.module.ts";
import { qaEntities, qaMigrationContributions } from "../../../packages/competency-qa/src/node.ts";
import {
  coreEntities,
  coreMigrationRegistry,
  validateMigrationRegistry,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";

describe("Feature 004 migration ownership and entity parity", () => {
  it("registers Core 0100–0120 and QA 2040 in strict order", () => {
    expect(
      coreMigrationRegistry
        .filter(({ order }) => order >= 100 && order <= 120)
        .map(({ order }) => order),
    ).toEqual([100, 105, 110, 120]);
    expect(
      qaMigrationContributions.filter(({ order }) => order === 2040).map(({ order }) => order),
    ).toEqual([2040]);
    expect(() =>
      validateMigrationRegistry([...coreMigrationRegistry, ...qaMigrationContributions]),
    ).not.toThrow();
  });
  it("maps every owned foundation table", () => {
    const tables = [...coreEntities, ...qaEntities, ...mattermostMockEntities].map(
      ({ options }) => options.tableName,
    );
    expect(tables).toEqual(
      expect.arrayContaining([
        "action_provenance_records",
        "interaction_intents",
        "agent_runs",
        "notification_intents",
        "qa_triage_assessments",
        "mock_mattermost_posts",
      ]),
    );
    expect(mattermostMockMigrations.map((Migration) => new Migration().name)).toHaveLength(3);
  });
});
