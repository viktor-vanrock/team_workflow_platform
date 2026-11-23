import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { stringifyPortableJson } from "../verification/portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "artifacts/verification/feature-002-ci.json");
const flags = new Set(process.argv.slice(2));
const known = new Set(["--plan", "--skip-install", "--skip-runtime"]);
const unknown = [...flags].filter((value) => !known.has(value));
if (unknown.length > 0) throw new Error(`Unknown ci:002 arguments: ${unknown.join(" ")}`);
const node = process.execPath;
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

interface Stage {
  readonly id: string;
  readonly description: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly matrix?: Readonly<Record<string, readonly string[]>>;
  readonly runtime?: boolean;
}
interface Result extends Stage {
  readonly status: "PASS" | "FAIL" | "SKIP";
  readonly durationMs: number;
  readonly exitCode?: number;
}
const stages: readonly Stage[] = Object.freeze([
  {
    id: "prerequisites",
    description: "Node 24, pnpm, Docker, lock and Feature 001 prerequisite evidence",
    executable: node,
    args: ["tools/verification/feature-002-prerequisites.mts"],
  },
  {
    id: "install-frozen",
    description: "Frozen lockfile verification",
    executable: pnpm,
    args: ["install", "--frozen-lockfile"],
  },
  {
    id: "lint",
    description: "Repository ESLint gate",
    executable: node,
    args: ["node_modules/eslint/bin/eslint.js", "."],
  },
  {
    id: "typecheck",
    description: "All Nx typecheck targets",
    executable: node,
    args: ["node_modules/nx/dist/bin/nx.js", "run-many", "-t", "typecheck", "--all"],
  },
  {
    id: "build",
    description: "All Nx build targets",
    executable: node,
    args: ["node_modules/nx/dist/bin/nx.js", "run-many", "-t", "build", "--all"],
  },
  {
    id: "contracts",
    description: "Offline registry, OpenAPI/AsyncAPI/RFC 9457 and drift",
    executable: node,
    args: ["node_modules/vitest/vitest.mjs", "run", "tests/contract", "--maxWorkers=1"],
  },
  {
    id: "architecture",
    description: "Import graph and Feature 002 hard boundaries",
    executable: node,
    args: ["node_modules/vitest/vitest.mjs", "run", "tests/architecture", "--maxWorkers=1"],
  },
  {
    id: "security",
    description: "Scope, authorization, evidence and redaction",
    executable: node,
    args: ["node_modules/vitest/vitest.mjs", "run", "tests/integration/security", "--maxWorkers=1"],
  },
  {
    id: "integration",
    description: "Full integration and resilience suite",
    executable: node,
    args: ["node_modules/vitest/vitest.mjs", "run", "tests/integration", "--maxWorkers=1"],
  },
  {
    id: "postgres-matrix",
    description: "Fresh/repeat/current-1/recovery on PostgreSQL 17/18",
    executable: node,
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/002-migration-matrix.spec.ts",
      "--maxWorkers=1",
    ],
    matrix: { node: ["24.20.0"], postgres: ["17.7", "18.6"] },
  },
  {
    id: "playwright",
    description: "Chromium Requester→Executor→Lead QA acceptance",
    executable: node,
    args: [
      "node_modules/@playwright/test/cli.js",
      "test",
      "tests/e2e/acceptance/002-at-014-manual-walking-skeleton.spec.ts",
    ],
    runtime: true,
  },
  {
    id: "smoke",
    description: "Clean/repeat/restart/model-outage/cross-project smoke",
    executable: node,
    args: ["tools/smoke/feature-002.mts"],
  },
  {
    id: "trace",
    description: "US/FR/SC/AT trace and orphan detection",
    executable: node,
    args: ["tools/verification/feature-002-trace.mts"],
  },
]);
const selected = stages.filter(
  (stage) =>
    !(flags.has("--skip-install") && stage.id === "install-frozen") &&
    !(flags.has("--skip-runtime") && stage.runtime),
);
if (flags.has("--plan")) {
  console.table(
    selected.map(({ id, description, executable, args, matrix }) => ({
      id,
      description,
      command: [executable, ...args].join(" "),
      matrix: matrix ? JSON.stringify(matrix) : "",
    })),
  );
  process.exit(0);
}

const startedAt = new Date();
const results: Result[] = [];
let failed = false;
for (const stage of selected) {
  if (failed) {
    results.push({ ...stage, status: "SKIP", durationMs: 0 });
    continue;
  }
  console.log(`\n[ci:002] ${stage.id}: ${stage.description}`);
  const started = Date.now();
  const result = spawnSync(stage.executable, [...stage.args], {
    cwd: workspace,
    stdio: "inherit",
    env: { ...process.env, CI: "true", AWP_COMPOSITION: "qa-local" },
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
console.log(`[ci:002] ${report.status}; report: ${reportPath}`);
if (failed) process.exitCode = 1;
