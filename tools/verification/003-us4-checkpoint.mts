import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const startedAt = new Date();
const files = [
  "tests/contract/003/us4-defect-create.spec.ts",
  "tests/integration/security/003/us4-defect-approval.spec.ts",
  "tests/integration/003/us4-defect-recovery.spec.ts",
  "tests/integration/003/us4-defect-duplicate-policy.spec.ts",
  "tests/integration/security/003/us4-defect-routing.spec.ts",
  "tests/e2e/003-us4-approved-defect.spec.ts",
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
  gate: "us4",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status,
  trace: {
    approval: "exact-subject-consumed-once",
    effect: "marker-proven-absent-or-adopted",
    subEffects: ["request-link", "session-ref", "build-ref", "evidence-ref"],
    defectLink: "generic-confirmation-hook",
  },
  hashes,
};
const path = resolve(workspace, "reports/003-jira-operational-authority/us4.json");
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, stringifyPortableJson(report, workspace));
console.log(`[us4:003] ${status}; report: ${path}`);
if (status === "FAIL") process.exitCode = 1;
