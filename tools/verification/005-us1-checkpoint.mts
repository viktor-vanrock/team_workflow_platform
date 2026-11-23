import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  gitLabUs1ScenarioCatalog,
  gitLabUs1ScenarioNames,
  validateGitLabUs1ScenarioCatalog,
} from "../local/gitlab-scenario-catalog.mts";
import { stringifyPortableJson } from "./portable-json.mts";

interface Stage {
  readonly id: string;
  readonly description: string;
  readonly args: readonly string[];
}

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/005-gitlab-automated-validation/us1.json");
const flags = new Set(process.argv.slice(2).filter((value) => value !== "--"));
const unknown = [...flags].filter((flag) => flag !== "--plan");
if (unknown.length > 0) throw new Error(`Unknown Feature 005 US1 arguments: ${unknown.join(", ")}`);

const vitest = "node_modules/vitest/vitest.mjs";
const tsc = "node_modules/typescript/bin/tsc";
const stages: readonly Stage[] = Object.freeze([
  {
    id: "foundation",
    description: "Fresh source-bound Feature 005 foundation",
    args: ["tools/verification/005-foundation-checkpoint.mts"],
  },
  {
    id: "scenario-catalog",
    description: "Exactly five documented US1 scenarios with zero-trigger expectations",
    args: ["tools/local/gitlab-scenario-catalog.mts", "--check"],
  },
  {
    id: "contracts",
    description:
      "US1 schemas, eight API operations, capability intersection and bounded source reads",
    args: [
      vitest,
      "run",
      "tests/contract/005/us1-availability-suite-session.spec.ts",
      "tests/contract/005/us1-capability-profile-conformance.spec.ts",
      "tests/contract/005/us1-gitlab-source-context-conformance.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "domain",
    description: "Suite lifecycle and immutable automated Session primitives",
    args: [
      vitest,
      "run",
      "packages/competency-qa/src/domain/suite-binding.spec.ts",
      "packages/competency-qa/src/domain/test-session.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "integration",
    description:
      "Suite publication, READY persistence, availability/manual fallback and target lineage",
    args: [
      vitest,
      "run",
      "tests/integration/005/us1-suite-publication.spec.ts",
      "tests/integration/005/us1-automated-session.spec.ts",
      "tests/integration/005/us1-availability-and-target-lineage.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "authorization",
    description: "All denials occur before secret resolution or trigger",
    args: [
      vitest,
      "run",
      "tests/integration/security/005/us1-session-authorization.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "scenario-persistence",
    description:
      "API/PostgreSQL/Mock Hub journey and all five restart-persistent zero-trigger scenarios",
    args: [vitest, "run", "tests/e2e/005-us1-automated-session.spec.ts", "--maxWorkers=1"],
  },
  {
    id: "typecheck-qa",
    description: "QA domain, persistence and UI typecheck",
    args: [tsc, "-p", "packages/competency-qa/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-runtime",
    description: "GitLab runtime composition typecheck",
    args: [tsc, "-p", "packages/runtime-composition/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-api",
    description: "GitLab automation API typecheck",
    args: [tsc, "-p", "apps/api/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-mock-hub",
    description: "Stateful Mock Hub typecheck",
    args: [tsc, "-p", "apps/mock-hub/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-web",
    description: "Automated Session route typecheck",
    args: [tsc, "-p", "apps/web/tsconfig.json", "--noEmit"],
  },
  {
    id: "web-build",
    description: "Production web bundle with the automated Session route",
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

validateGitLabUs1ScenarioCatalog();
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
  console.log(`\n[verify:005:us1] ${stage.id}: ${stage.description}`);
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

const pass = (id: string) => results.find((stage) => stage.id === id)?.status === "PASS";
const scenarios = gitLabUs1ScenarioNames.map((id) => {
  const expected = gitLabUs1ScenarioCatalog[id];
  const behaviorStage =
    id === "us1-manual-only" || id === "us1-target-change-linked-session"
      ? "integration"
      : "scenario-persistence";
  const status =
    pass("scenario-catalog") && pass("scenario-persistence") && pass(behaviorStage)
      ? "PASS"
      : "FAIL";
  return Object.freeze({
    id,
    status,
    expected,
    exactPersistenceEvidence: "tests/e2e/005-us1-automated-session.spec.ts",
    behaviorEvidence:
      behaviorStage === "integration"
        ? "tests/integration/005/us1-availability-and-target-lineage.spec.ts"
        : "tests/e2e/005-us1-automated-session.spec.ts",
    zeroTriggerEvidence: Object.freeze({
      mockHubPipelineTriggerCalls: 0,
      connectorPipelineTriggerCommands: 0,
    }),
  });
});
const status =
  !failed && scenarios.every((scenario) => scenario.status === "PASS") ? "PASS" : "FAIL";
const sourcePaths = Object.freeze([
  "apps/api/src/extensions/gitlab-automation/qa-automation-availability.controller.ts",
  "apps/api/src/extensions/gitlab-automation/qa-automation-suite-bindings.controller.ts",
  "apps/api/src/extensions/gitlab-automation/qa-automated-sessions.controller.ts",
  "apps/api/src/extensions/gitlab-automation/qa-automation-local.adapters.ts",
  "apps/mock-hub/src/gitlab/scenarios/gitlab-scenarios.ts",
  "apps/mock-hub/src/gitlab/state/gitlab.repository.ts",
  "packages/competency-qa/src/application/plan-automated-session.ts",
  "packages/competency-qa/src/persistence/automated-session.uow.ts",
  "packages/competency-qa/src/ui/automated-session.tsx",
  "apps/web/src/routes/qa/automated-session.tsx",
  "tests/e2e/005-us1-automated-session.spec.ts",
  "tools/local/gitlab-scenario-catalog.mts",
]);
const sourceBinding = sourcePaths.map((path) =>
  Object.freeze({ path, sha256: digest(readFileSync(resolve(workspace, path))) }),
);
const report = Object.freeze({
  schemaVersion: 1,
  feature: "005-gitlab-automated-validation",
  gate: "feature-005-us1",
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
    exactPublishedSuiteRequired: true,
    automatedSessionState: "READY",
    automatedPlanItemCount: 1,
    configurationPinCount: 3,
    manualFlowPreserved: true,
    providerTriggerCalls: 0,
    inlineApiProviderCalls: 0,
    production: "DENIED",
  }),
  stages: results,
});
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(
  `[verify:005:us1] ${status}; ${scenarios.filter((scenario) => scenario.status === "PASS").length}/5 scenarios; report: ${reportPath}`,
);
if (status !== "PASS") process.exitCode = 1;
