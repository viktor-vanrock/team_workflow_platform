import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { dummyMigrationRegistry } from "../../../packages/competency-dummy/src/index.ts";
import {
  coreMigrationRegistry,
  type OwnedMigration,
  validateMigrationRegistry,
} from "../../../packages/platform-persistence-typeorm/src/index.ts";

interface QaPersistenceInventorySlice {
  readonly order: number;
  readonly key: string;
  readonly sourcePath: string;
  readonly tables: readonly string[];
}

interface QaMigrationContribution extends OwnedMigration {
  readonly owner: "pack:qa";
  readonly tables: readonly string[];
}

interface QaEntityContribution {
  readonly migrationOrder: QaPersistenceInventorySlice["order"];
  readonly tableName: string;
  readonly entity: unknown;
}

type QaNodeExports = Readonly<{
  qaPersistenceInventory?: readonly QaPersistenceInventorySlice[];
  qaMigrationContributions?: readonly QaMigrationContribution[];
  qaEntityContributions?: readonly QaEntityContribution[];
  assertQaPersistenceParity?: (
    migrations: readonly QaMigrationContribution[],
    entities: readonly QaEntityContribution[],
  ) => void;
}>;

const root = resolve(import.meta.dirname, "../../..");
const expectedInventory = Object.freeze([
  {
    order: 2000,
    key: "qa_context_policy_requests",
    sourcePath:
      "packages/competency-qa/src/persistence/migrations/2000-qa-context-policy-requests.ts",
    tables: [
      "qa_project_contexts",
      "qa_project_context_versions",
      "qa_risk_review_policies",
      "qa_risk_review_policy_versions",
      "qa_request_extensions",
      "qa_request_input_revisions",
    ],
  },
  {
    order: 2005,
    key: "qa_readiness_required_plans",
    sourcePath:
      "packages/competency-qa/src/persistence/migrations/2005-qa-readiness-required-plans.ts",
    tables: [
      "qa_readiness_assessments",
      "qa_waivers",
      "qa_required_session_plans",
      "qa_required_session_plan_versions",
      "qa_required_session_plan_requirements",
    ],
  },
  {
    order: 2010,
    key: "qa_session_planning",
    sourcePath: "packages/competency-qa/src/persistence/migrations/2010-qa-session-planning.ts",
    tables: ["qa_test_sessions", "qa_plan_items"],
  },
  {
    order: 2015,
    key: "qa_manual_execution",
    sourcePath: "packages/competency-qa/src/persistence/migrations/2015-qa-manual-execution.ts",
    tables: [
      "qa_manual_attempts",
      "qa_plan_item_result_revisions",
      "qa_plan_item_result_attempt_memberships",
      "qa_plan_item_result_observation_memberships",
      "qa_observations",
    ],
  },
  {
    order: 2020,
    key: "qa_evidence_review",
    sourcePath: "packages/competency-qa/src/persistence/migrations/2020-qa-evidence-review.ts",
    tables: [
      "qa_evidence_artifact_links",
      "qa_plan_item_result_evidence_memberships",
      "qa_evidence_manifest_artifact_memberships",
      "qa_evidence_manifests",
      "qa_evidence_manifest_revisions",
      "qa_session_reviews",
    ],
  },
  {
    order: 2025,
    key: "qa_findings_defect_publication",
    sourcePath:
      "packages/competency-qa/src/persistence/migrations/2025-qa-findings-defect-publication.ts",
    tables: [
      "qa_findings",
      "qa_finding_observations",
      "qa_finding_review_revisions",
      "qa_plan_item_result_flaky_observation_memberships",
      "qa_defect_drafts",
      "qa_defect_links",
    ],
  },
  {
    order: 2030,
    key: "qa_verdict_completion",
    sourcePath: "packages/competency-qa/src/persistence/migrations/2030-qa-verdict-completion.ts",
    tables: [
      "qa_verdicts",
      "qa_verdict_signatures",
      "qa_dod_assessments",
      "qa_completion_candidates",
      "qa_final_close_confirmations",
      "qa_post_close_correction_markers",
    ],
  },
] as const satisfies readonly QaPersistenceInventorySlice[]);

