import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "../verification/portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const requested = process.argv.slice(2).filter((value) => value !== "--");
const planOnly = requested.includes("--plan");
const selectors = requested.filter((value) => value !== "--plan");
const allowed = new Set(["postgres=17", "postgres=18"]);
const unknown = selectors.filter((value) => !allowed.has(value));
if (unknown.length > 0)
  throw new Error(`Unknown verify:007:migrations arguments: ${unknown.join(", ")}`);
const allImages = Object.freeze(["postgres:17.7-bookworm", "postgres:18.6-bookworm"] as const);
const images =
  selectors.length === 0
    ? allImages
    : allImages.filter((image) =>
        selectors.includes(`postgres=${image.split(":")[1]!.split(".")[0]}`),
      );
if (images.length === 0)
  throw new Error("Feature 007 migration matrix requires PostgreSQL 17 or 18");
const tests = Object.freeze([
  "tests/integration/007/migration-matrix.spec.ts",
  "tests/integration/migrations/007-migration-registry.spec.ts",
  "tests/integration/migrations/007-onboarding-foundation.spec.ts",
]);
if (planOnly) {
  console.table(images.map((image) => ({ image, tests: tests.join(", ") })));
  process.exit(0);
}

const digest = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const sourceFiles = Object.freeze([
  ...tests,
  "packages/platform-persistence-typeorm/src/migrations/core/0150-project-onboarding.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0155-project-binding-entitlements.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0160-artifact-retention-export.ts",
  "packages/competency-qa/src/persistence/migrations/2080-project-resources.ts",
  "packages/competency-qa/src/persistence/migrations/2085-evidence-integrity.ts",
]);
const sourceBinding = sourceFiles.map((file) =>
  Object.freeze({ path: file, sha256: digest(readFileSync(resolve(workspace, file))) }),
);
let failed = false;
for (const image of images) {
  const startedAt = new Date();
  const started = Date.now();
  console.log(`[verify:007:migrations] ${image}`);
  const run = spawnSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", ...tests, "--maxWorkers=1"],
    {
      cwd: workspace,
      env: { ...process.env, CI: "true", AWP_TEST_POSTGRES_IMAGE: image },
      encoding: "utf8",
      timeout: 600_000,
    },
  );
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  const status =
    run.status === 0 && run.error === undefined ? ("PASS" as const) : ("FAIL" as const);
  failed ||= status === "FAIL";
  const major = image.includes(":17.") ? 17 : 18;
  const report = Object.freeze({
    schemaVersion: 1,
    feature: "007-project-onboarding-evidence-security",
    gate: "migration-matrix",
    postgresMajor: major,
    image,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    exitCode: run.status ?? 1,
    taskSourceHash: digest(
      readFileSync(resolve(workspace, "specs/007-project-onboarding-evidence-security/tasks.md")),
    ),
    migrationOrders: Object.freeze({ core: [150, 155, 160], qa: [2080, 2085] }),
    versions: Object.freeze({ core: 160, qa: 2085 }),
    invariants: Object.freeze({
      freshInstall: true,
      upgradeFrom006: true,
      currentMinusOneUpgrade: true,
      repeatNoop: true,
      failureRecovery: true,
      historicalBootstrap: true,
      appendOnlyPublishedRows: true,
    }),
    sourceBinding: Object.freeze({
      files: sourceBinding,
      aggregateSha256: digest(JSON.stringify(sourceBinding)),
    }),
    outputHash: digest(`${run.stdout ?? ""}\n${run.stderr ?? ""}`),
    ...(run.error ? { error: run.error.message } : {}),
  });
  const reportPath = resolve(
    workspace,
    `reports/007-project-onboarding-evidence-security/migrations-postgres-${major}.json`,
  );
  mkdirSync(dirname(reportPath), { recursive: true });
  const temporary = `${reportPath}.${process.pid}.tmp`;
  writeFileSync(temporary, stringifyPortableJson(report, workspace), {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, reportPath);
  console.log(`[verify:007:migrations] ${status}; report: ${reportPath}`);
}
if (failed) process.exitCode = 1;
