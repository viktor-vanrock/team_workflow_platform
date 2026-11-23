import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

type JsonRecord = Record<string, unknown>;
const workspace = resolve(import.meta.dirname, "../..");
const feature = "007-project-onboarding-evidence-security";
const reportDirectory = resolve(workspace, `reports/${feature}`);
const reportPath = resolve(reportDirectory, "evidence.json");
const flags = new Set(process.argv.slice(2).filter((value) => value !== "--"));
const unknown = [...flags].filter((flag) => flag !== "--plan");
if (unknown.length > 0)
  throw new Error(`Unknown Feature 007 evidence arguments: ${unknown.join(", ")}`);

const childReportNames = Object.freeze([
  "compatibility.json",
  "prerequisites.json",
  "governance.json",
  "setup-gate.json",
  "contracts.json",
  "architecture.json",
  "unit-matrices.json",
  "foundation.json",
  "us1.json",
  "us2.json",
  "us3.json",
  "us4.json",
  "us5.json",
  "migrations-postgres-17.json",
  "migrations-postgres-18.json",
  "concurrency.json",
  "integration.json",
  "security.json",
  "recovery.json",
  "observability.json",
  "browser.json",
  "smoke.json",
  "quickstart.json",
  "traceability.json",
]);
const snapshotRoots = Object.freeze({
  source: Object.freeze([
    `specs/${feature}/spec.md`,
    `specs/${feature}/plan.md`,
    `specs/${feature}/research.md`,
    `specs/${feature}/data-model.md`,
    `specs/${feature}/quickstart.md`,
    `specs/${feature}/tasks.md`,
    "apps/api/src",
    "apps/worker/src",
    "apps/web/src",
    "packages/competency-qa/src",
    "packages/platform-core/src",
    "packages/platform-persistence-typeorm/src",
    "packages/platform-runtime-nest/src",
    "packages/runtime-composition/src",
    "tests/architecture/007",
    "tests/contract/007",
    "tests/unit/007",
    "tests/integration/007",
    "tests/integration/security/007",
    "tests/e2e/007",
    "tests/support/007-onboarding-fixture.ts",
    "tests/support/007-observability-fixture.ts",
    "tools/ci/feature-007-tests.mts",
    "tools/ci/feature-007.mts",
    "tools/ci/verify-007-migrations.mts",
    "tools/local/onboarding-cli.mts",
    "tools/local/onboarding-inputs.mts",
    "tools/local/onboarding-scenario.mts",
    "tools/local/onboarding-scenario-catalog.mts",
    "tools/smoke/feature-007.mts",
    "tools/smoke/feature-007-browser-process.mts",
    "tools/verification",
  ]),
  contracts: Object.freeze([`specs/${feature}/contracts`, "packages/platform-contracts/src"]),
  migrations: Object.freeze([
    "packages/platform-persistence-typeorm/src/migrations/core/0150-project-onboarding.ts",
    "packages/platform-persistence-typeorm/src/migrations/core/0155-project-binding-entitlements.ts",
    "packages/platform-persistence-typeorm/src/migrations/core/0160-artifact-retention-export.ts",
    "packages/platform-persistence-typeorm/src/migrations/core/index.ts",
    "packages/competency-qa/src/persistence/migrations/2080-project-resources.ts",
    "packages/competency-qa/src/persistence/migrations/2085-evidence-integrity.ts",
    "packages/competency-qa/src/persistence/migrations/index.ts",
    "packages/competency-qa/src/persistence/contributions.ts",
  ]),
  runtime: Object.freeze([
    ".node-version",
    "package.json",
    "pnpm-lock.yaml",
    "infra/compose/docker-compose.local.yml",
    "apps/api/src",
    "apps/worker/src",
    "apps/web/src",
    "packages/runtime-composition/src",
  ]),
});
const digest = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function filesBelow(item: string): string[] {
  const absolute = resolve(workspace, item);
  if (!existsSync(absolute)) return [];
  const rootReal = realpathSync(workspace);
  const targetReal = realpathSync(absolute);
  if (targetReal !== rootReal && !targetReal.startsWith(`${rootReal}/`))
    throw new Error(`Evidence path escapes workspace: ${item}`);
  if (!lstatSync(absolute).isDirectory()) return [absolute];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === ".git") return [];
    const child = resolve(absolute, entry.name);
    return entry.isDirectory()
      ? filesBelow(relative(workspace, child))
      : entry.isFile()
        ? [child]
        : [];
  });
}
function snapshot(paths: readonly string[]) {
  const missing = paths.filter((item) => !existsSync(resolve(workspace, item)));
  const files = [...new Set(paths.flatMap(filesBelow))].sort();
  const hash = createHash("sha256");
  for (const file of files)
    hash.update(relative(workspace, file)).update("\0").update(readFileSync(file)).update("\0");
  return Object.freeze({
    sha256: `sha256:${hash.digest("hex")}`,
    fileCount: files.length,
    paths,
    missing,
  });
}
if (flags.has("--plan")) {
  console.table(
    Object.entries(snapshotRoots).map(([name, paths]) => ({ snapshot: name, roots: paths.length })),
  );
  console.log(`[evidence:007:plan] childReports=${childReportNames.length}`);
  process.exit(0);
}
const startedAt = new Date();
const gateStartedAt = Date.parse(process.env.AWP_FEATURE_007_GATE_STARTED_AT ?? "");
const freshnessFloor = Number.isFinite(gateStartedAt)
  ? gateStartedAt
  : Date.now() - 24 * 60 * 60_000;
