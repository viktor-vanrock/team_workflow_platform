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
const reportPath = resolve(workspace, "reports/006-queue-triage-capacity-sla/us5.json");
const vitest = "node_modules/vitest/vitest.mjs";
const tsc = "node_modules/typescript/bin/tsc";
const stages: readonly Stage[] = Object.freeze([
  Object.freeze({
    id: "us5-contract-unit-security-integration-browser",
    description:
      "Confirmed starts, rollout, calendar arithmetic, immutable clocks, policy modes, notifications, degradation, authorized reads and SLA UI",
    args: Object.freeze([
      vitest,
      "run",
      "tests/unit/006/business-calendar.spec.ts",
      "tests/unit/006/sla-clock.spec.ts",
      "tests/contract/006/us5-sla-contracts.spec.ts",
      "tests/contract/006/us5-sla-events.spec.ts",
      "tests/integration/006/us5-rollout-verification.spec.ts",
      "tests/integration/006/us5-sla-persistence.spec.ts",
      "tests/integration/006/us5-policy-modes.spec.ts",
      "tests/integration/006/us5-temporal-notifications.spec.ts",
      "tests/integration/006/us5-sla-lifecycle.spec.ts",
      "tests/integration/006/us5-degradation.spec.ts",
      "tests/integration/security/006/us5-sla-read.spec.ts",
      "tests/e2e/006/us5-sla-transparency.spec.ts",
      "--maxWorkers=1",
    ]),
  }),
  ...[
    "packages/platform-contracts/tsconfig.json",
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
const us5Catalog = queueScenarioCatalog.filter(({ id }) => id.startsWith("us5-"));
const scenarios = await Promise.all(
  us5Catalog.map(({ id }) => runQueueScenario(id, { mode: "TEST" })),
);
const failed =
  results.some(({ status }) => status !== "PASS") ||
  scenarios.some(({ status }) => status !== "PASS") ||
  scenarios.length !== 12;
const taskPath = "specs/006-queue-triage-capacity-sla/tasks.md";
const report = Object.freeze({
  schemaVersion: 1,
  feature: "006-queue-triage-capacity-sla",
  checkpoint: "US5",
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
    closedGoals: Object.freeze(["READY_TO_FIRST_QA_START", "READY_TO_SIGNED_VERDICT"]),
    localDorStartsClock: false,
    confirmedJiraOrRolloutVerificationRequired: true,
    rolloutBackdatingAllowed: false,
    policyAndCalendarRevisionPinned: true,
    historicalReinterpretationAllowed: false,
    unknownPauseReasonPausesClock: false,
    measureOnlyTargetState: "NOT_CONFIGURED",
    durablePostgresTemporalAuthority: true,
    pageReadWrites: 0,
    providerOrModelReadsOnSlaGet: 0,
    notificationPurpose: "REQUEST_STATUS",
    notificationIntentDeliveryCoupledToClock: false,
    clockRevisionChangesOnRead: false,
    evaluationHashChangesWithAsOf: true,
    jiraPriorityOrDueMutations: 0,
    exactProvenanceVisible: true,
  }),
  scenarios,
  results,
});
mkdirSync(dirname(reportPath), { recursive: true });
const temporary = `${reportPath}.${process.pid}.tmp`;
writeFileSync(temporary, stringifyPortableJson(report, workspace), "utf8");
renameSync(temporary, reportPath);
console.log(
  `[verify:006:us5] ${report.status}; scenarios=${scenarios.length}/12; report: ${reportPath}`,
);
if (failed) process.exitCode = 1;
