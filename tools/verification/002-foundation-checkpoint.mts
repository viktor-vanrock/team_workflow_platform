import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "artifacts/verification/002-foundation-checkpoint.json");
const startedAt = new Date();

interface StageResult {
  readonly id: string;
  readonly status: "PASS" | "FAIL";
  readonly durationMs: number;
  readonly command: readonly string[];
}

const stages: StageResult[] = [];

function run(id: string, args: readonly string[], timeoutMs = 120_000): void {
  const started = Date.now();
  const command = [process.execPath, ...args];
  const result = spawnSync(process.execPath, [...args], {
    cwd: workspace,
    env: { ...process.env, CI: "true" },
    stdio: "inherit",
    timeout: timeoutMs,
  });
  const status = result.status === 0 && result.error === undefined ? "PASS" : "FAIL";
  stages.push({ id, status, durationMs: Date.now() - started, command });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`${id} failed with exit code ${result.status ?? 1}`);
}

let failure: unknown;
try {
  if (Number(process.versions.node.split(".", 1)[0]) !== 24) {
    throw new Error(`Node 24 is required; received ${process.versions.node}`);
  }
  run("qa-typecheck", [
    "node_modules/typescript/bin/tsc",
    "-p",
    "packages/competency-qa/tsconfig.json",
    "--noEmit",
  ]);
  run("runtime-composition-typecheck", [
    "node_modules/typescript/bin/tsc",
    "-p",
    "packages/runtime-composition/tsconfig.json",
    "--noEmit",
  ]);
  run("foundation-eslint", [
    "node_modules/eslint/bin/eslint.js",
    "packages/competency-qa/src",
    "packages/runtime-composition/src/qa",
    "tests/integration/002-qa-foundation-composition.spec.ts",
  ]);
  run(
    "foundation-contracts",
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/contract/acceptance/002-at-001-qa-pack-contract.spec.ts",
      "tests/architecture/002-qa-pack-boundaries.spec.ts",
      "tests/integration/migrations/002-qa-migration-order.spec.ts",
      "tests/integration/security/002-qa-scope-constraints.spec.ts",
      "tests/integration/security/002-qa-human-authorization.spec.ts",
      "tests/contract/002-qa-domain-primitives.spec.ts",
      "tests/architecture/002-generic-contribution-registries.spec.ts",
      "tests/contract/002-qa-events-and-audit.spec.ts",
      "tests/integration/002-qa-foundation-composition.spec.ts",
    ],
    180_000,
  );
  run("core-only-architecture", ["tools/architecture/check-import-graph.mts", "--core-only"]);
} catch (error) {
  failure = error;
}

const report = {
  schemaVersion: 1,
  feature: "002-qa-manual-walking-skeleton",
  gate: "002-foundation-checkpoint",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status:
    failure === undefined && stages.every(({ status }) => status === "PASS") ? "PASS" : "FAIL",
  invariants: {
    foundationDefaultQaFree: true,
    qaStoryMigrationsInstalled: 0,
    qaStoryEntitiesInstalled: 0,
    qaExecutableHandlersInstalled: 0,
  },
  stages,
};

mkdirSync(resolve(reportPath, ".."), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.table(stages.map(({ id, status, durationMs }) => ({ id, status, durationMs })));
console.log(`[foundation:002] ${report.status}; report: ${reportPath}`);
if (failure !== undefined) {
  console.error(failure instanceof Error ? failure.message : String(failure));
  process.exitCode = 1;
}
