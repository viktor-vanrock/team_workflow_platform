import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const startedAt = new Date();
const files = [
  "tests/integration/003/us3-webhook-projection.spec.ts",
  "tests/integration/003/us3-projection-ordering.spec.ts",
  "tests/integration/003/us3-reconciliation.spec.ts",
  "tests/integration/003/us3-freshness-drift.spec.ts",
  "tests/contract/003/us3-operational-actions.spec.ts",
  "tests/integration/security/003/us3-command-approvals.spec.ts",
  "tests/integration/003/us3-stale-command.spec.ts",
  "tests/integration/003/us3-post-write-conflict.spec.ts",
  "tests/integration/003/us3-command-concurrency.spec.ts",
  "tests/contract/003/us3-jira-command-conformance.spec.ts",
  "tests/integration/003/us3-command-errors.spec.ts",
  "tests/integration/security/003/us3-assignment-identity.spec.ts",
  "tests/e2e/003-us3-sync-conflict.spec.ts",
];
const run = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", ...files, "--maxWorkers=1"],
  { cwd: workspace, env: { ...process.env, CI: "true" }, stdio: "inherit" },
);
const status = run.status === 0 ? "PASS" : "FAIL";
const hashes = Object.fromEntries(
  files.map((path) => [
    path,
    `sha256:${createHash("sha256")
      .update(readFileSync(resolve(workspace, path)))
      .digest("hex")}`,
  ]),
);
const report = {
  schemaVersion: 1,
  feature: "003-jira-operational-authority",
  gate: "us3",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status,
  hashes,
};
const path = resolve(workspace, "reports/003-jira-operational-authority/us3.json");
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, stringifyPortableJson(report, workspace));
console.log(`[us3:003] ${status}; report: ${path}`);
if (status === "FAIL") process.exitCode = 1;
