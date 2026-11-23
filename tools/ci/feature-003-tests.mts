import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const flags = new Set(process.argv.slice(2).filter((flag) => flag !== "--"));
const unknown = [...flags].filter((flag) => flag !== "--plan");
if (unknown.length > 0)
  throw new Error(`Unknown test:003:contract-integration-e2e arguments: ${unknown.join(", ")}`);

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const scripts = Object.freeze(["test:contract:003", "test:integration:003", "test:e2e:003"]);

if (flags.has("--plan")) {
  console.table(scripts.map((script) => ({ stage: script, command: `${pnpm} run ${script}` })));
  process.exit(0);
}

for (const script of scripts) {
  console.log(`\n[test:003:contract-integration-e2e] ${script}`);
  const run = spawnSync(pnpm, ["run", script], {
    cwd: workspace,
    env: { ...process.env, CI: "true" },
    stdio: "inherit",
  });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    process.exitCode = run.status ?? 1;
    break;
  }
}
