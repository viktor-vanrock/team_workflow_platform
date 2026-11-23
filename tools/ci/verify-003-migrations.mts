import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "../verification/portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const images = ["postgres:17.7-bookworm", "postgres:18.6-bookworm"] as const;
const results: Readonly<Record<string, unknown>>[] = [];
let failed = false;
for (const image of images) {
  const started = Date.now();
  const run = spawnSync(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/migrations/003-operational-authority.spec.ts",
      "--maxWorkers=1",
    ],
    {
      cwd: workspace,
      env: { ...process.env, CI: "true", AWP_TEST_POSTGRES_IMAGE: image },
      stdio: "inherit",
      timeout: 240_000,
    },
  );
  const durationMs = Date.now() - started;
  const status = run.status === 0 && durationMs < 120_000 ? "PASS" : "FAIL";
  if (status === "FAIL") failed = true;
  results.push({
    image,
    status,
    durationMs,
    lockTimingBudgetMs: 120_000,
    exitCode: run.status ?? 1,
  });
}
const report = {
  schemaVersion: 1,
  feature: "003-jira-operational-authority",
  gate: "migration-matrix",
  status: failed ? "FAIL" : "PASS",
  fresh: true,
  upgradeFromPrevious: true,
  repeatNoop: true,
  failedRecovery: true,
  results,
};
const path = resolve(workspace, "reports/003-jira-operational-authority/migrations.json");
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, stringifyPortableJson(report, workspace));
console.log(`[migrations:003] ${report.status}; report: ${path}`);
if (failed) process.exitCode = 1;
