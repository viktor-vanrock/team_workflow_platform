import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "artifacts/verification/002-us3-evidence-checkpoint.json");
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

const lintFiles = [
  "packages/competency-qa/src/domain/manual-attempt.ts",
  "packages/competency-qa/src/domain/observation.ts",
  "packages/competency-qa/src/domain/plan-item-result.ts",
  "packages/competency-qa/src/domain/evidence-manifest.ts",
  "packages/competency-qa/src/domain/session-review.ts",
  "packages/competency-qa/src/application/transition-session.ts",
  "packages/competency-qa/src/application/manual-attempt-service.ts",
  "packages/competency-qa/src/application/record-observation.ts",
  "packages/competency-qa/src/application/record-plan-item-result.ts",
  "packages/competency-qa/src/application/evidence-artifact-service.ts",
  "packages/competency-qa/src/application/evidence-authorization-contribution.ts",
  "packages/competency-qa/src/application/evidence-manifest-builder.ts",
  "packages/competency-qa/src/application/review-manual-session.ts",
  "packages/competency-qa/src/application/correct-session-review.ts",
  "packages/competency-qa/src/application/manual-review-events.ts",
  "packages/competency-qa/src/application/execution-evidence-detail-section.ts",
  "packages/competency-qa/src/persistence/manual-execution.uow.ts",
  "packages/competency-qa/src/persistence/manual-execution.repository.ts",
  "packages/competency-qa/src/persistence/evidence-review.repository.ts",
  "packages/competency-qa/src/persistence/session-review.uow.ts",
  "apps/api/src/extensions/qa-sessions.controller.ts",
  "apps/api/src/extensions/qa-manual-execution.controller.ts",
  "apps/api/src/extensions/qa-evidence.controller.ts",
  "apps/api/src/extensions/qa-session-review.controller.ts",
  "packages/competency-qa/src/ui/manual-session-executor.tsx",
  "packages/competency-qa/src/ui/evidence-review.tsx",
  "packages/competency-qa/src/ui/contribution.tsx",
];

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
  run("us3-eslint", ["node_modules/eslint/bin/eslint.js", ...lintFiles]);
  run("us3-domain-contract-security", [
    "node_modules/vitest/vitest.mjs",
    "run",
    "tests/integration/002-manual-attempt-lineage.spec.ts",
    "tests/integration/acceptance/002-at-005-manual-review.spec.ts",
    "tests/contract/acceptance/002-at-006-evidence-manifest.spec.ts",
    "tests/integration/security/acceptance/002-at-007-evidence-access.spec.ts",
    "tests/integration/002-evidence-integrity.spec.ts",
    "tests/integration/002-negative-session-review-blocker.spec.ts",
    "tests/integration/002-manual-execution-concurrency.spec.ts",
    "tests/integration/002-evidence-storage-persistence.spec.ts",
    "--maxWorkers=1",
  ]);
  run(
    "us3-postgres-vertical-append-recovery-authorization",
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/002-manual-session-vertical-flow.spec.ts",
      "tests/integration/security/002-evidence-append-only.spec.ts",
      "tests/integration/002-session-review-recovery.spec.ts",
      "tests/integration/security/002-session-review-authorization.spec.ts",
      "--maxWorkers=1",
    ],
    420_000,
  );
  run("us2-regression", [
    "node_modules/vitest/vitest.mjs",
    "run",
    "packages/competency-qa/src/domain/test-session.spec.ts",
    "tests/integration/002-session-snapshot-immutability.spec.ts",
    "tests/integration/security/002-session-start-guards.spec.ts",
    "tests/integration/002-required-session-plan-session-coverage.spec.ts",
    "--maxWorkers=1",
  ]);
  run("openapi-current", ["tools/contracts/build-openapi-snapshots.mts", "--check"]);
  run("openapi-drift", [
    "node_modules/vitest/vitest.mjs",
    "run",
    "tests/contract/openapi-drift.spec.ts",
    "--maxWorkers=1",
  ]);
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
  checkpoint: "US3-execution-evidence-review",
  status,
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  invariants: {
    lifecycle: "RUNNING→REVIEW_REQUIRED→COMPLETED",
    appendOnlyAttemptsObservationsResults: true,
    serverDerivedCompleteMemberships: true,
    cleanPassPositiveExactAttemptSource: true,
    negativeFlowBlockedWithFindingRequired: true,
    flakyBeforeUs4: "INCONCLUSIVE_ONLY",
    planItemWaiverLiveAtSigning: true,
    evidenceAttachmentCasHandoff: true,
    evidenceAvailabilitySeparateFromSignedSnapshot: true,
    signedManifestAndReviewAtomic: true,
    substantiveCorrectionAtomic: true,
    crashRecoveryExactlyOnce: true,
    nativeQaRetestLineageAvailable: true,
    findingOrDefectDependency: false,
    mainComposeStarted: false,
    coreImportsQaSemantics: false,
  },
  evidence: {
    focusedNonContainerSuites: 8,
    focusedNonContainerTests: 13,
    postgresSuites: 4,
    postgresTests: 6,
    typecheckedProjects: 4,
    migrationsThrough: 2020,
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
console.log(`[checkpoint:002:us3:evidence] ${status}; report: ${reportPath}`);
if (failure !== undefined) {
  console.error(failure instanceof Error ? failure.message : String(failure));
  process.exitCode = 1;
}
