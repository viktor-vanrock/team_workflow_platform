import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(
  workspace,
  "reports/008-pilot-hardening-and-conformance/compatibility.json",
);
const digest = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const contractTests = "tests/contract";
const migrationRegistryTests = Object.freeze([
  "tests/integration/migrations/003-migration-registry.spec.ts",
  "tests/integration/migrations/004-migration-registry.spec.ts",
  "tests/integration/migrations/005-migration-registry.spec.ts",
  "tests/integration/migrations/006-migration-registry.spec.ts",
  "tests/integration/migrations/007-migration-registry.spec.ts",
]);
const predecessorReports = Object.freeze([
  "reports/003-jira-operational-authority/final-gate.json",
  "reports/004-mattermost-hermes-intake/final-gate.json",
  "reports/005-gitlab-automated-validation/final-gate.json",
  "reports/006-queue-triage-capacity-sla/final-gate.json",
  "reports/007-project-onboarding-evidence-security/final-gate.json",
]);

const startedAt = new Date();
const stages = [
  { id: "contracts-001-through-008", paths: [contractTests] },
  { id: "historical-migration-registries", paths: [...migrationRegistryTests] },
] as const;
const results: Array<Readonly<Record<string, unknown>>> = [];
let failed = false;
for (const stage of stages) {
  console.log(`[verify:008:compatibility] ${stage.id}`);
  const run = spawnSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", ...stage.paths, "--maxWorkers=1", "--reporter=dot"],
    {
      cwd: workspace,
      env: { ...process.env, CI: "true" },
      encoding: "utf8",
      timeout: 600_000,
    },
  );
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  const status = run.status === 0 && run.error === undefined ? "PASS" : "FAIL";
  failed ||= status === "FAIL";
  results.push(
    Object.freeze({
      id: stage.id,
      status,
      exitCode: run.status ?? 1,
      outputSha256: digest(`${run.stdout ?? ""}\n${run.stderr ?? ""}`),
      paths: stage.paths,
    }),
  );
}

const sourcePaths = Object.freeze([
  "tests/contract/008/backward-compatibility.spec.ts",
  "packages/platform-contracts/src/generated/schema-documents.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/index.ts",
  "packages/competency-qa/src/persistence/migrations/index.ts",
  ...migrationRegistryTests,
]);
const sourceBinding = sourcePaths.map((path) =>
  Object.freeze({ path, sha256: digest(readFileSync(resolve(workspace, path))) }),
);
const report = Object.freeze({
  schemaVersion: 1,
  feature: "008-pilot-hardening-and-conformance",
  gate: "transitive-compatibility",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  coverage: Object.freeze({
    features: Object.freeze(["001", "002", "003", "004", "005", "006", "007", "008"]),
    contracts: true,
    approvalV1AndV2: true,
    evidenceV1AndV2: true,
    historicalMigrations: true,
    predecessorReportsReadOnly: true,
  }),
  results,
  predecessorReports: predecessorReports.map((path) =>
    Object.freeze({ path, sha256: digest(readFileSync(resolve(workspace, path))) }),
  ),
  sourceBinding: Object.freeze({
    files: sourceBinding,
    aggregateSha256: digest(JSON.stringify(sourceBinding)),
  }),
});
mkdirSync(dirname(reportPath), { recursive: true });
const temporary = `${reportPath}.tmp-${process.pid}`;
writeFileSync(temporary, stringifyPortableJson(report, workspace), "utf8");
renameSync(temporary, reportPath);
console.log(`[verify:008:compatibility] ${report.status}; report: ${reportPath}`);
if (failed) process.exitCode = 1;
