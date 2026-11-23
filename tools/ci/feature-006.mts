import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2).filter((value) => value !== "--");
const unknown = args.filter((value) => value !== "--plan" && value !== "--compatibility-only");
if (unknown.length > 0) throw new Error(`Unknown ci:006 arguments: ${unknown.join(", ")}`);
const result = spawnSync(process.execPath, ["tools/verification/feature-006-gate.mts", ...args], {
  cwd: workspace,
  env: { ...process.env, CI: "true" },
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
