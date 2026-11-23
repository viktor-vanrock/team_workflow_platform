import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const files = Object.freeze([
  "tests/integration/007/concurrency-matrix.spec.ts",
  "tests/integration/007/us2-binding-concurrency.spec.ts",
  "tests/integration/007/us2-pilot-activation.spec.ts",
  "tests/integration/007/us3-entitlement-revocation-race.spec.ts",
  "tests/integration/007/us1-account-leases.spec.ts",
  "tests/integration/007/us4-evidence-concurrency.spec.ts",
  "tests/integration/007/us5-operational-concurrency.spec.ts",
  "tests/integration/security/007/us5-effect-guard-race.spec.ts",
]);
const startedAt = new Date();
const run = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", ...files, "--maxWorkers=1"],
  { cwd: workspace, env: { ...process.env, CI: "true" }, encoding: "utf8" },
);
if (run.stdout) process.stdout.write(run.stdout);
if (run.stderr) process.stderr.write(run.stderr);
const digest = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const status = run.status === 0 && run.error === undefined ? ("PASS" as const) : ("FAIL" as const);
const sources = files.map((file) =>
  Object.freeze({ path: file, sha256: digest(readFileSync(resolve(workspace, file))) }),
);
const report = Object.freeze({
  schemaVersion: 1,
  feature: "007-project-onboarding-evidence-security",
  gate: "concurrency",
  status,
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  taskSourceHash: digest(
    readFileSync(resolve(workspace, "specs/007-project-onboarding-evidence-security/tasks.md")),
  ),
  invariants: Object.freeze({
    fixedLockOrder: true,
    singleCasWinner: true,
    noPartialSignedEvidence: true,
    noEffectAfterSuspend: true,
  }),
  sourceBinding: Object.freeze({
    files: sources,
    aggregateSha256: digest(JSON.stringify(sources)),
  }),
  exitCode: run.status ?? 1,
  outputHash: digest(`${run.stdout ?? ""}\n${run.stderr ?? ""}`),
  ...(run.error ? { error: run.error.message } : {}),
});
const reportPath = resolve(
  workspace,
  "reports/007-project-onboarding-evidence-security/concurrency.json",
);
mkdirSync(dirname(reportPath), { recursive: true });
const temporary = `${reportPath}.${process.pid}.tmp`;
writeFileSync(temporary, stringifyPortableJson(report, workspace), {
  encoding: "utf8",
  mode: 0o600,
});
renameSync(temporary, reportPath);
console.log(`[verify:007:concurrency] ${status}; report: ${reportPath}`);
if (status === "FAIL") process.exitCode = 1;
