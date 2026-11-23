import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

interface Stage {
  readonly id: string;
  readonly description: string;
  readonly command: string;
  readonly args: readonly string[];
}

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/005-gitlab-automated-validation/foundation.json");
const flags = new Set(process.argv.slice(2).filter((value) => value !== "--"));
const unknown = [...flags].filter((flag) => flag !== "--plan");
if (unknown.length > 0)
  throw new Error(`Unknown Feature 005 foundation arguments: ${unknown.join(", ")}`);

const vitest = "node_modules/vitest/vitest.mjs";
const tsc = "node_modules/typescript/bin/tsc";
const stages: readonly Stage[] = Object.freeze([
  {
    id: "contracts",
    description: "Feature 005 design, connector and Mock GitLab contracts",
    command: process.execPath,
    args: [vitest, "run", "tests/contract/005", "--maxWorkers=1"],
  },
  {
    id: "architecture",
    description: "Pure adapter, persistence ownership and static composition boundaries",
    command: process.execPath,
    args: [
      vitest,
      "run",
      "tests/architecture/005-gitlab-boundaries.spec.ts",
      "tests/architecture/005-gitlab-runtime-wiring.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "unit",
    description: "QA automation primitives and PostgreSQL command ownership",
    command: process.execPath,
    args: [vitest, "run", "tests/unit/005", "--maxWorkers=1"],
  },
  {
    id: "integration-pure",
    description: "Profile lifecycle, routing and security without container state",
    command: process.execPath,
    args: [
      vitest,
      "run",
      "tests/integration/005/gitlab-profile-lifecycle.spec.ts",
      "tests/integration/005/worker-command-routing.spec.ts",
      "tests/integration/security/005",
      "--maxWorkers=1",
    ],
  },
  {
    id: "mock-hub",
    description: "Stateful Mock GitLab persistence and one-shot fault restart",
    command: process.execPath,
    args: [
      vitest,
      "run",
      "tests/contract/005/mock-hub-gitlab.spec.ts",
      "tests/integration/005/mock-hub-gitlab.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "runtime-seed",
    description: "Clean qa-jira-gitlab-local migrations and idempotent foundation seed",
    command: process.execPath,
    args: [
      vitest,
      "run",
      "tests/integration/005/local-composition-foundation.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "migrations",
    description: "QA, Connector and Mock Hub order/entity/upgrade evidence",
    command: process.execPath,
    args: [
      vitest,
      "run",
      "tests/integration/migrations/005-migration-registry.spec.ts",
      "tests/integration/migrations/005-gitlab-automation.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "typecheck-runtime",
    description: "Runtime composition static typecheck",
    command: process.execPath,
    args: [tsc, "-p", "packages/runtime-composition/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-api",
    description: "API static GitLab contour typecheck",
    command: process.execPath,
    args: [tsc, "-p", "apps/api/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-worker",
    description: "Worker static GitLab contour typecheck",
    command: process.execPath,
    args: [tsc, "-p", "apps/worker/tsconfig.json", "--noEmit"],
  },
  {
    id: "compose",
    description: "Closed local Docker Compose graph",
    command: "docker",
    args: ["compose", "--file", "infra/compose/docker-compose.local.yml", "config", "--quiet"],
  },
]);

if (flags.has("--plan")) {
  console.table(
    stages.map(({ id, description, command, args }) => ({
      id,
      description,
      command: [command, ...args].join(" "),
    })),
  );
  process.exit(0);
}

const digest = (bytes: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const sourceRoots = Object.freeze([
  "packages/competency-qa/src/domain",
  "packages/competency-qa/src/persistence",
  "packages/connector-gitlab/src",
  "packages/connector-gitlab-persistence-typeorm/src",
  "packages/runtime-composition/src/gitlab",
  "apps/mock-hub/src/gitlab",
  "tests/contract/005",
  "tests/unit/005",
  "tests/integration/005",
]);

function files(path: string): string[] {
  const absolute = resolve(workspace, path);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [path];
  return readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => files(relative(workspace, resolve(absolute, entry.name))))
    .filter((candidate) => /\.(?:ts|tsx|mts|json)$/u.test(candidate));
}

const sources = [...new Set(sourceRoots.flatMap(files))].sort().map((path) =>
  Object.freeze({
    path,
    sha256: digest(readFileSync(resolve(workspace, path))),
  }),
);
const taskPath = "specs/005-gitlab-automated-validation/tasks.md";
const composePath = "infra/compose/docker-compose.local.yml";
const startedAt = new Date();
const results: Array<
  Stage & Readonly<{ status: "PASS" | "FAIL" | "SKIP"; exitCode?: number; durationMs: number }>
> = [];
let failed = false;
for (const stage of stages) {
  if (failed) {
    results.push({ ...stage, status: "SKIP", durationMs: 0 });
    continue;
  }
  console.log(`\n[verify:005:foundation] ${stage.id}: ${stage.description}`);
  const started = Date.now();
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
    durationMs: Date.now() - started,
  });
}

const commandVersion = (command: string, args: readonly string[]): string => {
  try {
    return execFileSync(command, [...args], {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "UNAVAILABLE";
  }
};
const report = Object.freeze({
  schemaVersion: 1,
  feature: "005-gitlab-automated-validation",
  gate: "feature-005-foundation",
  contour: "qa-jira-gitlab-local",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  taskBinding: Object.freeze({
    path: taskPath,
    sha256: digest(readFileSync(resolve(workspace, taskPath))),
  }),
  sourceBinding: Object.freeze({
    files: sources,
    aggregateSha256: digest(JSON.stringify(sources)),
  }),
  runtimeBinding: Object.freeze({
    node: process.version,
    packageManager: JSON.parse(readFileSync(resolve(workspace, "package.json"), "utf8"))
      .packageManager,
    dockerCompose: commandVersion("docker", ["compose", "version", "--short"]),
    composePath,
    composeSha256: digest(readFileSync(resolve(workspace, composePath))),
    postgres: "17.7|18.6",
  }),
  invariants: Object.freeze({
    production: "DENIED",
    technicalResultMaySignVerdict: false,
    providerEffectStoryHandlers: "ABSENT_BY_DESIGN",
    deliveryAuthority: "POSTGRESQL",
  }),
  stages: results,
});
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(`[verify:005:foundation] ${report.status}; report: ${reportPath}`);
if (failed) process.exitCode = 1;
