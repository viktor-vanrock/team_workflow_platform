import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const flags = new Set(process.argv.slice(2).filter((value) => value !== "--"));
const unknown = [...flags].filter((flag) => flag !== "--plan" && flag !== "--available-only");
if (unknown.length > 0) throw new Error(`Unknown test:005 arguments: ${unknown.join(", ")}`);

const stages = Object.freeze([
  {
    id: "contract",
    requiredPath: "tests/contract/005",
    args: ["node_modules/vitest/vitest.mjs", "run", "tests/contract/005", "--maxWorkers=1"],
  },
  {
    id: "architecture",
    requiredPath: "tests/architecture/005-gitlab-boundaries.spec.ts",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/architecture/005-gitlab-boundaries.spec.ts",
      "tests/architecture/005-gitlab-runtime-wiring.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "unit",
    requiredPath: "tests/unit/005",
    args: ["node_modules/vitest/vitest.mjs", "run", "tests/unit/005", "--maxWorkers=1"],
  },
  {
    id: "integration",
    requiredPath: "tests/integration/005",
    args: ["node_modules/vitest/vitest.mjs", "run", "tests/integration/005", "--maxWorkers=1"],
  },
  {
    id: "security",
    requiredPath: "tests/integration/security/005",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/security/005",
      "--maxWorkers=1",
    ],
  },
  {
    id: "e2e",
    requiredPath: "tests/e2e/005-us1-automated-session.spec.ts",
    args: ["node_modules/vitest/vitest.mjs", "run", "tests/e2e/005-", "--maxWorkers=1"],
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
      console.log(`[test:005] SKIP ${stage.id}; ${stage.requiredPath} has not landed yet`);
      continue;
    }
    console.error(
      `[test:005] FAIL ${stage.id}; required task output ${stage.requiredPath} is missing`,
    );
    process.exitCode = 1;
    break;
  }
  console.log(`\n[test:005] ${stage.id}`);
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
