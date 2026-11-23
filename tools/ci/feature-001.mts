import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { stringifyPortableJson } from "../verification/portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "artifacts/verification/feature-001-ci.json");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const args = new Set(process.argv.slice(2));
const known = new Set(["--plan", "--skip-install", "--no-clean"]);
const unknown = [...args].filter((value) => !known.has(value));
if (unknown.length > 0) throw new Error(`Unknown ci:001 arguments: ${unknown.join(" ")}`);

interface StageSpec {
  readonly id: string;
  readonly description: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly matrix?: Readonly<Record<string, readonly string[]>>;
}

interface StageResult extends StageSpec {
  readonly status: "PASS" | "FAIL" | "SKIP";
  readonly durationMs: number;
  readonly exitCode?: number;
}

const stages: StageSpec[] = [
  {
    id: "toolchain-node-24",
    description: "Exact Node/pnpm/Docker prerequisites",
    executable: process.execPath,
    args: ["tools/local/check-prerequisites.mts"],
  },
  {
    id: "install-frozen",
    description: "Frozen lockfile install",
    executable: pnpm,
    args: ["install", "--frozen-lockfile"],
  },
  { id: "lint", description: "Repository lint gate", executable: pnpm, args: ["lint"] },
  { id: "typecheck", description: "Nx workspace typecheck", executable: pnpm, args: ["typecheck"] },
  { id: "build", description: "Nx workspace build", executable: pnpm, args: ["build"] },
  {
    id: "unit",
    description: "Provider-neutral in-memory unit gate",
    executable: pnpm,
    args: ["test:unit"],
  },
  {
    id: "architecture",
    description: "Import graph and hard-boundary gate",
    executable: pnpm,
    args: ["test:architecture"],
  },
  {
    id: "contracts",
    description: "31 schemas, OpenAPI 48 operations, AsyncAPI and typed writes",
    executable: pnpm,
    args: ["test:contract"],
  },
  {
    id: "security",
    description: "Authorization, redaction, append-only audit and tamper tests",
    executable: process.execPath,
    args: ["node_modules/vitest/vitest.mjs", "run", "tests/integration/security"],
  },
  {
    id: "integration-postgres-matrix",
    description: "Full integration suite including migration recovery",
    executable: pnpm,
    args: ["test:integration"],
    matrix: { node: ["24.20.0"], postgres: ["17", "18"] },
  },
  {
    id: "local-bootstrap",
    description: "Local provider-neutral Compose runtime",
    executable: pnpm,
    args: ["local:up"],
  },
  {
    id: "playwright",
    description: "Chromium acceptance for all nine personas",
    executable: pnpm,
    args: ["test:e2e:001"],
  },
  {
    id: args.has("--no-clean") ? "smoke" : "clean-smoke",
    description: `${args.has("--no-clean") ? "Repeat" : "Clean"}/worker-restart/artifact-reference gate`,
    executable: process.execPath,
    args: ["tools/verification/smoke-001-gate.mts", ...(args.has("--no-clean") ? [] : ["--clean"])],
  },
];

const selected = args.has("--skip-install")
  ? stages.filter(({ id }) => id !== "install-frozen")
  : stages;
if (args.has("--plan")) {
  console.table(
    selected.map(({ id, description, executable, args: commandArgs, matrix }) => ({
      id,
      description,
      command: [executable, ...commandArgs].join(" "),
      matrix: matrix ? JSON.stringify(matrix) : "",
    })),
  );
  process.exit(0);
}

const startedAt = new Date();
const results: StageResult[] = [];
let failed = false;
for (const stage of selected) {
  if (failed) {
    results.push({ ...stage, status: "SKIP", durationMs: 0 });
    continue;
  }
  console.log(`\n[ci:001] ${stage.id}: ${stage.description}`);
  const started = Date.now();
  const result = spawnSync(stage.executable, [...stage.args], {
    cwd: workspace,
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
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
  feature: "001-extension-kernel-local-skeleton",
  gate: "provider-neutral-ci",
  provider: "neutral",
  runtime: { node: process.version, platform: process.platform, architecture: process.arch },
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  stages: results,
};
mkdirSync(resolve(reportPath, ".."), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(`[ci:001] report: ${reportPath}`);
if (failed) process.exitCode = 1;
