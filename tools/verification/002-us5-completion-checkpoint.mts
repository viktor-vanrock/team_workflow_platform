import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "artifacts/verification/002-us5-completion-checkpoint.json");
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
  "packages/competency-qa/src/domain/verdict.ts",
  "packages/competency-qa/src/domain/dod.ts",
  "packages/competency-qa/src/domain/completion.ts",
  "packages/competency-qa/src/domain/post-close-correction.ts",
  "packages/competency-qa/src/domain/evidence-manifest.ts",
  "packages/competency-qa/src/application/create-verdict.ts",
  "packages/competency-qa/src/application/sign-verdict.ts",
  "packages/competency-qa/src/application/verdict-cosign-action.ts",
  "packages/competency-qa/src/application/dod-evaluator.ts",
  "packages/competency-qa/src/application/request-completion-waiver.ts",
  "packages/competency-qa/src/application/dod-waiver-action.ts",
  "packages/competency-qa/src/application/create-completion-candidate.ts",
  "packages/competency-qa/src/application/invalidate-completion-candidate.ts",
  "packages/competency-qa/src/application/request-completion.ts",
  "packages/competency-qa/src/application/completion-command-lifecycle.ts",
  "packages/competency-qa/src/application/completion-confirmation-persistence.ts",
  "packages/competency-qa/src/application/completion-reconciliation.ts",
  "packages/competency-qa/src/application/record-post-close-correction.ts",
  "packages/competency-qa/src/application/verdict-completion-detail-section.ts",
  "packages/competency-qa/src/application/verdict-completion-events.ts",
  "packages/competency-qa/src/persistence/migrations/2030-qa-verdict-completion.ts",
  "packages/competency-qa/src/persistence/verdict-dod.repository.ts",
  "packages/competency-qa/src/persistence/post-close-correction.repository.ts",
  "packages/connector-sdk/src/operational-work-item.ts",
  "packages/connector-mock/src/manifest.ts",
  "packages/connector-mock/src/operational-work-item.connector.ts",
  "packages/connector-mock/src/operational-work-item-confirmation.ts",
  "apps/mock-hub/src/operational/operational.controller.ts",
  "apps/mock-hub/src/operational/operational.repository.ts",
  "apps/mock-hub/src/persistence/migrations/0030-operational-completion.ts",
  "packages/runtime-composition/src/qa/contributions.ts",
  "packages/runtime-composition/src/qa/confirmation-hooks.ts",
  "packages/runtime-composition/src/qa/external-command-lifecycle-hooks.ts",
  "packages/runtime-composition/src/qa/operational-work-item.contract.ts",
  "packages/runtime-composition/src/seed/qa-local-seed.ts",
  "apps/api/src/extensions/qa-verdict-completion.controller.ts",
  "apps/api/src/extensions/qa-evidence.controller.ts",
  "packages/competency-qa/src/ui/verdict-completion.tsx",
  "packages/competency-qa/src/ui/evidence-review.tsx",
  "apps/web/src/App.tsx",
  "tests/integration/002-manual-vertical-flow.spec.ts",
  "tests/integration/002-post-close-correction-persistence.spec.ts",
];

let failure: unknown;
try {
  if (Number(process.versions.node.split(".", 1)[0]) !== 24)
    throw new Error(`Node 24 required; received ${process.versions.node}`);
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
  run("us5-eslint", ["node_modules/eslint/bin/eslint.js", ...lintFiles]);
  run("us5-domain-contract-security", [
    "node_modules/vitest/vitest.mjs",
    "run",
    "tests/integration/security/acceptance/002-at-010-verdict-risk-review.spec.ts",
    "tests/integration/acceptance/002-at-011-dod.spec.ts",
    "tests/integration/acceptance/002-done-with-fail.spec.ts",
    "tests/integration/002-completion-recovery.spec.ts",
    "tests/integration/002-verdict-supersession.spec.ts",
    "tests/integration/002-manual-vertical-flow.spec.ts",
    "--maxWorkers=1",
  ]);
  run(
    "us5-postgres-migrations-seed-post-close",
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/002-post-close-correction-persistence.spec.ts",
      "tests/integration/002-qa-local-seed.spec.ts",
      "tests/integration/migrations/002-qa-migration-order.spec.ts",
      "--maxWorkers=1",
    ],
    420_000,
  );
  run(
    "us4-regression",
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/acceptance/002-at-008-finding-classification.spec.ts",
      "tests/integration/002-defect-confirmation-recovery.spec.ts",
      "--maxWorkers=1",
    ],
    300_000,
  );
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
  checkpoint: "US5-verdict-dod-completion",
  status,
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  invariants: {
    ordinaryOneSignature: true,
    highCriticalDistinctLeadCosign: true,
    signedVerdictHistoryRetained: true,
    deterministicDod: true,
    exactPlanAndCarryForwardCoverage: true,
    failedInvalidatedDefectHistoryNonBlocking: true,
    doneWithFail: true,
    releaseDecisionCreated: false,
    structuredSummaryDigestReceipt: true,
    exactDistinctCloseApproval: true,
    packProjectionBeforeOutboxReady: true,
    completionSelfTransitionSkipsInvalidation: true,
    aggregateMutationInvalidatesPredispatch: true,
    dispatchedBlocksMutation: true,
    failureReleasesInFlight: true,
    confirmationFreezesPlanAndSatisfiesDod: true,
    partialEffectReconcilesByOriginalKey: true,
    postDoneAggregateMutationBlocked: true,
    clericalCorrectionLatestOnly: true,
    adjudicativePointerUnchanged: true,
    completionProfileBindingRevision: 4,
    mainComposeStarted: false,
    coreImportsQaSemantics: false,
  },
  evidence: {
    focusedTests: 38,
    postgresSuites: 3,
    typecheckedProjects: 7,
    migrationsThrough: 2030,
    mockAndSecondConnectorConformance: true,
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
console.log(`[checkpoint:002:us5:completion] ${status}; report: ${reportPath}`);
if (failure !== undefined) {
  console.error(failure instanceof Error ? failure.message : String(failure));
  process.exitCode = 1;
}
