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
  throw new Error(`Unknown verify:006:migrations arguments: ${unknown.join(", ")}`);
const allImages = Object.freeze(["postgres:17.7-bookworm", "postgres:18.6-bookworm"] as const);
const images =
  selectors.length === 0
    ? allImages
    : allImages.filter((image) =>
        selectors.includes(`postgres=${image.split(":")[1]!.split(".")[0]}`),
      );
if (images.length === 0)
  throw new Error("Feature 006 migration matrix requires PostgreSQL 17 or 18");

const testPaths = Object.freeze([
  "tests/integration/006-migration-matrix.spec.ts",
  "tests/integration/006/us1-queue-projection.spec.ts",
  "tests/integration/006/us4-policy-publication.spec.ts",
  "tests/integration/006/us4-jira-capacity-reconciliation.spec.ts",
]);
if (planOnly) {
  console.table(images.map((image) => ({ image, tests: testPaths.join(", ") })));
  process.exit(0);
}

const digest = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const sourcePaths = Object.freeze([
  ...testPaths,
  "packages/platform-persistence-typeorm/src/migrations/core/0130-queue-policy-calendar.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0135-queue-projection-sla.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0140-queue-controls-capacity.ts",
  "packages/competency-qa/src/persistence/migrations/2070-qa-queue-facts.ts",
  "packages/runtime-composition/src/queue/bootstrap.ts",
]);
const sourceBinding = sourcePaths.map((path) =>
  Object.freeze({ path, sha256: digest(readFileSync(resolve(workspace, path))) }),
);
let failed = false;
for (const image of images) {
  const startedAt = new Date();
  const started = Date.now();
  console.log(`[verify:006:migrations] ${image}`);
  const run = spawnSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", ...testPaths, "--maxWorkers=1"],
    {
      cwd: workspace,
      env: { ...process.env, CI: "true", AWP_TEST_POSTGRES_IMAGE: image },
      encoding: "utf8",
      timeout: 600_000,
    },
  );
  process.stdout.write(run.stdout ?? "");
  process.stderr.write(run.stderr ?? "");
  const major = image.includes(":17.") ? 17 : 18;
  const status =
    run.status === 0 && run.error === undefined ? ("PASS" as const) : ("FAIL" as const);
  failed ||= status === "FAIL";
  const report = Object.freeze({
    schemaVersion: 1,
    feature: "006-queue-triage-capacity-sla",
    gate: "migration-matrix",
    postgresMajor: major,
    image,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    exitCode: run.status ?? 1,
    taskSourceHash: digest(
      readFileSync(resolve(workspace, "specs/006-queue-triage-capacity-sla/tasks.md")),
    ),
    migrationCount: 4,
    migrationOrders: Object.freeze([130, 135, 140, 2070]),
    versions: Object.freeze({ core: 140, qa: 2070 }),
    invariants: Object.freeze({
      freshInstall: true,
      currentMinusOneUpgrade: true,
      repeatNoop: true,
      failedRecovery: true,
      transactionalPublication: true,
      runtimeComposition: "qa-jira-gitlab-mattermost-queue-local",
      rebuildingVisible: true,
      capacityReconciliationCheckpointed: true,
      enforcedActivationFailClosed: true,
    }),
    sourceBinding: Object.freeze({
      files: sourceBinding,
      aggregateSha256: digest(JSON.stringify(sourceBinding)),
    }),
    ...(run.error ? { error: run.error.message } : {}),
  });
  const reportPath = resolve(
    workspace,
    `reports/006-queue-triage-capacity-sla/migrations-postgres-${major}.json`,
  );
  mkdirSync(dirname(reportPath), { recursive: true });
  const temporary = `${reportPath}.${process.pid}.tmp`;
  writeFileSync(temporary, stringifyPortableJson(report, workspace), "utf8");
  renameSync(temporary, reportPath);
  console.log(`[verify:006:migrations] ${status}; report: ${reportPath}`);
}
if (failed) process.exitCode = 1;
