import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const flags = new Set(process.argv.slice(2).filter((value) => value !== "--"));
const unknown = [...flags].filter((flag) => flag !== "--plan" && flag !== "--available-only");
if (unknown.length > 0) throw new Error(`Unknown test:007 arguments: ${unknown.join(", ")}`);

const stages = Object.freeze([
  {
    id: "contract",
    requiredPath: "tests/contract/007",
    args: ["node_modules/vitest/vitest.mjs", "run", "tests/contract/007", "--maxWorkers=1"],
  },
  {
    id: "architecture",
    requiredPath: "tests/architecture/007",
    args: ["node_modules/vitest/vitest.mjs", "run", "tests/architecture/007", "--maxWorkers=1"],
  },
  {
    id: "unit",
    requiredPath: "tests/unit/007",
    args: ["node_modules/vitest/vitest.mjs", "run", "tests/unit/007", "--maxWorkers=1"],
  },
  {
    id: "concurrency",
    requiredPath: "tests/integration/007/concurrency-matrix.spec.ts",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/007/concurrency-matrix.spec.ts",
      "tests/integration/007/us4-evidence-concurrency.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "integration",
    requiredPath: "tests/integration/007",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/007",
      "tests/integration/migrations/007-migration-registry.spec.ts",
      "tests/integration/migrations/007-onboarding-foundation.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "security",
    requiredPath: "tests/integration/security/007",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/security/007",
      "--maxWorkers=1",
    ],
  },
  {
    id: "e2e",
    requiredPath: "tests/e2e/007",
    args: ["node_modules/vitest/vitest.mjs", "run", "tests/e2e/007", "--maxWorkers=1"],
  },
  {
    id: "browser",
    requiredPath: "tests/e2e/007/us1-manual-onboarding-browser.spec.ts",
    args: [
      "node_modules/@playwright/test/cli.js",
      "test",
      "tests/e2e/007/*-browser.spec.ts",
      "--project=chromium",
      "--workers=1",
    ],
  },
]);

if (flags.has("--plan")) {
  console.table(
    stages.map(({ id, requiredPath, args }) => ({
      id,
      available: existsSync(resolve(workspace, requiredPath)),
      command: [process.execPath, ...args].join(" "),
    })),
  );
  process.exit(0);
}

for (const stage of stages) {
  if (!existsSync(resolve(workspace, stage.requiredPath))) {
    if (flags.has("--available-only")) {
      console.log(`[test:007] SKIP ${stage.id}; ${stage.requiredPath} has not landed yet`);
      continue;
    }
    console.error(
      `[test:007] FAIL ${stage.id}; required task output ${stage.requiredPath} is missing`,
    );
    process.exitCode = 1;
    break;
  }
  console.log(`\n[test:007] ${stage.id}`);
  const result = spawnSync(process.execPath, [...stage.args], {
    cwd: workspace,
    env: { ...process.env, CI: "true" },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
