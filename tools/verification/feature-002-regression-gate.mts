import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "artifacts/verification/feature-002-regression-gate.json");
const feature001Path = resolve(workspace, "artifacts/verification/feature-001-gate.json");
const flags = new Set(process.argv.slice(2));
const known = new Set(["--plan", "--skip-runtime", "--clean-smoke"]);
const unknown = [...flags].filter((value) => !known.has(value));
if (unknown.length > 0) throw new Error(`Unknown regression:002 arguments: ${unknown.join(" ")}`);
const node = process.execPath;
interface Stage {
  readonly id: string;
  readonly command?: readonly string[];
  readonly validation?: string;
  readonly runtime?: boolean;
}
interface Result extends Stage {
  readonly status: "PASS" | "FAIL" | "SKIP";
  readonly durationMs: number;
  readonly detail: string;
}
const stages: readonly Stage[] = Object.freeze([
  { id: "feature-001-final-report", validation: "status=PASS; acceptance=19" },
  {
    id: "feature-001-smoke-unchanged",
    command: [
      node,
      "tools/verification/smoke-001-gate.mts",
      ...(flags.has("--clean-smoke") ? ["--clean"] : []),
    ],
    runtime: true,
  },
  { id: "002-foundation", command: [node, "tools/verification/002-foundation-checkpoint.mts"] },
  { id: "002-intake", command: [node, "tools/verification/002-us1-intake-checkpoint.mts"] },
  { id: "002-readiness", command: [node, "tools/verification/002-us2-readiness-checkpoint.mts"] },
  { id: "002-session", command: [node, "tools/verification/002-us2-session-checkpoint.mts"] },
  { id: "002-evidence", command: [node, "tools/verification/002-us3-evidence-checkpoint.mts"] },
  { id: "002-defect", command: [node, "tools/verification/002-us4-defect-checkpoint.mts"] },
  { id: "002-completion", command: [node, "tools/verification/002-us5-completion-checkpoint.mts"] },
  {
    id: "002-final-focused",
    command: [
      node,
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/security/acceptance/002-at-012-cross-project-isolation.spec.ts",
      "tests/e2e/acceptance/002-at-013-model-degraded-mode.spec.ts",
      "tests/integration/acceptance/002-at-015-resilience.spec.ts",
      "tests/contract/002-contract-registry-and-api-drift.spec.ts",
      "tests/architecture/002-hard-boundaries.spec.ts",
      "tests/architecture/002-non-local-composition-barrier.spec.ts",
      "tests/integration/security/002-secret-redaction-scan.spec.ts",
      "tests/integration/002-migration-matrix.spec.ts",
      "--maxWorkers=1",
    ],
  },
]);
const selected = stages.filter((stage) => !(flags.has("--skip-runtime") && stage.runtime));
if (flags.has("--plan")) {
  console.table(
    selected.map((stage) => ({
      id: stage.id,
      action: stage.command?.join(" ") ?? stage.validation,
    })),
  );
  process.exit(0);
}

const results: Result[] = [];
let failed = false;
const startedAt = new Date();
for (const stage of selected) {
  if (failed) {
    results.push({ ...stage, status: "SKIP", durationMs: 0, detail: "blocked by prior failure" });
    continue;
  }
  const started = Date.now();
  if (stage.validation) {
    let valid = false;
    let detail = "missing Feature 001 report";
    if (existsSync(feature001Path)) {
      const report = JSON.parse(readFileSync(feature001Path, "utf8")) as Readonly<{
        status?: string;
        acceptance?: readonly unknown[];
      }>;
      valid = report.status === "PASS" && report.acceptance?.length === 19;
      detail = `status=${String(report.status)}; acceptance=${String(report.acceptance?.length ?? 0)}`;
    }
    results.push({
      ...stage,
      status: valid ? "PASS" : "FAIL",
      durationMs: Date.now() - started,
      detail,
    });
    failed = !valid;
    continue;
  }
  console.log(`\n[regression:002] ${stage.id}`);
  const command = stage.command!;
  const result = spawnSync(command[0]!, [...command.slice(1)], {
    cwd: workspace,
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
  });
  if (result.error) throw result.error;
  const status = result.status === 0 ? "PASS" : "FAIL";
  results.push({ ...stage, status, durationMs: Date.now() - started, detail: command.join(" ") });
  failed = status === "FAIL";
}
const report = {
  schemaVersion: 1,
  feature: "002-qa-manual-walking-skeleton",
  gate: "combined-regression",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  feature001Report: "artifacts/verification/feature-001-gate.json",
  results,
};
mkdirSync(resolve(reportPath, ".."), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(`[regression:002] ${report.status}; report: ${reportPath}`);
if (failed) process.exitCode = 1;
