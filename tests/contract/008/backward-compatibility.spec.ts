import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { qaMigrationContributions } from "../../../packages/competency-qa/src/persistence/migrations/index.ts";
import { coreMigrationRegistry } from "../../../packages/platform-persistence-typeorm/src/index.ts";
import { runtimePersistence } from "../../../packages/runtime-composition/src/pilot/composition.ts";

const root = resolve(import.meta.dirname, "../../..");
const previousReports = [
  "reports/003-jira-operational-authority/final-gate.json",
  "reports/004-mattermost-hermes-intake/final-gate.json",
  "reports/005-gitlab-automated-validation/final-gate.json",
  "reports/006-queue-triage-capacity-sla/final-gate.json",
  "reports/007-project-onboarding-evidence-security/final-gate.json",
] as const;

describe("008 transitive 001-007 compatibility", () => {
  it("keeps every historical Core and QA migration as an immutable prefix", () => {
    const core = coreMigrationRegistry.map(({ order }) => order);
    const qa = qaMigrationContributions.map(({ order }) => order);
    expect(core).toEqual([...core].sort((a, b) => a - b));
    expect(new Set(core).size).toBe(core.length);
    expect(qa).toEqual([...qa].sort((a, b) => a - b));
    expect(new Set(qa).size).toBe(qa.length);
    expect(core.filter((order) => order <= 160)).toEqual([
      1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100, 105, 110, 120, 130, 135, 140, 150, 155, 160,
    ]);
    expect(qa.filter((order) => order <= 2085)).toEqual([
      2000, 2005, 2010, 2015, 2020, 2025, 2030, 2040, 2050, 2055, 2060, 2070, 2080, 2085,
    ]);
  });

  it("uses those same prefixes in the complete local and non-local persistence selections", () => {
    const local = runtimePersistence("qa-jira-gitlab-mattermost-local");
    const corporate = runtimePersistence("qa-jira-gitlab-mattermost-test");
    expect(corporate.expectedVersions).toEqual(local.expectedVersions);
    expect(corporate.migrations.map((Migration) => new Migration().name)).toEqual(
      local.migrations.map((Migration) => new Migration().name),
    );
    expect(corporate.expectedVersions).toMatchObject({
      core: 255,
      "pack:qa": 2115,
      "connector:jira": 3050,
      "connector:gitlab": 4020,
    });
  });

  it("retains approval v1/v2 and signed evidence/verdict contracts side by side", () => {
    const generated = readFileSync(
      resolve(root, "packages/platform-contracts/src/generated/schema-documents.ts"),
      "utf8",
    );
    for (const id of [
      "urn:awp:contracts:commands:approval-subject:v1",
      "urn:awp:contracts:commands:approval-subject:v2",
      "urn:awp:schemas:qa:evidence-manifest:v1",
      "urn:awp:schemas:007:evidence-manifest:v2",
      "urn:awp:schemas:qa:verdict:v1",
      "urn:awp:schemas:qa:verdict-signature:v1",
    ])
      expect(generated).toContain(id);
    expect(generated).not.toMatch(/approval-subject:v1[\s\S]{0,300}(?:deprecated|removed)/iu);
  });

  it("keeps accepted predecessor reports readable without rewriting their status", () => {
    for (const path of previousReports) {
      const report = JSON.parse(readFileSync(resolve(root, path), "utf8")) as Record<
        string,
        unknown
      >;
      expect(report.schemaVersion, path).toEqual(expect.any(Number));
      expect(report.status, path).toBe("PASS");
      expect(typeof report.feature, path).toBe("string");
    }
  });
});
