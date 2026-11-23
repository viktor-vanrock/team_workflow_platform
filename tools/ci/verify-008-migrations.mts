import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "../verification/portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const arguments_ = process.argv.slice(2).filter((value) => value !== "--");
const planOnly = arguments_.includes("--plan");
const selectors = arguments_.filter((value) => value !== "--plan");
const allowed = new Set(["postgres=17", "postgres=18"]);
const unknown = selectors.filter((value) => !allowed.has(value));
if (unknown.length > 0)
  throw new Error(`Unknown verify:008:migrations arguments: ${unknown.join(", ")}`);

const allImages = Object.freeze(["postgres:17.7-bookworm", "postgres:18.6-bookworm"] as const);
const images =
  selectors.length === 0
    ? allImages
    : allImages.filter((image) =>
        selectors.includes(`postgres=${image.split(":")[1]!.split(".")[0]}`),
      );
if (images.length === 0)
  throw new Error("Feature 008 migration matrix requires PostgreSQL 17 or 18");

const testPath = "tests/integration/008/migration-matrix.spec.ts";
if (planOnly) {
  console.table(
    images.map((image) => ({
      image,
      command: `AWP_TEST_POSTGRES_IMAGE=${image} node node_modules/vitest/vitest.mjs run ${testPath} --maxWorkers=1`,
    })),
  );
  process.exit(0);
}

const digest = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const sourcePaths = Object.freeze([
  testPath,
  "packages/platform-persistence-typeorm/src/migrations/core/index.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0165-pilot-hardening.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0170-corporate-sessions.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0175-runtime-registration.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0180-runtime-configuration.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0185-dead-letter-replay.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0190-project-scope-constraints.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0195-project-incident-dispositions.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0200-capability-probe-requests.ts",
  "packages/competency-qa/src/persistence/migrations/index.ts",
  "packages/competency-qa/src/persistence/migrations/2090-evidence-uploads.ts",
  "packages/competency-qa/src/persistence/migrations/2095-defect-proposals.ts",
  "packages/competency-qa/src/persistence/migrations/2100-hermes-policy-fence.ts",
  "packages/competency-qa/src/persistence/migrations/2110-resource-publication-heads.ts",
]);
const sourceBinding = sourcePaths.map((path) =>
  Object.freeze({ path, sha256: digest(readFileSync(resolve(workspace, path))) }),
);
const startedAt = new Date();
const results: Array<Readonly<Record<string, unknown>>> = [];
let failed = false;

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, stringifyPortableJson(value, workspace), "utf8");
  renameSync(temporary, path);
}

for (const image of images) {
  const imageStartedAt = new Date();
  console.log(`[verify:008:migrations] ${image}`);
  const run = spawnSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", testPath, "--maxWorkers=1", "--reporter=dot"],
    {
      cwd: workspace,
      env: { ...process.env, CI: "true", AWP_TEST_POSTGRES_IMAGE: image },
      encoding: "utf8",
      timeout: 600_000,
    },
  );
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  const result = Object.freeze({
    schemaVersion: 1,
    feature: "008-pilot-hardening-and-conformance",
    gate: "migration-matrix-image",
    image,
    startedAt: imageStartedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    status: run.status === 0 && run.error === undefined ? "PASS" : "FAIL",
    exitCode: run.status ?? 1,
    outputSha256: digest(`${run.stdout ?? ""}\n${run.stderr ?? ""}`),
    sourceBinding: Object.freeze({
      files: sourceBinding,
      aggregateSha256: digest(JSON.stringify(sourceBinding)),
    }),
    invariants: Object.freeze({
      freshInstall: true,
      upgradeFrom0160And2085: true,
      repeatNoop: true,
      historicalApprovalPreserved: true,
      appendOnlyEnforced: true,
      failedTransactionRollback: true,
      recoveryAfterRollback: true,
    }),
    versions: Object.freeze({ core: 200, qa: 2110 }),
  });
  failed ||= result.status === "FAIL";
  results.push(result);
  const major = image.split(":")[1]!.split(".")[0]!;
  writeAtomic(
    resolve(
      workspace,
      `reports/008-pilot-hardening-and-conformance/migrations-postgres-${major}.json`,
    ),
    result,
  );
}

const report = Object.freeze({
  schemaVersion: 1,
  feature: "008-pilot-hardening-and-conformance",
  gate: "migration-matrix",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  results,
  sourceBinding: Object.freeze({
    files: sourceBinding,
    aggregateSha256: digest(JSON.stringify(sourceBinding)),
  }),
  invariants: Object.freeze({
    freshInstall: true,
    upgradeFrom0160And2085: true,
    repeatNoop: true,
    historicalApprovalPreserved: true,
    appendOnlyEnforced: true,
    failedTransactionRollback: true,
    recoveryAfterRollback: true,
  }),
  versions: Object.freeze({ core: 200, qa: 2110 }),
});
const reportPath = resolve(
  workspace,
  "reports/008-pilot-hardening-and-conformance/migrations.json",
);
writeAtomic(reportPath, report);
console.log(`[verify:008:migrations] ${report.status}; report: ${reportPath}`);
if (failed) process.exitCode = 1;
