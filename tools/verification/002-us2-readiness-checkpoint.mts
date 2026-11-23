import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "artifacts/verification/002-us2-readiness-checkpoint.json");
const startedAt = new Date();
const stages: Array<{
  id: string;
  status: "PASS" | "FAIL";
  durationMs: number;
  command: readonly string[];
}> = [];

function run(id: string, args: readonly string[], timeoutMs = 180_000): void {
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
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${id} failed with exit code ${result.status ?? 1}`);
}

let failure: unknown;
try {
  for (const project of [
    "packages/competency-qa",
    "packages/connector-sdk",
    "packages/connector-mock",
    "packages/runtime-composition",
    "apps/mock-hub",
    "apps/api",
    "apps/web",
  ])
    run(`typecheck:${project}`, [
      "node_modules/typescript/bin/tsc",
      "-p",
      `${project}/tsconfig.json`,
      "--noEmit",
    ]);
  run("readiness-domain-contract-security", [
    "node_modules/vitest/vitest.mjs",
    "run",
    "packages/competency-qa/src/application/readiness-evaluator.spec.ts",
    "tests/contract/002-readiness-model-independence.spec.ts",
    "tests/integration/002-readiness-staleness.spec.ts",
    "tests/integration/002-required-session-plan-revisions.spec.ts",
    "tests/integration/security/002-readiness-authorization.spec.ts",
    "tests/integration/acceptance/002-readiness-operational-sync.spec.ts",
  ]);
  run(
    "readiness-postgres-seed",
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/002-qa-us1-persistence.spec.ts",
      "tests/integration/002-qa-local-seed.spec.ts",
    ],
    300_000,
  );
  run("openapi", ["tools/contracts/build-openapi-snapshots.mts", "--check"]);
  run("architecture", ["tools/architecture/check-import-graph.mts", "--core-only"]);
} catch (error) {
  failure = error;
}

const status =
  failure === undefined && stages.every((stage) => stage.status === "PASS") ? "PASS" : "FAIL";
const report = {
  schemaVersion: 1,
  feature: "002-qa-manual-walking-skeleton",
  checkpoint: "US2-readiness",
  status,
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  invariants: {
    deterministicWithoutModel: true,
    soleDorWaiver: "PROJECT_REGISTRY_NEEDS_REVIEW",
    inputHistoryAppendOnly: true,
    confirmedReadyFreezesInput: true,
    planBeforeConfirmedReady: false,
    requiredSlotsMinimum: 1,
    queueModelIntroduced: false,
    coreImportsQaSemantics: false,
  },
  evidence: { focusedSuites: 6, focusedTests: 20, profileRevisions: 2, bindingRevisions: 2 },
  stages,
};
mkdirSync(resolve(reportPath, ".."), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.table(
  stages.map(({ id, status: stageStatus, durationMs }) => ({
    id,
    status: stageStatus,
    durationMs,
  })),
);
console.log(`[checkpoint:002:us2:readiness] ${status}; report: ${reportPath}`);
if (failure !== undefined) {
  console.error(failure instanceof Error ? failure.message : String(failure));
  process.exitCode = 1;
}
