import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

interface Stage {
  readonly id: string;
  readonly description: string;
  readonly command: string;
  readonly args: readonly string[];
}

interface StageResult extends Stage {
  readonly status: "PASS" | "FAIL" | "SKIP";
  readonly exitCode?: number;
  readonly durationMs: number;
}

interface Group {
  readonly id: "contracts" | "architecture" | "unit-matrices";
  readonly reportName: "contracts.json" | "architecture.json" | "unit-matrices.json";
  readonly stages: readonly Stage[];
}

const workspace = resolve(import.meta.dirname, "../..");
const reportDirectory = resolve(workspace, "reports/006-queue-triage-capacity-sla");
const flags = new Set(process.argv.slice(2).filter((value) => value !== "--"));
const unknown = [...flags].filter((flag) => flag !== "--plan");
if (unknown.length > 0)
  throw new Error(`Unknown Feature 006 foundation arguments: ${unknown.join(", ")}`);

const node = process.execPath;
const vitest = "node_modules/vitest/vitest.mjs";
const tsc = "node_modules/typescript/bin/tsc";
const groups: readonly Group[] = Object.freeze([
  Object.freeze({
    id: "contracts",
    reportName: "contracts.json",
    stages: Object.freeze([
      {
        id: "registry-check",
        description: "Generated schema registry remains deterministic",
        command: node,
        args: ["tools/contracts/build-registry.mts", "--check"],
      },
      {
        id: "openapi-check",
        description: "Generated OpenAPI snapshots remain deterministic",
        command: node,
        args: ["tools/contracts/build-openapi-snapshots.mts", "--check"],
      },
      {
        id: "contract-tests",
        description: "Feature 006 contracts, compatibility and event binding",
        command: node,
        args: [vitest, "run", "tests/contract/006", "--maxWorkers=1"],
      },
    ]),
  }),
  Object.freeze({
    id: "architecture",
    reportName: "architecture.json",
    stages: Object.freeze([
      {
        id: "architecture-tests",
        description: "Ownership boundaries and static runtime wiring",
        command: node,
        args: [
          vitest,
          "run",
          "tests/architecture/006-queue-boundaries.spec.ts",
          "tests/architecture/006-runtime-wiring.spec.ts",
          "--maxWorkers=1",
        ],
      },
      ...[
        "packages/platform-contracts/tsconfig.json",
        "packages/platform-core/tsconfig.json",
        "packages/platform-persistence-typeorm/tsconfig.json",
        "packages/platform-runtime-nest/tsconfig.json",
        "packages/competency-qa/tsconfig.json",
        "packages/runtime-composition/tsconfig.json",
        "apps/api/tsconfig.json",
        "apps/worker/tsconfig.json",
        "apps/web/tsconfig.json",
      ].map((project): Stage => ({
        id: `typecheck-${project.replace(/\/tsconfig\.json$/u, "").replaceAll("/", "-")}`,
        description: `Static typecheck ${project}`,
        command: node,
        args: [tsc, "-p", project, "--noEmit"],
      })),
    ]),
  }),
  Object.freeze({
    id: "unit-matrices",
    reportName: "unit-matrices.json",
    stages: Object.freeze([
      {
        id: "unit",
        description: "Authorization, scope hash, policy and Approval v2 matrices",
        command: node,
        args: [vitest, "run", "tests/unit/006", "--maxWorkers=1"],
      },
      {
        id: "migration-registry",
        description: "Core/QA ownership and entity parity",
        command: node,
        args: [
          vitest,
          "run",
          "tests/integration/migrations/006-migration-registry.spec.ts",
          "--maxWorkers=1",
        ],
      },
      {
        id: "postgres-matrix",
        description: "PostgreSQL 17/18 fresh, upgrade, repeat and rollback matrix",
        command: node,
        args: [
          vitest,
          "run",
          "tests/integration/migrations/006-queue-foundation.spec.ts",
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
        command: [stage.command, ...stage.args].join(" "),
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
    console.log(`\n[verify:006:foundation] ${group.id}/${stage.id}: ${stage.description}`);
    const stageStartedAt = Date.now();
    const result = spawnSync(stage.command, [...stage.args], {
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
const taskPath = "specs/006-queue-triage-capacity-sla/tasks.md";
const common = Object.freeze({
  schemaVersion: 1,
  feature: "006-queue-triage-capacity-sla",
  contour: "qa-jira-gitlab-mattermost-local",
  production: "DENIED",
  externalNetwork: "DENIED",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  runtime: Object.freeze({ node: process.version, postgres: Object.freeze(["17.7", "18.6"]) }),
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
      gate: `feature-006-foundation-${group.id}`,
      status,
      stages: results,
    }),
  );
}
reports.set(
  "foundation.json",
  Object.freeze({
    ...common,
    gate: "feature-006-foundation",
    status: failed ? "FAIL" : "PASS",
    invariants: Object.freeze({
      immutablePublishedContracts: true,
      approvalV1Compatibility: true,
      qaManifestV12Compatibility: true,
      repositoryScopeRequired: true,
      dynamicLoading: false,
      deliveryAuthority: "POSTGRESQL",
    }),
    reports: Object.freeze(
      groupResults.map(({ group, status }) => Object.freeze({ path: group.reportName, status })),
    ),
  }),
);

mkdirSync(dirname(resolve(reportDirectory, "foundation.json")), { recursive: true });
const pending: Array<Readonly<{ temporary: string; destination: string }>> = [];
for (const [name, report] of reports) {
  const destination = resolve(reportDirectory, name);
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, stringifyPortableJson(report, workspace), "utf8");
  pending.push(Object.freeze({ temporary, destination }));
}
for (const { temporary, destination } of pending) renameSync(temporary, destination);
console.log(`[verify:006:foundation] ${failed ? "FAIL" : "PASS"}; reports: ${reportDirectory}`);
if (failed) process.exitCode = 1;
