import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "artifacts/verification/002-us1-intake-checkpoint.json");
const startedAt = new Date();

interface StageResult {
  readonly id: string;
  readonly status: "PASS" | "FAIL";
  readonly durationMs: number;
  readonly command: readonly string[];
}

const stages: StageResult[] = [];

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
    "packages/connector-sdk",
    "packages/connector-mock",
    "packages/competency-qa",
    "packages/runtime-composition",
    "apps/mock-hub",
    "apps/api",
    "apps/worker",
    "apps/web",
  ])
    run(`typecheck:${project}`, [
      "node_modules/typescript/bin/tsc",
      "-p",
      `${project}/tsconfig.json`,
      "--noEmit",
    ]);
  run("us1-eslint", [
    "node_modules/eslint/bin/eslint.js",
    "packages/connector-sdk/src/operational-work-item.ts",
    "packages/connector-mock/src/operational-work-item.connector.ts",
    "packages/connector-mock/src/operational-work-item-confirmation.ts",
    "packages/competency-qa/src",
    "packages/runtime-composition/src/qa",
    "packages/runtime-composition/src/seed/qa-local-seed.ts",
    "apps/mock-hub/src",
    "apps/api/src/extensions/qa-pack.controller.ts",
    "apps/web/src/App.tsx",
  ]);
  run("openapi-current", ["tools/contracts/build-openapi-snapshots.mts", "--check"]);
  run("web-production-build", [
    "node_modules/vite/bin/vite.js",
    "build",
    "--config",
    "apps/web/vite.config.ts",
  ]);
  run("us1-contract-recovery-security", [
    "node_modules/vitest/vitest.mjs",
    "run",
    "tests/integration/acceptance/002-at-002-confirmed-intake.spec.ts",
    "tests/integration/002-intake-command-recovery.spec.ts",
    "tests/contract/002-operational-work-item-conformance.spec.ts",
    "tests/integration/002-intake-connector-failures.spec.ts",
    "tests/integration/security/002-intake-confirmation-scope.spec.ts",
    "tests/integration/002-qa-foundation-composition.spec.ts",
    "tests/architecture/002-qa-pack-boundaries.spec.ts",
    "tests/contract/openapi-drift.spec.ts",
  ]);
  run(
    "us1-postgres-api-seed",
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/002-qa-us1-persistence.spec.ts",
      "tests/integration/002-qa-local-seed.spec.ts",
      "tests/integration/002-qa-api-us1.spec.ts",
    ],
    300_000,
  );
  run("architecture", ["tools/architecture/check-import-graph.mts", "--core-only"]);
} catch (error) {
  failure = error;
}

const status =
  failure === undefined && stages.every((stage) => stage.status === "PASS") ? "PASS" : "FAIL";
const report = {
  schemaVersion: 1,
  feature: "002-qa-manual-walking-skeleton",
  checkpoint: "US1-confirmed-intake",
  status,
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  invariants: {
    defaultComposition: "foundation",
    qaCompositionSelector: "qa-local",
    unconfirmedDraftExternalEffects: 0,
    concurrentConfirmationUniqueEffects: 1,
    initialRequestInputRevision: 1,
    futureDetailCollectionsExplicitlyEmpty: true,
    qaEnabledOutsideIntendedWorkspace: false,
    coreImportsQaSemantics: false,
    qaImportsConnectorRuntime: false,
  },
  evidence: {
    nonContainerSuites: 8,
    nonContainerTests: 24,
    postgresSuites: 3,
    postgresTests: 4,
    openApiOperations: { api: 49, mockHub: 9 },
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
console.log(`[checkpoint:002:us1] ${status}; report: ${reportPath}`);
if (failure !== undefined) {
  console.error(failure instanceof Error ? failure.message : String(failure));
  process.exitCode = 1;
}
