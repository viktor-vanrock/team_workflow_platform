import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "../verification/portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const requested = process.argv.slice(2).filter((value) => value !== "--");
const unknown = requested.filter((value) => value !== "postgres=17" && value !== "postgres=18");
if (unknown.length) throw new Error(`Unknown migration matrix arguments: ${unknown.join(" ")}`);
const allImages = ["postgres:17.7-bookworm", "postgres:18.6-bookworm"] as const;
const images = requested.length
  ? allImages.filter((image) =>
      requested.includes(`postgres=${image.split(":")[1]!.split(".")[0]}`),
    )
  : allImages;
const startedAt = new Date();
const results: Array<Record<string, unknown>> = [];
let failed = false;
for (const image of images) {
  const started = Date.now();
  const run = spawnSync(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/migrations/004-mattermost-hermes-intake.spec.ts",
      "tests/integration/migrations/004-migration-registry.spec.ts",
      "--maxWorkers=1",
    ],
    {
      cwd: workspace,
      env: { ...process.env, CI: "true", AWP_TEST_POSTGRES_IMAGE: image },
      stdio: "inherit",
      timeout: 300_000,
    },
  );
  const durationMs = Date.now() - started,
    status = run.status === 0 && durationMs < 180_000 ? "PASS" : "FAIL";
  if (status === "FAIL") failed = true;
  results.push({
    image,
    status,
    durationMs,
    lockTimingBudgetMs: 180_000,
    exitCode: run.status ?? 1,
  });
}
const report = {
  schemaVersion: 1,
  feature: "004-mattermost-hermes-intake",
  gate: "migration-matrix",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  taskSourceHash: `sha256:${createHash("sha256")
    .update(readFileSync(resolve(workspace, "specs/004-mattermost-hermes-intake/tasks.md")))
    .digest("hex")}`,
  fresh: true,
  upgradeFromPrevious: true,
  repeatNoop: true,
  failedRecovery: true,
  legacyDraftBackfill: true,
  versions: { core: 120, qa: 2040, jira: 3040 },
  results,
};
const path = resolve(workspace, "reports/004-mattermost-hermes-intake/migrations.json");
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, stringifyPortableJson(report, workspace));
console.log(`[migrations:004] ${report.status}; report: ${path}`);
if (failed) process.exitCode = 1;
