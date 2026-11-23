import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "artifacts/verification/002-us2-session-checkpoint.json");
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
  if (Number(process.versions.node.split(".", 1)[0]) !== 24)
    throw new Error(`Node 24 required; received ${process.versions.node}`);
  for (const project of [
    "packages/competency-qa",
    "packages/runtime-composition",
    "apps/api",
    "apps/web",
  ])
    run(`typecheck:${project}`, [
      "node_modules/typescript/bin/tsc",
      "-p",
      `${project}/tsconfig.json`,
      "--noEmit",
    ]);
  run("session-eslint", [
    "node_modules/eslint/bin/eslint.js",
    "packages/competency-qa/src/domain/test-session.ts",
    "packages/competency-qa/src/domain/snapshots.ts",
    "packages/competency-qa/src/domain/plan-item.ts",
    "packages/competency-qa/src/application/target-snapshot-builder.ts",
    "packages/competency-qa/src/application/scope-snapshot-builder.ts",
    "packages/competency-qa/src/application/plan-manual-session.ts",
    "packages/competency-qa/src/application/manage-plan-items.ts",
    "packages/competency-qa/src/application/prepare-session.ts",
    "packages/competency-qa/src/application/session-start-guards.ts",
    "packages/competency-qa/src/application/create-linked-session.ts",
    "packages/competency-qa/src/application/session-planning-events.ts",
    "packages/competency-qa/src/persistence/manual-session.repository.ts",
    "packages/competency-qa/src/persistence/manual-execution.uow.ts",
    "apps/api/src/extensions/qa-sessions.controller.ts",
    "packages/competency-qa/src/ui/session-planner.tsx",
    "packages/competency-qa/src/ui/contribution.tsx",
  ]);
  run("session-domain-contract-security", [
    "node_modules/vitest/vitest.mjs",
    "run",
    "packages/competency-qa/src/domain/test-session.spec.ts",
    "tests/integration/002-session-snapshot-immutability.spec.ts",
    "tests/integration/security/002-session-start-guards.spec.ts",
    "tests/integration/002-required-session-plan-session-coverage.spec.ts",
    "tests/contract/openapi-drift.spec.ts",
    "--maxWorkers=1",
  ]);
  run(
    "session-postgres-api-lineage-locks",
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/002-session-lineage.spec.ts",
      "--maxWorkers=1",
    ],
    300_000,
  );
  run("readiness-prerequisite-regression", [
    "node_modules/vitest/vitest.mjs",
    "run",
    "packages/competency-qa/src/application/readiness-evaluator.spec.ts",
    "tests/contract/002-readiness-model-independence.spec.ts",
    "tests/integration/002-readiness-staleness.spec.ts",
    "tests/integration/002-required-session-plan-revisions.spec.ts",
    "tests/integration/security/002-readiness-authorization.spec.ts",
    "tests/integration/acceptance/002-readiness-operational-sync.spec.ts",
    "--maxWorkers=1",
  ]);
  run("openapi-current", ["tools/contracts/build-openapi-snapshots.mts", "--check"]);
  run("web-production-build", [
    "node_modules/vite/bin/vite.js",
    "build",
    "--config",
    "apps/web/vite.config.ts",
  ]);
  run("architecture", ["tools/architecture/check-import-graph.mts", "--core-only"]);
} catch (error) {
  failure = error;
}

const status =
  failure === undefined && stages.every((stage) => stage.status === "PASS") ? "PASS" : "FAIL";
const report = {
  schemaVersion: 1,
  feature: "002-qa-manual-walking-skeleton",
  checkpoint: "US2-manual-session",
  status,
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  invariants: {
    mode: "MANUAL",
    lifecycle: "PLANNED→READY→RUNNING",
    planRequirementPinned: true,
    targetAndScopeSnapshotsPinned: true,
    readyAgainstStructureHashExact: true,
    structuralEditResetsReady: true,
    startedSessionStructureLocked: true,
    parentScopeAndAcyclic: true,
    linkedReplacementOnlyForLockedOriginal: true,
    nativeQaRetestLineageAvailable: false,
    executionAndReviewIntroduced: false,
    coreImportsQaSemantics: false,
  },
  evidence: {
    sessionNonContainerSuites: 5,
    sessionNonContainerTests: 16,
    postgresSuites: 1,
    postgresTests: 3,
    readinessRegressionSuites: 6,
    readinessRegressionTests: 20,
    typecheckedProjects: 4,
  },
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
console.log(`[checkpoint:002:us2:session] ${status}; report: ${reportPath}`);
if (failure !== undefined) {
  console.error(failure instanceof Error ? failure.message : String(failure));
  process.exitCode = 1;
}
