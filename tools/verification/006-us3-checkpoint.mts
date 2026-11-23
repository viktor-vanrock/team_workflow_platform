import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { queueScenarioCatalog, runQueueScenario } from "../local/queue-scenario.mts";
import { stringifyPortableJson } from "./portable-json.mts";

interface Stage {
  readonly id: string;
  readonly description: string;
  readonly args: readonly string[];
}

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/006-queue-triage-capacity-sla/us3.json");
const vitest = "node_modules/vitest/vitest.mjs";
const tsc = "node_modules/typescript/bin/tsc";
const stages: readonly Stage[] = Object.freeze([
  Object.freeze({
    id: "us3-contract-unit-security-integration-browser",
    description:
      "Factorized proposal, deterministic fallback, exact accepted controls, Approval v1/v2, Jira separation and UI",
    args: Object.freeze([
      vitest,
      "run",
      "tests/contract/006/us3-triage-assessment.spec.ts",
      "tests/unit/006/triage-assessment.spec.ts",
      "tests/unit/006/triage-model-boundary.spec.ts",
      "tests/integration/006/us3-accepted-controls.spec.ts",
      "tests/integration/006/us3-platform-actions.spec.ts",
      "tests/integration/security/006/us3-approval-v2.spec.ts",
      "tests/integration/006/us3-jira-authority.spec.ts",
      "tests/e2e/006/us3-triage-controls.spec.ts",
      "--maxWorkers=1",
    ]),
  }),
  ...[
    "packages/platform-core/tsconfig.json",
    "packages/platform-persistence-typeorm/tsconfig.json",
    "packages/platform-runtime-nest/tsconfig.json",
    "packages/runtime-composition/tsconfig.json",
    "packages/competency-qa/tsconfig.json",
    "apps/api/tsconfig.json",
    "apps/web/tsconfig.json",
    "apps/worker/tsconfig.json",
  ].map((project): Stage =>
    Object.freeze({
      id: `typecheck-${project.replace(/\/tsconfig\.json$/u, "").replaceAll("/", "-")}`,
      description: `Static typecheck ${project}`,
      args: Object.freeze([tsc, "-p", project, "--noEmit"]),
    }),
  ),
]);

const startedAt = new Date();
const results = stages.map((stage) => {
  const started = Date.now();
  const result = spawnSync(process.execPath, [...stage.args], {
    cwd: workspace,
    env: { ...process.env, CI: "true" },
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
  }
  return Object.freeze({
    ...stage,
    status: result.status === 0 ? ("PASS" as const) : ("FAIL" as const),
    exitCode: result.status ?? 1,
    durationMs: Date.now() - started,
    outputHash: `sha256:${createHash("sha256").update(`${result.stdout}\n${result.stderr}`).digest("hex")}`,
  });
});
const us3Catalog = queueScenarioCatalog.filter(({ id }) => id.startsWith("us3-"));
const scenarios = await Promise.all(
  us3Catalog.map(({ id }) => runQueueScenario(id, { mode: "TEST" })),
);
const failed =
  results.some(({ status }) => status !== "PASS") ||
  scenarios.some(({ status }) => status !== "PASS") ||
  scenarios.length !== 8;
const taskPath = "specs/006-queue-triage-capacity-sla/tasks.md";
const report = Object.freeze({
  schemaVersion: 1,
  feature: "006-queue-triage-capacity-sla",
  checkpoint: "US3",
  status: failed ? "FAIL" : "PASS",
  contour: "qa-jira-gitlab-mattermost-local",
  externalNetwork: "DENIED",
  production: "DENIED",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  taskBinding: Object.freeze({
    path: taskPath,
    sha256: `sha256:${createHash("sha256")
      .update(readFileSync(resolve(workspace, taskPath)))
      .digest("hex")}`,
  }),
  invariants: Object.freeze({
    proposalOnly: true,
    totalScoreFields: 0,
    deterministicOutageFallback: true,
    missingBusinessImpactExplicit: true,
    acceptedValuesSeparateFromAssessment: true,
    exactHumanDecision: true,
    approvalV1Readable: true,
    approvalV2SafeScopeWitness: true,
    selfOrServiceApprovalAccepted: false,
    jiraPriorityDueAssignmentMutationsFromControls: 0,
    mutuallyExclusiveQueueControlEvents: true,
  }),
  scenarios,
  results,
});
mkdirSync(dirname(reportPath), { recursive: true });
const temporary = `${reportPath}.${process.pid}.tmp`;
writeFileSync(temporary, stringifyPortableJson(report, workspace), "utf8");
renameSync(temporary, reportPath);
console.log(
  `[verify:006:us3] ${report.status}; scenarios=${scenarios.length}/8; report: ${reportPath}`,
);
if (failed) process.exitCode = 1;