describe("Feature 002 migration ownership and entity parity", () => {
  it("preserves Core and Dummy order before the collision-free QA range", async () => {
    const qa = (await import("../../../packages/competency-qa/src/node.ts")) as QaNodeExports;
    const coreOrders = coreMigrationRegistry.map(({ order }) => order);
    expect(coreOrders).toEqual([...coreOrders].sort((left, right) => left - right));
    expect(new Set(coreOrders).size).toBe(coreOrders.length);
    expect(
      coreMigrationRegistry.every(
        ({ owner, order }) => owner === "core" && order > 0 && order < 1000,
      ),
    ).toBe(true);
    expect(dummyMigrationRegistry.map(({ order }) => order)).toEqual([1000]);
    expect(
      qa.qaMigrationContributions,
      "T030 must export the ordered QA migration registry",
    ).toBeDefined();
    const combined = [
      ...coreMigrationRegistry,
      ...dummyMigrationRegistry,
      ...qa.qaMigrationContributions!,
    ];
    expect(() => validateMigrationRegistry(combined)).not.toThrow();
    expect(
      qa.qaMigrationContributions!.every(
        ({ owner, order }) => owner === "pack:qa" && order >= 2000,
      ),
    ).toBe(true);
  });

  it("preserves the exact Feature 002 2000→2030 inventory as the prefix of the additive QA registry", async () => {
    const qa = (await import("../../../packages/competency-qa/src/node.ts")) as QaNodeExports;
    expect(qa.qaPersistenceInventory, "T029 must export parity inventory metadata").toBeDefined();
    expect(qa.qaPersistenceInventory!.slice(0, expectedInventory.length)).toEqual(
      expectedInventory,
    );
    expect(qa.qaPersistenceInventory!.map(({ order }) => order)).toEqual(
      [...qa.qaPersistenceInventory!.map(({ order }) => order)].sort((left, right) => left - right),
    );
    const allTables = qa.qaPersistenceInventory?.flatMap(({ tables }) => tables) ?? [];
    expect(new Set(allTables)).toHaveProperty("size", allTables.length);
    expect(allTables).toContain("qa_plan_item_result_attempt_memberships");
    expect(allTables).toContain("qa_plan_item_result_observation_memberships");
    expect(allTables).toContain("qa_plan_item_result_flaky_observation_memberships");
  });

  it("keeps installed entity ownership byte-equal to each migration contribution", async () => {
    const qa = (await import("../../../packages/competency-qa/src/node.ts")) as QaNodeExports;
    expect(
      qa.qaEntityContributions,
      "T034 must export module-owned entity contributions",
    ).toBeDefined();
    expect(qa.assertQaPersistenceParity, "T029 must export the parity assertion").toBeTypeOf(
      "function",
    );
    expect(() =>
      qa.assertQaPersistenceParity!(qa.qaMigrationContributions ?? [], qa.qaEntityContributions!),
    ).not.toThrow();

    for (const migration of qa.qaMigrationContributions ?? []) {
      const entityTables = qa
        .qaEntityContributions!.filter(({ migrationOrder }) => migrationOrder === migration.order)
        .map(({ tableName }) => tableName)
        .sort();
      expect(entityTables, `entity parity for migration ${migration.order}`).toEqual(
        [...migration.tables].sort(),
      );
    }
  });

  it("prevents an earlier migration file from naming a later story table", async () => {
    const qa = (await import("../../../packages/competency-qa/src/node.ts")) as QaNodeExports;
    const inventory = qa.qaPersistenceInventory ?? expectedInventory;
    for (const [index, slice] of inventory.entries()) {
      const path = resolve(root, slice.sourcePath);
      if (!existsSync(path)) continue;
      const source = await readFile(path, "utf8");
      const laterTables = inventory.slice(index + 1).flatMap(({ tables }) => tables);
      for (const table of laterTables)
        expect(source, `${slice.order} must not own future table ${table}`).not.toContain(table);
    }
  });
});
