import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2).filter((value) => value !== "--");
const plan = args.includes("--plan");
const setupOnly = args.includes("--setup");
const checkpointIndex = args.indexOf("--checkpoint");
const checkpoint = checkpointIndex >= 0 ? args[checkpointIndex + 1] : undefined;
const knownFlags = new Set(["--plan", "--setup", "--checkpoint", "us1", "us2", "us3", "us4"]);
const unknown = args.filter((value) => !knownFlags.has(value));
if (unknown.length > 0) throw new Error(`Unknown ci:004 arguments: ${unknown.join(", ")}`);
if (checkpointIndex >= 0 && !checkpoint) throw new Error("Feature 004 checkpoint name is required");
if (checkpoint && !["us1", "us2", "us3", "us4"].includes(checkpoint))
  throw new Error(`Unknown Feature 004 checkpoint: ${checkpoint}`);

const setup = "tools/verification/004-setup-gate.mts";
const fullStages = Object.freeze([
  setup,
  "tools/verification/004-foundation-checkpoint.mts",
  "tools/verification/004-us1-checkpoint.mts",
  "tools/verification/004-us2-checkpoint.mts",
  "tools/verification/004-us3-checkpoint.mts",
  "tools/verification/004-us4-checkpoint.mts",
  "tools/ci/feature-004-tests.mts",
  "tools/verification/004-quickstart.mts",
]);
const stages = checkpoint
  ? [`tools/verification/004-${checkpoint}-checkpoint.mts`]
  : setupOnly
    ? [setup]
    : fullStages;

if (plan) {
  console.table(stages.map((stage) => ({ stage, command: `${process.execPath} ${stage}` })));
  process.exit(0);
}

for (const stage of stages) {
  console.log(`\n[ci:004] ${stage}`);
  const result = spawnSync(process.execPath, [stage], {
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
