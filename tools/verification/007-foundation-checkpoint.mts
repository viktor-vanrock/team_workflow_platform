import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

type GroupId = "contracts" | "architecture" | "unit-matrices";

interface Stage {
  readonly id: string;
  readonly description: string;
  readonly args: readonly string[];
}

interface StageResult extends Stage {
  readonly status: "PASS" | "FAIL" | "SKIP";
  readonly exitCode?: number;
  readonly durationMs: number;
}

interface Group {
  readonly id: GroupId;
  readonly reportName: `${GroupId}.json`;
  readonly stages: readonly Stage[];
}

const workspace = resolve(import.meta.dirname, "../..");
const reportDirectory = resolve(workspace, "reports/007-project-onboarding-evidence-security");
const flags = new Set(process.argv.slice(2).filter((value) => value !== "--"));
const unknown = [...flags].filter((flag) => flag !== "--plan");
if (unknown.length > 0)
  throw new Error(`Unknown Feature 007 foundation arguments: ${unknown.join(", ")}`);

const node = process.execPath;
const vitest = "node_modules/vitest/vitest.mjs";
const tsc = "node_modules/typescript/bin/tsc";
const groups: readonly Group[] = Object.freeze([
  Object.freeze({
    id: "contracts",
    reportName: "contracts.json",
    stages: Object.freeze([
      {
        id: "strict-contracts",
        description: "Strict JSON Schema, OpenAPI, AsyncAPI, example and digest verification",
        args: ["tools/contracts/verify-007-contracts.mts"],
      },
      {
        id: "registry-check",
        description: "Generated schema registry is deterministic",
        args: ["tools/contracts/build-registry.mts", "--check"],
      },
      {
        id: "openapi-check",
        description: "Generated API and Mock Hub snapshots are deterministic",
        args: ["tools/contracts/build-openapi-snapshots.mts", "--check"],
      },
      {
        id: "contract-tests",
        description: "Feature 007 compatibility, exact-action, crypto and event contract vectors",
        args: [vitest, "run", "tests/contract/007", "--maxWorkers=1"],
      },
    ]),
  }),
  Object.freeze({
    id: "architecture",
    reportName: "architecture.json",
    stages: Object.freeze([
      {
        id: "architecture-tests",
        description: "Ownership boundaries and static API/worker onboarding composition",
        args: [vitest, "run", "tests/architecture/007", "--maxWorkers=1"],
      },
      ...[
        "packages/platform-contracts/tsconfig.json",
        "packages/platform-core/tsconfig.json",
        "packages/platform-persistence-typeorm/tsconfig.json",
        "packages/competency-qa/tsconfig.json",
        "packages/runtime-composition/tsconfig.json",
        "apps/api/tsconfig.json",
        "apps/worker/tsconfig.json",
      ].map((project): Stage => ({
        id: `typecheck-${project.replace(/\/tsconfig\.json$/u, "").replaceAll("/", "-")}`,
        description: `Static typecheck ${project}`,
        args: [tsc, "-p", project, "--noEmit"],
      })),
    ]),
  }),
  Object.freeze({
    id: "unit-matrices",
    reportName: "unit-matrices.json",
    stages: Object.freeze([
      {
        id: "migration-registry",
        description: "Core/QA owner range, collision and order verification",
        args: [
          vitest,
          "run",
          "tests/integration/migrations/007-migration-registry.spec.ts",
          "--maxWorkers=1",
        ],
      },
      {
        id: "migration-shapes",
        description: "Complete additive Core 0150/0155/0160 and QA 2080/2085 SQL shapes",
        args: [
          vitest,
          "run",
          "tests/integration/migrations/007-onboarding-foundation.spec.ts",
          "--maxWorkers=1",
        ],
      },
      {
        id: "scoped-persistence",
        description: "Composite Project scope and immutable repository chains",
        args: [
          vitest,
          "run",
          "tests/integration/007/scoped-foundation-persistence.spec.ts",
          "tests/integration/007/historical-bootstrap.spec.ts",
          "--maxWorkers=1",
        ],
      },
    ]),
  }),
]);

if (flags.has("--plan")) {
  console.table(
    groups.flatMap((group) =>
      group.stages.map((stage) => ({
        group: group.id,
        stage: stage.id,
        description: stage.description,
        command: [node, ...stage.args].join(" "),
      })),
    ),
  );
  process.exit(0);
}

const startedAt = new Date();
let failed = false;
const groupResults: Array<
  Readonly<{ group: Group; results: readonly StageResult[]; status: "PASS" | "FAIL" }>
> = [];
for (const group of groups) {
  const results: StageResult[] = [];
  for (const stage of group.stages) {
    if (failed) {
      results.push({ ...stage, status: "SKIP", durationMs: 0 });
      continue;
    }
    console.log(`\n[verify:007:foundation] ${group.id}/${stage.id}: ${stage.description}`);
    const stageStartedAt = Date.now();
    const result = spawnSync(node, [...stage.args], {
      cwd: workspace,
      env: { ...process.env, CI: "true" },
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    const exitCode = result.status ?? 1;
    failed = exitCode !== 0;
    results.push({
      ...stage,
      status: failed ? "FAIL" : "PASS",
      exitCode,
      durationMs: Date.now() - stageStartedAt,
    });
  }
  groupResults.push(
    Object.freeze({
      group,
      results: Object.freeze(results),
      status: results.every(({ status }) => status === "PASS") ? "PASS" : "FAIL",
    }),
  );
}

const digest = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const taskPath = "specs/007-project-onboarding-evidence-security/tasks.md";
const common = Object.freeze({
  schemaVersion: 1,
  feature: "007-project-onboarding-evidence-security",
  contour: "qa-jira-gitlab-mattermost-local",
  production: "DENIED",
  externalNetwork: "DENIED",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  runtime: Object.freeze({ node: process.version, postgresTargets: Object.freeze(["17", "18"]) }),
  taskBinding: Object.freeze({
    path: taskPath,
    sha256: digest(readFileSync(resolve(workspace, taskPath))),
  }),
});

const reports = new Map<string, unknown>();
for (const { group, results, status } of groupResults) {
  reports.set(
    group.reportName,
    Object.freeze({
      ...common,
      gate: `feature-007-foundation-${group.id}`,
      status,
      stages: results,
    }),
  );
}
reports.set(
  "foundation.json",
  Object.freeze({
    ...common,
    gate: "feature-007-foundation",
    status: failed ? "FAIL" : "PASS",
    invariants: Object.freeze({
      immutablePublishedContracts: true,
      bindingV1Compatibility: true,
      qaContextV1Compatibility: true,
      evidenceV1Compatibility: true,
      repositoryProjectScopeRequired: true,
      exactPlatformActionApproval: true,
      staticComposition: true,
      productionAuthority: "DENIED",
    }),
    reports: Object.freeze(
      groupResults.map(({ group, status }) => Object.freeze({ path: group.reportName, status })),
    ),
  }),
);

mkdirSync(reportDirectory, { recursive: true });
const pending: Array<Readonly<{ temporary: string; destination: string }>> = [];
for (const [name, report] of reports) {
  const destination = resolve(reportDirectory, name);
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, stringifyPortableJson(report, workspace), {
    encoding: "utf8",
    mode: 0o600,
  });
  pending.push(Object.freeze({ temporary, destination }));
}
for (const { temporary, destination } of pending) renameSync(temporary, destination);
console.log(`[verify:007:foundation] ${failed ? "FAIL" : "PASS"}; reports: ${reportDirectory}`);
if (failed) process.exitCode = 1;
