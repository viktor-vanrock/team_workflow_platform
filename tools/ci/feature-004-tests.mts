import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const flags = new Set(process.argv.slice(2).filter((value) => value !== "--"));
const unknown = [...flags].filter((flag) => flag !== "--plan");
if (unknown.length > 0) throw new Error(`Unknown test:004 arguments: ${unknown.join(", ")}`);

const stages = Object.freeze([
  {
    id: "contract",
    args: ["node_modules/vitest/vitest.mjs", "run", "tests/contract/004", "--maxWorkers=1"],
  },
  {
    id: "architecture",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/architecture/004-mattermost-boundaries.spec.ts",
      "tests/architecture/004-mattermost-runtime-wiring.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "integration",
    args: ["node_modules/vitest/vitest.mjs", "run", "tests/integration/004", "--maxWorkers=1"],
  },
  {
    id: "security",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/security/004",
      "--maxWorkers=1",
    ],
  },
  {
    id: "e2e",
    args: ["node_modules/vitest/vitest.mjs", "run", "tests/e2e/004-", "--maxWorkers=1"],
  },
]);

if (flags.has("--plan")) {
  console.table(
    stages.map(({ id, args }) => ({ id, command: [process.execPath, ...args].join(" ") })),
  );
  process.exit(0);
}

for (const stage of stages) {
  console.log(`\n[test:004] ${stage.id}`);
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
