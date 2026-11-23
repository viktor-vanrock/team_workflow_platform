import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertFeature003ExecutionCoverage,
  feature003ProcessStages,
  requiredFeature003SuccessCriteria,
} from "../../../tools/smoke/feature-003-process-contract.mts";

describe("003 executable smoke and quickstart contract", () => {
  it("routes every success criterion through an executed process/evidence stage", () => {
    expect(requiredFeature003SuccessCriteria).toEqual([
      "SC-001",
      "SC-002",
      "SC-003",
      "SC-004",
      "SC-005",
      "SC-006",
      "SC-007",
    ]);
    expect(feature003ProcessStages.map(({ id }) => id)).toEqual([
      "documented-scenarios",
      "us1-durable-effects",
      "us2-direct-import",
      "us3-action-conflict",
      "us4-defect-publication",
      "security-audit-evidence",
    ]);

    const covered = new Set(
      feature003ProcessStages.flatMap(({ successCriteria }) => successCriteria),
    );
    expect([...covered].sort()).toEqual([...requiredFeature003SuccessCriteria]);
    expect(
      feature003ProcessStages.filter(
        ({ evidenceSources }) =>
          evidenceSources.includes("POSTGRESQL") && evidenceSources.includes("MOCK_HUB"),
      ),
    ).toHaveLength(4);
  });

  it("backs every US process stage with durable platform and Mock Hub SQL inspection", () => {
    const workspace = resolve(import.meta.dirname, "../../..");
    for (const path of [
      "tests/e2e/acceptance/003-us1-durable-worker.spec.ts",
      "tests/e2e/acceptance/003-us2-direct-import-worker.spec.ts",
      "tests/e2e/acceptance/003-us3-operational-action-worker.spec.ts",
      "tests/e2e/acceptance/003-us4-defect-publication-worker.spec.ts",
    ]) {
      const source = readFileSync(resolve(workspace, path), "utf8");
      expect(source, `${path} must query PostgreSQL`).toContain("psql");
      expect(source, `${path} must inspect platform authority`).toContain('"awp"');
      expect(source, `${path} must inspect durable Mock Hub effects`).toContain('"awp_mock"');
      expect(source, `${path} must inspect a durable Mock Hub table`).toContain("jira_mock_");
    }
  });

  it("fails closed when a stage or invariant was not executed", () => {
    const passResults = feature003ProcessStages.map(({ id }) => ({ id, status: "PASS" as const }));
    expect(assertFeature003ExecutionCoverage(passResults)).toEqual({
      executedSuccessCriteria: requiredFeature003SuccessCriteria,
      unexecutedSuccessCriteria: [],
      unexecutedStages: [],
    });

    expect(() => assertFeature003ExecutionCoverage(passResults.slice(1))).toThrow(
      "FEATURE_003_UNEXECUTED_STAGES:documented-scenarios",
    );
    expect(() =>
      assertFeature003ExecutionCoverage(
        passResults.map((result) =>
          result.id === "us3-action-conflict" ? { ...result, status: "SKIP" as const } : result,
        ),
      ),
    ).toThrow(/FEATURE_003_UNEXECUTED_STAGES:us3-action-conflict/u);
  });
});
