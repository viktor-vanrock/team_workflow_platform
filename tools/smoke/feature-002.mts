import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { stringifyPortableJson } from "../verification/portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "artifacts/verification/feature-002-smoke.json");
const args = new Set(process.argv.slice(2));
const unknown = [...args].filter((value) => value !== "--plan");
if (unknown.length > 0) throw new Error(`Unknown smoke:002 arguments: ${unknown.join(" ")}`);

interface Stage {
  readonly id: string;
  readonly description: string;
  readonly command: readonly string[];
}
interface Result extends Stage {
  readonly status: "PASS" | "FAIL" | "SKIP";
  readonly durationMs: number;
  readonly exitCode?: number;
}
const node = process.execPath;
const stages: readonly Stage[] = Object.freeze([
  {
    id: "clean-pass",
    description: "Scoped scenario cleanup and clean manual PASS",
    command: [node, "tools/local/qa-scenario.mts", "qa-manual-pass"],
  },
  {
    id: "repeat-pass",
    description: "Repeat the exact PASS flow without duplicate effects",
    command: [node, "tools/local/qa-scenario.mts", "qa-manual-pass"],
  },
  {
    id: "done-fail",
    description: "Manual FAIL, linked defect, signed Verdict and external DONE",
    command: [node, "tools/local/qa-scenario.mts", "qa-manual-fail"],
  },
  {
    id: "high-risk",
    description: "Distinct Lead co-sign and stale/expired denial",
    command: [node, "tools/local/qa-scenario.mts", "qa-high-risk"],
  },
  {
    id: "model-outage",
    description: "Deterministic model fallback and denied restricted prompt",
    command: [node, "tools/local/qa-scenario.mts", "qa-model-outage"],
  },
  {
    id: "cross-project-deny",
    description: "Cross-Project/Workspace deny before downstream calls",
    command: [node, "tools/local/qa-scenario.mts", "qa-cross-project-deny"],
  },
  {
    id: "restart-reconciliation",
    description: "Crash windows, restart/same-effect replay and out-of-order denial",
    command: [
      node,
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/acceptance/002-at-015-resilience.spec.ts",
      "--maxWorkers=1",
    ],
  },
]);

if (args.has("--plan")) {
  console.table(
    stages.map(({ id, description, command }) => ({ id, description, command: command.join(" ") })),
  );
  process.exit(0);
}

spawnSync(node, ["tools/local/qa-scenario.mts", "reset"], { cwd: workspace, stdio: "inherit" });
const startedAt = new Date();
const results: Result[] = [];
let failed = false;
for (const stage of stages) {
  if (failed) {
    results.push({ ...stage, status: "SKIP", durationMs: 0 });
    continue;
  }
  const started = Date.now();
  console.log(`\n[smoke:002] ${stage.id}: ${stage.description}`);
  const result = spawnSync(stage.command[0]!, [...stage.command.slice(1)], {
    cwd: workspace,
    stdio: "inherit",
    env: { ...process.env, CI: "true", AWP_COMPOSITION: "qa-local", AWP_RUNTIME_PROFILE: "test" },
  });
  if (result.error) throw result.error;
  const exitCode = result.status ?? 1;
  results.push({
    ...stage,
    status: exitCode === 0 ? "PASS" : "FAIL",
    durationMs: Date.now() - started,
    exitCode,
  });
  failed = exitCode !== 0;
}

const report = {
  schemaVersion: 1,
  feature: "002-qa-manual-walking-skeleton",
  gate: "repeatable-smoke",
  composition: "qa-local",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  effectAssertions: Object.freeze({
    requestCreate: 1,
    readyTransition: 1,
    defectPublish: 1,
    completionTransition: 1,
    replayEffectCount: 1,
  }),
  correlationTrace: Object.freeze({
    required: true,
    assertionSource: "002-at-015-resilience.spec.ts",
    scope: "workspace/project/effect/correlation",
  }),
  results,
};
mkdirSync(resolve(reportPath, ".."), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(`[smoke:002] ${report.status}; report: ${reportPath}`);
if (failed) process.exitCode = 1;
