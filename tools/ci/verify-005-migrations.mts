import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "../verification/portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/005-gitlab-automated-validation/migrations.json");
const arguments_ = process.argv.slice(2).filter((value) => value !== "--");
const planOnly = arguments_.includes("--plan");
const selectors = arguments_.filter((value) => value !== "--plan");
const allowedSelectors = new Set(["postgres=17", "postgres=18"]);
const unknown = selectors.filter((value) => !allowedSelectors.has(value));
if (unknown.length > 0)
  throw new Error(`Unknown verify:005:migrations arguments: ${unknown.join(", ")}`);
const allImages = Object.freeze(["postgres:17.7-bookworm", "postgres:18.6-bookworm"] as const);
const images =
  selectors.length === 0
    ? allImages
    : allImages.filter((image) =>
        selectors.includes(`postgres=${image.split(":")[1]!.split(".")[0]}`),
      );
if (images.length === 0)
  throw new Error("Feature 005 migration matrix requires PostgreSQL 17 or 18");

const testPath = "tests/integration/005-migration-matrix.spec.ts";
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
const startedAt = new Date();
const results: Array<Readonly<Record<string, unknown>>> = [];
let failed = false;
for (const image of images) {
  const imageStarted = Date.now();
  console.log(`[verify:005:migrations] ${image}`);
  const run = spawnSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", testPath, "--maxWorkers=1"],
    {
      cwd: workspace,
      env: { ...process.env, CI: "true", AWP_TEST_POSTGRES_IMAGE: image },
      stdio: "inherit",
      timeout: 600_000,
    },
  );
  const durationMs = Date.now() - imageStarted;
  const status = run.status === 0 && run.error === undefined ? "PASS" : "FAIL";
  failed ||= status === "FAIL";
  if (run.error) console.error(run.error.message);
  results.push(Object.freeze({ image, status, durationMs, exitCode: run.status ?? 1 }));
}

const sourcePaths = Object.freeze([
  testPath,
  "packages/competency-qa/src/persistence/migrations/2050-qa-automation-foundation.ts",
  "packages/competency-qa/src/persistence/migrations/2055-qa-automation-execution.ts",
  "packages/competency-qa/src/persistence/migrations/2060-qa-automation-review-quarantine.ts",
  "packages/connector-gitlab-persistence-typeorm/src/migrations/4000-gitlab-discovery-profiles.ts",
  "packages/connector-gitlab-persistence-typeorm/src/migrations/4010-gitlab-webhook-rate-reconciliation.ts",
  "packages/connector-gitlab-persistence-typeorm/src/migrations/4020-gitlab-effect-artifact-reconciliation.ts",
  "apps/mock-hub/src/persistence/migrations/0060-gitlab-state.ts",
  "apps/mock-hub/src/persistence/migrations/0061-gitlab-results-artifacts.ts",
  "apps/mock-hub/src/persistence/migrations/0062-gitlab-effects-faults-webhooks.ts",
]);
const sourceBinding = sourcePaths.map((path) =>
  Object.freeze({ path, sha256: digest(readFileSync(resolve(workspace, path))) }),
);
const report = Object.freeze({
  schemaVersion: 1,
  feature: "005-gitlab-automated-validation",
  gate: "migration-matrix",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  taskSourceHash: digest(
    readFileSync(resolve(workspace, "specs/005-gitlab-automated-validation/tasks.md")),
  ),
  migrationCount: 9,
  invariants: Object.freeze({
    freshInstall: true,
    currentMinusOneUpgrade: true,
    repeatNoop: true,
    failedRecovery: true,
    transactionalPublication: true,
  }),
  versions: Object.freeze({ qa: 2060, gitlabConnector: 4020, mockHubGitlab: 62 }),
  results,
  sourceBinding: Object.freeze({
    files: sourceBinding,
    aggregateSha256: digest(JSON.stringify(sourceBinding)),
  }),
});
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(`[verify:005:migrations] ${report.status}; report: ${reportPath}`);
if (failed) process.exitCode = 1;
