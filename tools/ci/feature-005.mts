import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2).filter((value) => value !== "--");
const plan = args.includes("--plan");
const setupOnly = args.includes("--setup");
const availableOnly = args.includes("--available-only");
const checkpointIndex = args.indexOf("--checkpoint");
const checkpoint = checkpointIndex >= 0 ? args[checkpointIndex + 1] : undefined;
const knownFlags = new Set([
  "--plan",
  "--setup",
  "--available-only",
  "--checkpoint",
  "foundation",
  "us1",
  "us2",
  "us3",
  "us4",
]);
const unknown = args.filter((value) => !knownFlags.has(value));
if (unknown.length > 0) throw new Error(`Unknown ci:005 arguments: ${unknown.join(", ")}`);
if (checkpointIndex >= 0 && !checkpoint) throw new Error("Feature 005 checkpoint name is required");
if (checkpoint && !["foundation", "us1", "us2", "us3", "us4"].includes(checkpoint))
  throw new Error(`Unknown Feature 005 checkpoint: ${checkpoint}`);

const setup = "tools/verification/005-setup-gate.mts";
const fullStages = Object.freeze([
  setup,
  "tools/verification/005-foundation-checkpoint.mts",
  "tools/verification/005-us1-checkpoint.mts",
  "tools/verification/005-us2-checkpoint.mts",
  "tools/verification/005-us3-checkpoint.mts",
  "tools/verification/005-us4-checkpoint.mts",
  "tools/ci/feature-005-tests.mts",
  "tools/verification/005-quickstart.mts",
]);
const stages = checkpoint
  ? [`tools/verification/005-${checkpoint}-checkpoint.mts`]
  : setupOnly
    ? [setup]
    : fullStages;

if (plan) {
  console.table(
    stages.map((stage) => ({
      stage,
      available: existsSync(resolve(workspace, stage)),
      command: `${process.execPath} ${stage}`,
    })),
  );
  process.exit(0);
}

for (const stage of stages) {
  if (!existsSync(resolve(workspace, stage))) {
    if (availableOnly) {
      console.log(`[ci:005] SKIP ${stage}; task output has not landed yet`);
      continue;
    }
    console.error(`[ci:005] FAIL ${stage}; required task output is missing`);
    process.exitCode = 1;
    break;
  }
  console.log(`\n[ci:005] ${stage}`);
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
