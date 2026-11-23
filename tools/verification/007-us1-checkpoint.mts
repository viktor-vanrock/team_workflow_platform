import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

interface Stage {
  readonly id: string;
  readonly description: string;
  readonly args: readonly string[];
}

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/007-project-onboarding-evidence-security/us1.json");
const vitest = "node_modules/vitest/vitest.mjs";
const playwright = "node_modules/@playwright/test/cli.js";
const tsc = "node_modules/typescript/bin/tsc";
const stages: readonly Stage[] = Object.freeze([
  Object.freeze({
    id: "us1-contract-unit-integration-e2e",
    description:
      "Manual-only registration, resources, Binding, capability mode, Session guard and in-process journey",
    args: Object.freeze([
      vitest,
      "run",
      "tests/unit/007/us1-project-onboarding.spec.ts",
      "tests/unit/007/us1-capability-mode.spec.ts",
      "tests/contract/007/us1-project-api.spec.ts",
      "tests/integration/007/us1-entitlement-uow.spec.ts",
      "tests/integration/007/us1-project-resources.spec.ts",
      "tests/integration/007/us1-account-leases.spec.ts",
      "tests/integration/007/us1-manual-binding.spec.ts",
      "tests/integration/007/us1-session-mode-guards.spec.ts",
      "tests/e2e/007/us1-manual-onboarding.spec.ts",
      "tests/e2e/007/us1-manual-onboarding-ui.spec.ts",
      "--maxWorkers=1",
    ]),
  }),
  Object.freeze({
    id: "manual-only-scenario",
    description: "Exact documented CLI scenario",
    args: Object.freeze([
      "--import",
      "tsx",
      "tools/local/onboarding-scenario.mts",
      "run",
      "manual-only-onboarding",
    ]),
  }),
  Object.freeze({
    id: "authorized-browser",
    description: "Integration Administrator and QA Lead onboarding workspace",
    args: Object.freeze([
      playwright,
      "test",
      "tests/e2e/007/us1-manual-onboarding-browser.spec.ts",
      "--project=chromium",
      "--workers=1",
    ]),
  }),
  ...[
    "packages/platform-core/tsconfig.json",
    "packages/platform-persistence-typeorm/tsconfig.json",
    "packages/competency-qa/tsconfig.json",
    "packages/runtime-composition/tsconfig.json",
    "packages/platform-runtime-nest/tsconfig.json",
    "apps/api/tsconfig.json",
    "apps/worker/tsconfig.json",
    "apps/web/tsconfig.json",
  ].map((project): Stage =>
    Object.freeze({
      id: `typecheck-${project.replace(/\/tsconfig\.json$/u, "").replaceAll("/", "-")}`,
      description: `Static typecheck ${project}`,
      args: Object.freeze([tsc, "-p", project, "--noEmit"]),
    }),
  ),
]);

if (process.argv.includes("--plan")) {
  console.table(
    stages.map((stage) => ({
      id: stage.id,
      description: stage.description,
      command: [process.execPath, ...stage.args].join(" "),
    })),
  );
  process.exit(0);
}

const startedAt = new Date();
const results: Array<
  Readonly<
    Stage & {
      status: "PASS" | "FAIL" | "SKIP";
      exitCode?: number;
      durationMs: number;
      outputHash?: string;
    }
  >
> = [];
let failed = false;
for (const stage of stages) {
  if (failed) {
    results.push(Object.freeze({ ...stage, status: "SKIP", durationMs: 0 }));
    continue;
  }
  console.log(`\n[verify:007:us1] ${stage.id}: ${stage.description}`);
  const stageStartedAt = Date.now();
  const result = spawnSync(process.execPath, [...stage.args], {
    cwd: workspace,
    env: { ...process.env, CI: "true" },
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  const exitCode = result.status ?? 1;
  failed = exitCode !== 0;
  results.push(
    Object.freeze({
      ...stage,
      status: failed ? "FAIL" : "PASS",
      exitCode,
      durationMs: Date.now() - stageStartedAt,
      outputHash: `sha256:${createHash("sha256").update(`${result.stdout}\n${result.stderr}`).digest("hex")}`,
    }),
  );
}

const taskPath = "specs/007-project-onboarding-evidence-security/tasks.md";
const report = Object.freeze({
  schemaVersion: 1,
  feature: "007-project-onboarding-evidence-security",
  checkpoint: "US1",
  status: failed ? "FAIL" : "PASS",
  contour: "qa-jira-mattermost-local",
  production: "DENIED",
  externalNetwork: "DENIED",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  taskBinding: Object.freeze({
    path: taskPath,
    sha256: `sha256:${createHash("sha256")
      .update(readFileSync(resolve(workspace, taskPath)))
      .digest("hex")}`,
  }),
  invariants: Object.freeze({
    stage: "SHADOW",
    capabilityMode: "MANUAL_ONLY",
    operationalState: "ACTIVE",
    manualSessionAllowed: true,
    automatedSessionDenied: true,
    exactConfigurationRefs: true,
    auditAndOutbox: true,
    replayDedupe: true,
  }),
  results: Object.freeze(results),
});
mkdirSync(dirname(reportPath), { recursive: true });
const temporary = `${reportPath}.${process.pid}.tmp`;
writeFileSync(temporary, stringifyPortableJson(report, workspace), {
  encoding: "utf8",
  mode: 0o600,
});
renameSync(temporary, reportPath);
console.log(`[verify:007:us1] ${report.status}; report: ${reportPath}`);
if (failed) process.exitCode = 1;
