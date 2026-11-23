import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  gitLabUs2ScenarioCatalog,
  type GitLabUs2ScenarioName,
  gitLabUs2ScenarioNames,
  validateGitLabUs2ScenarioCatalog,
} from "../local/gitlab-scenario-catalog.mts";
import { stringifyPortableJson } from "./portable-json.mts";

interface Stage {
  readonly id: string;
  readonly description: string;
  readonly args: readonly string[];
}

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/005-gitlab-automated-validation/us2.json");
const flags = new Set(process.argv.slice(2).filter((value) => value !== "--"));
const unknown = [...flags].filter((flag) => flag !== "--plan");
if (unknown.length > 0) throw new Error(`Unknown Feature 005 US2 arguments: ${unknown.join(", ")}`);

const vitest = "node_modules/vitest/vitest.mjs";
const tsc = "node_modules/typescript/bin/tsc";
const stages: readonly Stage[] = Object.freeze([
  {
    id: "foundation",
    description: "Current Feature 005 foundation remains green",
    args: ["tools/verification/005-foundation-checkpoint.mts"],
  },
  {
    id: "scenario-catalog",
    description: "Exactly seven documented US2 scenarios are registered",
    args: ["tools/local/gitlab-scenario-catalog.mts", "--check"],
  },
  {
    id: "contracts",
    description: "Closed launch/status schema and Profile-only trigger/lookup mapping",
    args: [
      vitest,
      "run",
      "tests/contract/005/us2-trigger-contract.spec.ts",
      "tests/contract/005/us2-gitlab-trigger-conformance.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "domain",
    description: "Immutable Attempt identity, confirmation commitments and status rules",
    args: [
      vitest,
      "run",
      "packages/competency-qa/src/domain/automation-attempt.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "migrations",
    description: "QA 2055 uniqueness, shared child, append-only status and atomic references",
    args: [
      vitest,
      "run",
      "tests/integration/migrations/005-qa-automation-execution.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "launch-boundary",
    description: "Human confirmation, actor-independent replay and zero-write denials",
    args: [
      vitest,
      "run",
      "tests/integration/005/us2-launch-idempotency.spec.ts",
      "tests/integration/security/005/us2-launch-boundary.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "worker-reconciliation",
    description:
      "Concurrent delivery, worker restart, durable marker and bounded lookup-only recovery",
    args: [
      vitest,
      "run",
      "tests/integration/005/us2-trigger-once.spec.ts",
      "tests/integration/005/us2-trigger-reconciliation.spec.ts",
      "tests/integration/005/mock-hub-gitlab.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "full-process",
    description: "API replay plus real HTTP Mock Hub timeout-after-effect with one POST/pipeline",
    args: [vitest, "run", "tests/e2e/005-us2-trigger-once.spec.ts", "--maxWorkers=1"],
  },
  {
    id: "typecheck-connector",
    description: "GitLab adapter static typecheck",
    args: [tsc, "-p", "packages/connector-gitlab/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-effect-store",
    description: "GitLab effect persistence static typecheck",
    args: [tsc, "-p", "packages/connector-gitlab-persistence-typeorm/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-qa",
    description: "QA domain, persistence and executor UI static typecheck",
    args: [tsc, "-p", "packages/competency-qa/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-runtime",
    description: "Durable GitLab worker/query composition static typecheck",
    args: [tsc, "-p", "packages/runtime-composition/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-api",
    description: "Automation launch/query API static typecheck",
    args: [tsc, "-p", "apps/api/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-worker",
    description: "Worker process composition static typecheck",
    args: [tsc, "-p", "apps/worker/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-mock-hub",
    description: "Stateful GitLab Mock Hub static typecheck",
    args: [tsc, "-p", "apps/mock-hub/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-web",
    description: "Automated Session executor route static typecheck",
    args: [tsc, "-p", "apps/web/tsconfig.json", "--noEmit"],
  },
  {
    id: "web-build",
    description: "Production web bundle includes the automated Session executor",
    args: ["node_modules/vite/bin/vite.js", "build", "--config", "apps/web/vite.config.ts"],
  },
]);

if (flags.has("--plan")) {
  console.table(
    stages.map(({ id, description, args }) => ({
      id,
      description,
      command: [process.execPath, ...args].join(" "),
    })),
  );
  process.exit(0);
}

validateGitLabUs2ScenarioCatalog();
const digest = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const startedAt = new Date();
const results: Array<
  Readonly<{
    id: string;
    description: string;
    status: "PASS" | "FAIL" | "SKIP";
    exitCode?: number;
    durationMs: number;
    outputHash?: `sha256:${string}`;
  }>
> = [];
let failed = false;
for (const stage of stages) {
  if (failed) {
    results.push(
      Object.freeze({
        id: stage.id,
        description: stage.description,
        status: "SKIP",
        durationMs: 0,
      }),
    );
    continue;
  }
  console.log(`\n[verify:005:us2] ${stage.id}: ${stage.description}`);
  const started = Date.now();
  const result = spawnSync(process.execPath, [...stage.args], {
    cwd: workspace,
    env: { ...process.env, CI: "true" },
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const exitCode = result.status ?? 1;
  failed = exitCode !== 0;
  if (failed) process.stderr.write(output);
  results.push(
    Object.freeze({
      id: stage.id,
      description: stage.description,
      status: failed ? "FAIL" : "PASS",
      exitCode,
      durationMs: Date.now() - started,
      outputHash: digest(output),
    }),
  );
}

const passed = (id: string) => results.find((stage) => stage.id === id)?.status === "PASS";
const behaviorStage: Readonly<Record<GitLabUs2ScenarioName, string>> = Object.freeze({
  "us2-trigger-once": "full-process",
  "us2-command-replay": "full-process",
  "us2-stale-confirmation": "launch-boundary",
  "us2-mismatched-confirmation": "launch-boundary",
  "us2-timeout-after-trigger": "full-process",
  "us2-lookup-zero": "worker-reconciliation",
  "us2-lookup-multiple": "worker-reconciliation",
});
const scenarios = gitLabUs2ScenarioNames.map((id) => {
  const expected = gitLabUs2ScenarioCatalog[id];
  const stage = behaviorStage[id];
  const status =
    passed("scenario-catalog") && passed(stage) && passed("full-process") ? "PASS" : "FAIL";
  return Object.freeze({
    id,
    status,
    expected,
    scenarioPersistenceEvidence: "tests/e2e/005-us2-trigger-once.spec.ts",
    behaviorEvidence:
      stage === "full-process"
        ? "tests/e2e/005-us2-trigger-once.spec.ts"
        : stage === "launch-boundary"
          ? "tests/integration/security/005/us2-launch-boundary.spec.ts"
          : "tests/integration/005/us2-trigger-reconciliation.spec.ts",
    durableEvidence: expected.expectedLaunchAccepted
      ? Object.freeze({
          requestClaims: 1,
          effects: 1,
          maximumTriggerPosts: 1,
          maximumProviderPipelines: 1,
        })
      : Object.freeze({ requestClaims: 0, effects: 0, triggerPosts: 0, providerPipelines: 0 }),
  });
});
const sourcePaths = Object.freeze([
  "apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts",
  "apps/mock-hub/src/gitlab/api/gitlab.controller.ts",
  "apps/mock-hub/src/gitlab/scenarios/gitlab-scenarios.ts",
  "apps/mock-hub/src/gitlab/state/gitlab.repository.ts",
  "apps/web/src/routes/qa/automated-session.tsx",
  "packages/competency-qa/src/application/trigger-automation.ts",
  "packages/competency-qa/src/domain/automation-attempt.ts",
  "packages/competency-qa/src/persistence/automation-execution.repository.ts",
  "packages/competency-qa/src/ui/automated-session-executor.tsx",
  "packages/connector-gitlab/src/pipeline/gitlab-pipeline-trigger.ts",
  "packages/connector-gitlab/src/reconciliation/gitlab-trigger-reconciliation.ts",
  "packages/connector-gitlab-persistence-typeorm/src/repositories/gitlab-effect.repository.ts",
  "packages/runtime-composition/src/gitlab/automation-attempt-query.ts",
  "packages/runtime-composition/src/gitlab/automation-launch-service.ts",
  "packages/runtime-composition/src/gitlab/automation-worker-authority.ts",
  "packages/runtime-composition/src/gitlab/automation-worker.ts",
  "tests/e2e/005-us2-trigger-once.spec.ts",
  "tests/integration/005/us2-trigger-once.spec.ts",
  "tests/integration/005/us2-trigger-reconciliation.spec.ts",
  "tests/integration/security/005/us2-launch-boundary.spec.ts",
  "tools/local/gitlab-scenario-catalog.mts",
  "tools/local/gitlab-scenario.mts",
]);
const sourceBinding = sourcePaths.map((path) =>
  Object.freeze({ path, sha256: digest(readFileSync(resolve(workspace, path))) }),
);
const status =
  !failed && scenarios.every((scenario) => scenario.status === "PASS") ? "PASS" : "FAIL";
const report = Object.freeze({
  schemaVersion: 1,
  feature: "005-gitlab-automated-validation",
  gate: "feature-005-us2",
  contour: "qa-jira-gitlab-local",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status,
  sourceBinding: Object.freeze({
    files: sourceBinding,
    aggregateSha256: digest(JSON.stringify(sourceBinding)),
  }),
  scenarios,
  invariants: Object.freeze({
    launchAuthority: "EXACT_SERVER_CONFIRMATION_PLUS_CURRENT_ETAG",
    requestUniqueness: "WORKSPACE_PROJECT_SESSION_REQUEST_KEY_ACTOR_INDEPENDENT",
    coreAuthority: "POSTGRESQL_COMMAND_AND_OUTBOX",
    deliveryAuthority: "POSTGRESQL",
    effectMarkerPersistedBeforePost: true,
    postMarkerRecovery: "LOOKUP_ONLY",
    exactOneReceiptRequired: true,
    ambiguityVisible: true,
    maximumProviderTriggerPostsPerEffect: 1,
    inlineApiProviderCalls: 0,
    secondApprovalRequired: false,
  }),
  stages: results,
});
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(
  `[verify:005:us2] ${status}; ${scenarios.filter((scenario) => scenario.status === "PASS").length}/7 scenarios; report: ${reportPath}`,
);
if (status !== "PASS") process.exitCode = 1;
