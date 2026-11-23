import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "artifacts/verification/smoke-001-gate.json");
const compose = [
  "compose",
  "--project-name",
  process.env.AWP_LOCAL_PROJECT_NAME?.trim() || "awp-local",
  "--file",
  resolve(workspace, "infra/compose/docker-compose.local.yml"),
] as const;
const clean = process.argv.slice(2).includes("--clean");
const unexpected = process.argv.slice(2).filter((value) => value !== "--clean");
if (unexpected.length > 0) throw new Error(`Unknown smoke:001 arguments: ${unexpected.join(" ")}`);

interface StageResult {
  readonly name: string;
  readonly status: "PASS" | "FAIL";
  readonly command: readonly string[];
  readonly durationMs: number;
  readonly exitCode: number;
}

const startedAt = new Date();
const stages: StageResult[] = [];

function run(name: string, executable: string, args: readonly string[]): void {
  const started = Date.now();
  console.log(`\n[smoke:001] ${name}`);
  const result = spawnSync(executable, [...args], {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  const exitCode = result.status ?? 1;
  stages.push({
    name,
    status: exitCode === 0 ? "PASS" : "FAIL",
    command: [executable, ...args],
    durationMs: Date.now() - started,
    exitCode,
  });
  if (exitCode !== 0) throw new Error(`${name} failed with exit code ${exitCode}`);
}

try {
  if (clean) run("clean local reset", process.execPath, ["tools/local/reset.mts", "--yes"]);
  run("local bootstrap/readiness", process.execPath, ["tools/local/cli.mts", "up"]);
  run("walking skeleton first pass", process.execPath, ["tools/smoke/feature-001.mts"]);
  run("walking skeleton repeat/idempotency pass", process.execPath, [
    "tools/smoke/feature-001.mts",
  ]);
  run("worker restart", "docker", [...compose, "restart", "worker"]);
  run("worker readiness after restart", "docker", [
    ...compose,
    "up",
    "--detach",
    "--wait",
    "worker",
  ]);
  run("post-restart walking skeleton", process.execPath, ["tools/smoke/feature-001.mts"]);
  run("second worker restart", "docker", [...compose, "restart", "worker"]);
  run("post-second-restart effect pass", process.execPath, ["tools/smoke/feature-001.mts"]);
} catch (error) {
  if (!stages.some(({ status }) => status === "FAIL")) {
    stages.push({
      name: "gate orchestration",
      status: "FAIL",
      command: [],
      durationMs: 0,
      exitCode: 1,
    });
  }
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  const report = {
    schemaVersion: 1,
    feature: "001-extension-kernel-local-skeleton",
    gate: "smoke-001",
    cleanBootstrap: clean,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    status: stages.length > 0 && stages.every(({ status }) => status === "PASS") ? "PASS" : "FAIL",
    stages,
  };
  mkdirSync(resolve(reportPath, ".."), { recursive: true });
  writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
  console.log(`[smoke:001] report: ${reportPath}`);
  if (report.status !== "PASS") process.exitCode = 1;
}
