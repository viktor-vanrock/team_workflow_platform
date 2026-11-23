import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const startedAt = new Date();
const files = [
  "tests/contract/003/us1-request-create.spec.ts",
  "tests/integration/003/us1-central-request.spec.ts",
  "tests/integration/003/us1-create-idempotency.spec.ts",
  "tests/integration/003/us1-create-ambiguity.spec.ts",
  "tests/integration/003/us1-sub-effect-recovery.spec.ts",
  "tests/integration/security/003/us1-create-authorization.spec.ts",
  "tests/e2e/003-us1-central-request.spec.ts",
];
const result = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", ...files, "--maxWorkers=1"],
  { cwd: workspace, env: { ...process.env, CI: "true" }, stdio: "inherit" },
);
const status = result.status === 0 ? "PASS" : "FAIL";
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
  gate: "us1",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status,
  hashes,
};
const path = resolve(workspace, "reports/003-jira-operational-authority/us1.json");
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, stringifyPortableJson(report, workspace));
console.log(`[us1:003] ${status}; report: ${path}`);
if (status === "FAIL") process.exitCode = 1;
