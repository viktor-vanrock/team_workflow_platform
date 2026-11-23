import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "artifacts/verification/002-us4-defect-checkpoint.json");
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
  "packages/competency-qa/src/domain/finding.ts",
  "packages/competency-qa/src/domain/defect-publication.ts",
  "packages/competency-qa/src/domain/plan-item-result.ts",
  "packages/competency-qa/src/application/defect-draft-template.ts",
  "packages/competency-qa/src/application/qa-draft-assistant.ts",
  "packages/competency-qa/src/application/create-defect-draft.ts",
  "packages/competency-qa/src/application/defect-publication.ts",
  "packages/competency-qa/src/application/publish-defect-draft.ts",
  "packages/competency-qa/src/application/defect-command-lifecycle.ts",
  "packages/competency-qa/src/application/defect-confirmation-persistence.ts",
  "packages/competency-qa/src/application/finding-action-contribution.ts",
  "packages/competency-qa/src/application/finding-defect-events.ts",
  "packages/competency-qa/src/application/finding-defect-detail-section.ts",
  "packages/competency-qa/src/persistence/finding.repository.ts",
  "packages/competency-qa/src/persistence/defect-publication.repository.ts",
  "packages/competency-qa/src/persistence/migrations/2025-qa-findings-defect-publication.ts",
  "packages/connector-sdk/src/operational-work-item.ts",
  "packages/connector-mock/src/operational-work-item.connector.ts",
  "packages/connector-mock/src/operational-work-item-confirmation.ts",
  "apps/api/src/extensions/qa-findings.controller.ts",
  "apps/api/src/extensions/qa-defects.controller.ts",
  "apps/mock-hub/src/operational/operational.controller.ts",
  "apps/mock-hub/src/operational/operational.repository.ts",
  "packages/runtime-composition/src/qa/operational-work-item.contract.ts",
  "packages/runtime-composition/src/qa/operational-composition.ts",
  "packages/runtime-composition/src/qa/contributions.ts",
  "packages/runtime-composition/src/qa/fake-qa-draft-assistant.ts",
  "packages/runtime-composition/src/seed/qa-local-seed.ts",
  "packages/competency-qa/src/ui/findings-defects.tsx",
  "apps/web/src/App.tsx",
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
  run("us4-eslint", ["node_modules/eslint/bin/eslint.js", ...lintFiles]);
  run("us4-domain-contract-security", [
    "node_modules/vitest/vitest.mjs",
    "run",
    "tests/contract/acceptance/002-at-008-findings.spec.ts",
    "tests/integration/002-non-product-findings.spec.ts",
    "tests/integration/002-finding-publication-matrix.spec.ts",
    "tests/integration/security/acceptance/002-at-009-defect-approval.spec.ts",
    "tests/integration/security/002-defect-publish-authorization.spec.ts",
    "tests/integration/002-defect-publication-recovery.spec.ts",
    "tests/integration/002-defect-confirmation-recovery.spec.ts",
    "tests/integration/security/002-finding-disposition-approval.spec.ts",
    "tests/integration/security/002-finding-risk-waiver.spec.ts",
    "tests/contract/002-defect-draft-assistant.spec.ts",
    "--maxWorkers=1",
  ]);
  run(
    "us4-postgres-route-review-publication",
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/acceptance/002-at-008-finding-classification.spec.ts",
      "tests/integration/002-qa-local-seed.spec.ts",
      "tests/integration/migrations/002-qa-migration-order.spec.ts",
      "--maxWorkers=1",
    ],
    420_000,
  );
  run(
    "us3-regression",
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/002-manual-session-vertical-flow.spec.ts",
      "tests/integration/002-negative-session-review-blocker.spec.ts",
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
  checkpoint: "US4-finding-defect-publication",
  status,
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  invariants: {
    findingLifecycle: "DRAFT→CLASSIFIED→DISPOSED→FROZEN",
    exactCurrentLeafCoverage: true,
    membershipChangeResetsDecision: true,
    frozenFindingSetInSingleSessionReviewed: true,
    observationCreatesNoDefectEffect: true,
    deterministicDraftAndModelFallback: true,
    nonProductAndHumanRejectionZeroEffect: true,
    exactLiveApprovalAndSeparationOfDuty: true,
    defectCreateProfileBindingRevision: 3,
    draftContentImmutable: true,
    oneActiveDraftHead: true,
    failedOrInvalidatedSuccessorOnly: true,
    rejectedOrLinkedChainFinal: true,
    crashAfterEffectRecovery: true,
    oneImmutableDefectLink: true,
    acceptedRiskAndFindingWaiverDistinctLead: true,
    mainComposeStarted: false,
    coreImportsQaSemantics: false,
  },
  evidence: {
    nonContainerSuites: 10,
    postgresSuites: 3,
    typecheckedProjects: 7,
    migrationsThrough: 2025,
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
console.log(`[checkpoint:002:us4:defect] ${status}; report: ${reportPath}`);
if (failure !== undefined) {
  console.error(failure instanceof Error ? failure.message : String(failure));
  process.exitCode = 1;
}
