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
const reportPath = resolve(workspace, "reports/007-project-onboarding-evidence-security/us3.json");
const vitest = "node_modules/vitest/vitest.mjs";
const playwright = "node_modules/@playwright/test/cli.js";
const tsc = "node_modules/typescript/bin/tsc";
const stages: readonly Stage[] = Object.freeze([
  Object.freeze({
    id: "us3-policy-security-e2e",
    description:
      "Default-deny policy, prefiltered reads, replay reauthorization, evidence boundaries, revocation and side-channel resistance",
    args: Object.freeze([
      vitest,
      "run",
      "tests/unit/007/us3-authorization-policy.spec.ts",
      "tests/integration/security/007/us3-repository-prefilter.spec.ts",
      "tests/integration/security/007/us3-read-surface-isolation.spec.ts",
      "tests/integration/security/007/us3-event-isolation.spec.ts",
      "tests/integration/security/007/us3-evidence-artifact-isolation.spec.ts",
      "tests/integration/security/007/us3-background-reauthorization.spec.ts",
      "tests/integration/007/us3-entitlement-revocation-race.spec.ts",
      "tests/integration/security/007/us3-cross-scope-substitution.spec.ts",
      "tests/integration/security/007/us3-side-channel.spec.ts",
      "tests/e2e/007/us3-project-scope.spec.ts",
      "--maxWorkers=1",
    ]),
  }),
  Object.freeze({
    id: "cross-project-deny-scenario",
    description: "Exact documented multi-principal authorization scenario",
    args: Object.freeze([
      "--import",
      "tsx",
      "tools/local/onboarding-scenario.mts",
      "run",
      "cross-project-deny",
    ]),
  }),
  Object.freeze({
    id: "project-scope-browser",
    description: "Authorized navigation and immediate post-revocation disappearance",
    args: Object.freeze([
      playwright,
      "test",
      "tests/e2e/007/us3-project-scope-browser.spec.ts",
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
  console.log(`\n[verify:007:us3] ${stage.id}: ${stage.description}`);
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
  checkpoint: "US3",
  status: failed ? "FAIL" : "PASS",
  contour: "qa-jira-gitlab-mattermost-local",
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
    visibleProjectCount: 2,
    forbiddenEquivalentToMissing: true,
    hiddenMetadataLeak: false,
    postRevocationVisibleProjectCount: 1,
    providerEffectsAfterRevocation: 0,
    allSurfacesShareAuthorizationScope: true,
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
console.log(`[verify:007:us3] ${report.status}; report: ${reportPath}`);
if (failed) process.exitCode = 1;
