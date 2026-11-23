import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { normalizePortableJson, stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const artifacts = resolve(workspace, "artifacts/verification");
const reportPath = resolve(artifacts, "002-phase1-regression-gate.json");
const smokeReportPath = resolve(artifacts, "smoke-001-gate.json");
const phaseSmokeReportPath = resolve(artifacts, "002-phase1-smoke-001.json");
const unexpected = process.argv.slice(2);
if (unexpected.length > 0)
  throw new Error(`Unknown Phase 1 gate arguments: ${unexpected.join(" ")}`);

interface StageResult {
  readonly id: string;
  readonly status: "PASS" | "FAIL";
  readonly command: readonly string[];
  readonly durationMs: number;
  readonly detail: string;
}

interface JsonRecord {
  readonly [key: string]: unknown;
}

const startedAt = new Date();
const stages: StageResult[] = [];
const environment = {
  ...process.env,
  AWP_COMPOSITION: "foundation",
  AWP_RUNTIME_PROFILE: "local",
  CI: "true",
};

function run(id: string, executable: string, args: readonly string[], timeoutMs = 120_000): void {
  const started = Date.now();
  const command = [executable, ...args];
  console.log(`\n[phase1:002] ${id}`);
  const result = spawnSync(executable, [...args], {
    cwd: workspace,
    env: environment,
    stdio: "inherit",
    timeout: timeoutMs,
  });
  const exitCode = result.status ?? 1;
  const errorDetail = result.error?.message;
  const stage = {
    id,
    status: exitCode === 0 && errorDetail === undefined ? "PASS" : "FAIL",
    command,
    durationMs: Date.now() - started,
    detail:
      errorDetail ??
      (exitCode === 0 ? "exitCode=0" : `exitCode=${exitCode}; signal=${result.signal ?? "none"}`),
  } as const;
  stages.push(stage);
  if (errorDetail !== undefined) throw new Error(errorDetail, { cause: result.error });
  if (exitCode !== 0) throw new Error(`${id} failed with exit code ${exitCode}`);
}

function runSmokeWithoutReplacingCleanPrerequisite(): void {
  const previousCleanReport = existsSync(smokeReportPath)
    ? readFileSync(smokeReportPath, "utf8")
    : undefined;
  let currentReport: string | undefined;
  try {
    run("core-only-smoke-001", "pnpm", ["smoke:001"], 12 * 60_000);
  } finally {
    if (existsSync(smokeReportPath)) {
      currentReport = readFileSync(smokeReportPath, "utf8");
      mkdirSync(artifacts, { recursive: true });
      writeFileSync(phaseSmokeReportPath, normalizePortableJson(currentReport, workspace), "utf8");
    }
    if (previousCleanReport !== undefined)
      writeFileSync(smokeReportPath, normalizePortableJson(previousCleanReport, workspace), "utf8");
  }

  if (currentReport === undefined) throw new Error("smoke:001 produced no report");
  const smoke = JSON.parse(currentReport) as JsonRecord;
  if (smoke.gate !== "smoke-001" || smoke.status !== "PASS")
    throw new Error("Current smoke:001 report is not PASS");
  const smokeStartedAt = Date.parse(String(smoke.startedAt));
  if (!Number.isFinite(smokeStartedAt) || smokeStartedAt < startedAt.getTime())
    throw new Error("smoke:001 report is stale");
  const smokeStages = smoke.stages as readonly JsonRecord[] | undefined;
  if (
    !Array.isArray(smokeStages) ||
    smokeStages.length === 0 ||
    smokeStages.some(({ status }) => status !== "PASS")
  ) {
    throw new Error("Current smoke:001 report has missing or failed stages");
  }
  stages.push({
    id: "current-smoke-report",
    status: "PASS",
    command: [],
    durationMs: 0,
    detail: `${smokeStages.length} stages PASS; composition=foundation; evidence=${phaseSmokeReportPath}`,
  });
}

let failure: unknown;
try {
  if (Number(process.versions.node.split(".", 1)[0]) !== 24)
    throw new Error(`Node 24 is required; received ${process.versions.node}`);
  run("compile-design-registry", process.execPath, ["tools/contracts/build-registry.mts"]);
  run("verify-design-registry-snapshot", process.execPath, [
    "tools/contracts/build-registry.mts",
    "--check",
  ]);
  run("phase1-contracts-green", process.execPath, [
    "node_modules/vitest/vitest.mjs",
    "run",
    "tests/contract/002-design-contract-build.spec.ts",
    "tests/contract/feature-002-prerequisite-contract.spec.ts",
    "--pool=threads",
    "--maxWorkers=1",
  ]);
  run("core-only-architecture", process.execPath, [
    "tools/architecture/check-import-graph.mts",
    "--core-only",
  ]);
  try {
    runSmokeWithoutReplacingCleanPrerequisite();
  } finally {
    run("stop-local-stack", process.execPath, ["tools/local/cli.mts", "down"]);
  }
} catch (error) {
  failure = error;
}

const report = {
  schemaVersion: 1,
  feature: "002-qa-manual-walking-skeleton",
  gate: "002-phase1-regression",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status:
    failure === undefined && stages.every(({ status }) => status === "PASS") ? "PASS" : "FAIL",
  environment: {
    node: process.versions.node,
    composition: "foundation",
    runtimeProfile: "local",
  },
  evidence: {
    generatedRegistry: resolve(
      workspace,
      "packages/platform-contracts/src/generated/schema-documents.ts",
    ),
    currentSmoke001: phaseSmokeReportPath,
    preservedCleanSmoke001: smokeReportPath,
  },
  stages,
};

mkdirSync(artifacts, { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.table(
  stages.map(({ id, status, durationMs, detail }) => ({ id, status, durationMs, detail })),
);
console.log(`[phase1:002] ${report.status}; report: ${reportPath}`);

if (failure !== undefined) {
  console.error(failure instanceof Error ? failure.message : String(failure));
  process.exitCode = 1;
}
