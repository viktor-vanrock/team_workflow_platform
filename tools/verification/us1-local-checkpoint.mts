import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

function run(
  label: string,
  script: string,
  args: readonly string[],
  extraEnv: NodeJS.ProcessEnv = {},
): void {
  console.log(`\n[US1] ${label}`);
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, CI: "true", ...extraEnv },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("local composition", "tools/local/cli.mts", ["up"]);
run(
  "AT-001/AT-002/AT-003 and live storage harness",
  "node_modules/vitest/vitest.mjs",
  [
    "run",
    "tests/e2e/acceptance/at-001-local-bootstrap.spec.ts",
    "tests/e2e/acceptance/at-002-model-fallback.spec.ts",
    "tests/integration/security/acceptance/at-003-local-security.spec.ts",
    "tests/integration/artifact-storage-persistence.spec.ts",
  ],
  { AWP_RUN_LIVE_STORAGE_HARNESS: "1" },
);
run("Playwright Chromium walkthrough", "node_modules/@playwright/test/cli.js", [
  "test",
  "tests/e2e/001-local-walking-skeleton.spec.ts",
  "--project",
  "chromium",
]);
run("repeatable smoke", "tools/smoke/feature-001.mts", []);

console.log(
  "\nUS1 LOCAL CHECKPOINT: PASS (AT-001, AT-002, AT-003, persistent S3 version/checksum, Playwright, smoke effectCount=1)",
);