const failures: Array<Readonly<{ code: string; detail: string }>> = [];
const taskPath = resolve(workspace, `specs/${feature}/tasks.md`);
const taskBytes = readFileSync(taskPath);
const taskSha256 = digest(taskBytes);
const taskEntries = [...taskBytes.toString("utf8").matchAll(/^- \[([ xX])\] (T\d{3})\b/gmu)];
const pendingTaskIds = taskEntries
  .filter((match) => match[1]!.toLowerCase() !== "x")
  .map((match) => match[2]!);
const childReports = childReportNames.map((name) => {
  const file = resolve(reportDirectory, name);
  if (!existsSync(file)) {
    failures.push(Object.freeze({ code: "CHILD_REPORT_MISSING", detail: name }));
    return Object.freeze({ name, status: "MISSING", fresh: false });
  }
  const bytes = readFileSync(file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    failures.push(Object.freeze({ code: "CHILD_REPORT_INVALID_JSON", detail: name }));
    return Object.freeze({ name, status: "INVALID", fresh: false, sha256: digest(bytes) });
  }
  if (!isRecord(parsed)) {
    failures.push(Object.freeze({ code: "CHILD_REPORT_INVALID_SHAPE", detail: name }));
    return Object.freeze({ name, status: "INVALID", fresh: false, sha256: digest(bytes) });
  }
  const status = String(parsed.status ?? "MISSING");
  const timestamp = [parsed.finishedAt, parsed.generatedAt, parsed.startedAt].find(
    (value) => typeof value === "string",
  ) as string | undefined;
  const timestampMs = Date.parse(timestamp ?? "");
  const fresh =
    Number.isFinite(timestampMs) &&
    timestampMs >= freshnessFloor &&
    timestampMs <= Date.now() + 60_000;
  if (status !== "PASS")
    failures.push(Object.freeze({ code: "CHILD_REPORT_NOT_PASS", detail: `${name}:${status}` }));
  if (!fresh)
    failures.push(
      Object.freeze({ code: "CHILD_REPORT_STALE", detail: `${name}:${timestamp ?? "MISSING"}` }),
    );
  if (parsed.feature !== feature)
    failures.push(Object.freeze({ code: "CHILD_REPORT_FEATURE_MISMATCH", detail: name }));
  const taskBinding = isRecord(parsed.taskBinding) ? parsed.taskBinding : undefined;
  if (
    taskBinding &&
    taskBinding.path === `specs/${feature}/tasks.md` &&
    taskBinding.sha256 !== taskSha256
  )
    failures.push(Object.freeze({ code: "CHILD_REPORT_TASK_BINDING_MISMATCH", detail: name }));
  if (typeof parsed.taskSourceHash === "string" && parsed.taskSourceHash !== taskSha256)
    failures.push(Object.freeze({ code: "CHILD_REPORT_TASK_BINDING_MISMATCH", detail: name }));
  return Object.freeze({ name, status, fresh, timestamp, sha256: digest(bytes) });
});
const snapshots = Object.freeze({
  source: snapshot(snapshotRoots.source),
  contracts: snapshot(snapshotRoots.contracts),
  migrations: snapshot(snapshotRoots.migrations),
  runtime: snapshot(snapshotRoots.runtime),
  tasks: Object.freeze({
    path: relative(workspace, taskPath),
    sha256: taskSha256,
    taskCount: taskEntries.length,
    pendingTaskIds,
  }),
});
for (const [name, value] of Object.entries(snapshots)) {
  const missing: readonly string[] = "missing" in value ? value.missing : [];
  if (missing.length > 0)
    failures.push(
      Object.freeze({ code: "SNAPSHOT_INPUT_MISSING", detail: `${name}:${missing.join(",")}` }),
    );
}
if (pendingTaskIds.length > 0)
  failures.push(Object.freeze({ code: "TASKS_PENDING", detail: pendingTaskIds.join(",") }));
const report = Object.freeze({
  schemaVersion: 1,
  feature,
  gate: "evidence-aggregation",
  status: failures.length === 0 ? "PASS" : "FAIL",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  contour: "qa-jira-gitlab-mattermost-local",
  externalNetwork: "DENIED",
  production: "DENIED",
  childReports,
  snapshots,
  failures,
});
mkdirSync(dirname(reportPath), { recursive: true });
const temporary = `${reportPath}.${process.pid}.tmp`;
writeFileSync(temporary, stringifyPortableJson(report, workspace), "utf8");
renameSync(temporary, reportPath);
console.log(
  `[evidence:007] ${report.status}; reports=${childReports.length}; failures=${failures.length}; report: ${reportPath}`,
);
if (report.status !== "PASS") process.exitCode = 1;
