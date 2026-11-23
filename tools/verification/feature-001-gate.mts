import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const ciReportPath = resolve(workspace, "artifacts/verification/feature-001-ci.json");
const smokeReportPath = resolve(workspace, "artifacts/verification/smoke-001-gate.json");
const traceReportPath = resolve(workspace, "artifacts/verification/feature-001-trace.json");
const reportPath = resolve(workspace, "artifacts/verification/feature-001-gate.json");
const args = new Set(process.argv.slice(2));
const known = new Set(["--reuse-ci", "--allow-current-task"]);
const unknown = [...args].filter((value) => !known.has(value));
if (unknown.length > 0) throw new Error(`Unknown Feature 001 gate arguments: ${unknown.join(" ")}`);

interface StageResult {
  readonly id: string;
  readonly status: "PASS" | "FAIL";
  readonly durationMs: number;
  readonly detail: string;
}
const startedAt = new Date();
const stages: StageResult[] = [];

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) throw new Error(`Required report is missing: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function run(id: string, executable: string, commandArgs: readonly string[]): void {
  const started = Date.now();
  const result = spawnSync(executable, [...commandArgs], {
    cwd: workspace,
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
  });
  if (result.error) throw result.error;
  const status = result.status === 0 ? "PASS" : "FAIL";
  stages.push({
    id,
    status,
    durationMs: Date.now() - started,
    detail: [executable, ...commandArgs].join(" "),
  });
  if (status === "FAIL") throw new Error(`${id} failed with exit code ${String(result.status)}`);
}

function verifyCiEvidence(): void {
  const started = Date.now();
  const ci = readJson(ciReportPath);
  const smoke = readJson(smokeReportPath);
  const passed = ci.status === "PASS" && smoke.status === "PASS" && smoke.cleanBootstrap === true;
  stages.push({
    id: "reuse-provider-neutral-ci",
    status: passed ? "PASS" : "FAIL",
    durationMs: Date.now() - started,
    detail: `ci=${String(ci.status)}; cleanSmoke=${String(smoke.status)}; cleanBootstrap=${String(smoke.cleanBootstrap)}`,
  });
  if (!passed) throw new Error("Existing CI/smoke evidence is not a clean PASS");
}

let failure: unknown;
try {
  if (args.has("--reuse-ci")) verifyCiEvidence();
  else run("provider-neutral-ci", process.execPath, ["tools/ci/feature-001.mts", "--skip-install"]);
  run("post-clean-playwright", "pnpm", ["test:e2e:001"]);
  run("requirements-trace", process.execPath, [
    "tools/verification/feature-001-trace.mts",
    ...(args.has("--allow-current-task") ? ["--allow-pending"] : []),
  ]);
  if (args.has("--allow-current-task")) {
    const trace = readJson(traceReportPath);
    const entries = trace.entries as Array<{ pendingTasks?: string[] }>;
    const pending = [...new Set(entries.flatMap((entry) => entry.pendingTasks ?? []))];
    if (pending.length !== 1 || pending[0] !== "T163")
      throw new Error(`Provisional trace may contain only T163, found: ${pending.join(", ")}`);
  }
} catch (error) {
  failure = error;
  console.error(error instanceof Error ? error.message : String(error));
}

let acceptance: Array<{ id: string; status: string; tests: readonly string[] }> = [];
if (existsSync(traceReportPath)) {
  const trace = readJson(traceReportPath);
  acceptance = (
    trace.entries as Array<{ id: string; kind: string; status: string; tests: readonly string[] }>
  )
    .filter(({ kind }) => kind === "acceptance")
    .map(({ id, status, tests }) => ({ id, status, tests }));
}
const allAcceptancePassed =
  acceptance.length === 19 && acceptance.every(({ status }) => status === "PASS");
const status =
  !failure && stages.every((stage) => stage.status === "PASS") && allAcceptancePassed
    ? "PASS"
    : "FAIL";
const report = {
  schemaVersion: 1,
  feature: "001-extension-kernel-local-skeleton",
  gate: "feature-001-final",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status,
  cleanBootstrapEvidence: smokeReportPath,
  providerNeutralCiEvidence: ciReportPath,
  traceEvidence: traceReportPath,
  stages,
  acceptance,
};
mkdirSync(resolve(reportPath, ".."), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(
  `[gate:001] ${status}; ${acceptance.length}/19 acceptance entries; report: ${reportPath}`,
);
if (status !== "PASS") process.exitCode = 1;
