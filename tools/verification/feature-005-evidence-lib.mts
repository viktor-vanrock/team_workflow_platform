import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const FEATURE = "005-gitlab-automated-validation";
const TASKS_PATH = "specs/005-gitlab-automated-validation/tasks.md";
const ignoredDirectories = new Set([
  ".git",
  ".nx",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "reports",
  "test-results",
]);
const dangerousJsonKeys = new Set(["__proto__", "constructor", "prototype"]);

export const FEATURE_005_AUTHORITATIVE_EVIDENCE = Object.freeze([
  "prerequisites.json",
  "governance.json",
  "setup-gate.json",
  "foundation.json",
  "us1.json",
  "us2.json",
  "us3.json",
  "us4.json",
  "migrations.json",
  "observability.json",
  "documented-scenarios.json",
  "smoke.json",
  "quickstart.json",
  "nonprod-metadata.json",
  "nonprod.json",
  "traceability.json",
] as const);

export type JsonRecord = Readonly<Record<string, unknown>>;
export interface Feature005TaskSnapshot {
  readonly path: typeof TASKS_PATH;
  readonly sha256: string;
  readonly taskCount: number;
  readonly completedTaskIds: readonly string[];
  readonly pendingTaskIds: readonly string[];
}
export interface Feature005TreeSnapshot {
  readonly algorithm: "sha256(path\\0sha256(content)\\n)";
  readonly scope: Readonly<{
    readonly directories: readonly string[];
    readonly files: readonly string[];
    readonly exclusions: readonly string[];
  }>;
  readonly fileCount: number;
  readonly sha256: string;
}
export interface Feature005HandoffSnapshot {
  readonly taskSnapshot: Feature005TaskSnapshot;
  readonly sourceSnapshot: Feature005TreeSnapshot;
  readonly contractSnapshot: Feature005TreeSnapshot;
  readonly runtimeSnapshot: Feature005TreeSnapshot;
}

export function isFeature005JsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function sha256Feature005Bytes(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
export function sha256Feature005File(path: string): `sha256:${string}` {
  return sha256Feature005Bytes(readFileSync(path));
}

export function readFeature005Report(path: string, maximumBytes = 5_000_000): JsonRecord {
  const stats = statSync(path);
  if (!stats.isFile() || stats.size > maximumBytes)
    throw new Error(`EVIDENCE_REPORT_SIZE_INVALID:${path}`);
  const value = JSON.parse(readFileSync(path, "utf8"), (key, child: unknown) => {
    if (dangerousJsonKeys.has(key)) throw new Error(`EVIDENCE_REPORT_DANGEROUS_KEY:${key}`);
    return child;
  }) as unknown;
  if (!isFeature005JsonRecord(value)) throw new Error(`EVIDENCE_REPORT_NOT_OBJECT:${path}`);
  return value;
}

function portablePath(workspace: string, path: string): string {
  return relative(workspace, path).replaceAll("\\", "/");
}
function collectFiles(
  workspace: string,
  directories: readonly string[],
  files: readonly string[],
  exclusions: readonly string[],
): readonly string[] {
  const collected = new Set<string>();
  const excluded = new Set(exclusions);
  const visit = (absolutePath: string): void => {
    for (const entry of readdirSync(absolutePath, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (ignoredDirectories.has(entry.name)) continue;
      const child = resolve(absolutePath, entry.name);
      const path = portablePath(workspace, child);
      if (excluded.has(path)) continue;
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) collected.add(path);
    }
  };
  for (const directory of directories) {
    const path = resolve(workspace, directory);
    if (existsSync(path)) visit(path);
  }
  for (const file of files)
    if (existsSync(resolve(workspace, file)) && !excluded.has(file)) collected.add(file);
  return [...collected].sort();
}
function treeSnapshot(
  workspace: string,
  directories: readonly string[],
  files: readonly string[],
  exclusions: readonly string[],
): Feature005TreeSnapshot {
  const paths = collectFiles(workspace, directories, files, exclusions);
  const digest = createHash("sha256");
  for (const path of paths) {
    digest.update(path);
    digest.update("\0");
    digest.update(sha256Feature005File(resolve(workspace, path)));
    digest.update("\n");
  }
  return Object.freeze({
    algorithm: "sha256(path\\0sha256(content)\\n)",
    scope: Object.freeze({ directories, files, exclusions }),
    fileCount: paths.length,
    sha256: `sha256:${digest.digest("hex")}`,
  });
}

export function captureFeature005HandoffSnapshot(workspace: string): Feature005HandoffSnapshot {
  const tasksContent = readFileSync(resolve(workspace, TASKS_PATH), "utf8");
  const taskRows = [...tasksContent.matchAll(/^- \[([ xX])\] (T\d{3})\b/gmu)];
  const taskSnapshot: Feature005TaskSnapshot = Object.freeze({
    path: TASKS_PATH,
    sha256: sha256Feature005Bytes(tasksContent),
    taskCount: taskRows.length,
    completedTaskIds: Object.freeze(
      taskRows.filter((match) => match[1]!.toLowerCase() === "x").map((match) => match[2]!),
    ),
    pendingTaskIds: Object.freeze(
      taskRows.filter((match) => match[1]!.toLowerCase() !== "x").map((match) => match[2]!),
    ),
  });
  return Object.freeze({
    taskSnapshot,
    sourceSnapshot: treeSnapshot(
      workspace,
      ["apps", "packages", "config", "infra", "docs", "specs/005-gitlab-automated-validation"],
      [],
      [TASKS_PATH],
    ),
    contractSnapshot: treeSnapshot(
      workspace,
      ["specs/005-gitlab-automated-validation/contracts"],
      [
        "packages/platform-contracts/src/generated/schema-documents.ts",
        "apps/api/openapi.generated.json",
        "apps/mock-hub/openapi.generated.json",
      ],
      [],
    ),
    runtimeSnapshot: treeSnapshot(
      workspace,
      [
        "tests/contract/005",
        "tests/unit/005",
        "tests/integration/005",
        "tests/integration/security/005",
        "tools",
      ],
      [
        "tests/architecture/005-gitlab-boundaries.spec.ts",
        "tests/architecture/005-gitlab-runtime-wiring.spec.ts",
        "tests/e2e/005-us1-automated-session.spec.ts",
        "tests/e2e/005-us2-trigger-once.spec.ts",
        "tests/e2e/005-us3-technical-result-review.spec.ts",
        "tests/e2e/005-us4-outage-recovery.spec.ts",
        "playwright.config.ts",
        "package.json",
        "pnpm-lock.yaml",
        "tsconfig.base.json",
      ],
      ["tools/verification/feature-006-prerequisites.mts"],
    ),
  });
}

export function acceptedFeature005EvidenceStatus(name: string, status: string): boolean {
  return name === "nonprod-metadata.json" || name === "nonprod.json"
    ? status === "PASS" || status === "SKIPPED_GATED"
    : status === "PASS";
}

export function verifyFeature005SourceBinding(
  workspace: string,
  report: JsonRecord,
): readonly string[] {
  const failures: string[] = [];
  const binding = isFeature005JsonRecord(report.sourceBinding) ? report.sourceBinding : undefined;
  if (!binding) return Object.freeze(failures);
  const files = Array.isArray(binding.files) ? binding.files.filter(isFeature005JsonRecord) : [];
  for (const file of files) {
    const path = typeof file.path === "string" ? resolve(workspace, file.path) : "";
    if (!path.startsWith(`${workspace}/`) || !existsSync(path))
      failures.push(`SOURCE_BINDING_FILE_MISSING:${String(file.path)}`);
    else if (file.sha256 !== sha256Feature005File(path))
      failures.push(`SOURCE_BINDING_HASH_MISMATCH:${String(file.path)}`);
  }
  return Object.freeze(failures);
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}
function sameTree(value: unknown, expected: Feature005TreeSnapshot): boolean {
  return (
    isFeature005JsonRecord(value) &&
    value.algorithm === expected.algorithm &&
    value.fileCount === expected.fileCount &&
    value.sha256 === expected.sha256
  );
}

export function verifyFeature005FinalReport(
  workspace: string,
  report: JsonRecord,
): Readonly<{
  status: "PASS" | "FAIL";
  failures: readonly Readonly<{ code: string; detail: string }>[];
  currentSnapshot: Feature005HandoffSnapshot;
}> {
  const failures: Array<Readonly<{ code: string; detail: string }>> = [];
  const fail = (code: string, detail: string): void => {
    failures.push(Object.freeze({ code, detail }));
  };
  const currentSnapshot = captureFeature005HandoffSnapshot(workspace);
  if (report.feature !== FEATURE || report.gate !== "feature-005-final" || report.status !== "PASS")
    fail("FINAL_REPORT_IDENTITY_OR_STATUS_INVALID", "feature, gate and PASS status are required");
  const handoff = isFeature005JsonRecord(report.handoff) ? report.handoff : undefined;
  if (
    handoff?.status !== "BOUND" ||
    handoff.generatedAfterAllProcessGates !== true ||
    handoff.verificationCommand !== "pnpm verify:005:evidence"
  )
    fail("HANDOFF_ATTESTATION_MISSING", "post-gate BOUND handoff is required");
  const tasks =
    handoff && isFeature005JsonRecord(handoff.taskSnapshot) ? handoff.taskSnapshot : undefined;
  if (
    !tasks ||
    tasks.path !== currentSnapshot.taskSnapshot.path ||
    tasks.sha256 !== currentSnapshot.taskSnapshot.sha256 ||
    tasks.taskCount !== currentSnapshot.taskSnapshot.taskCount ||
    !sameStrings(tasks.completedTaskIds, currentSnapshot.taskSnapshot.completedTaskIds) ||
    !sameStrings(tasks.pendingTaskIds, currentSnapshot.taskSnapshot.pendingTaskIds)
  )
    fail("TASK_SNAPSHOT_MISMATCH", "tasks.md changed after final evidence");
  if (!sameTree(handoff?.sourceSnapshot, currentSnapshot.sourceSnapshot))
    fail("SOURCE_SNAPSHOT_MISMATCH", "source content changed after final evidence");
  if (!sameTree(handoff?.contractSnapshot, currentSnapshot.contractSnapshot))
    fail("CONTRACT_SNAPSHOT_MISMATCH", "contract content changed after final evidence");
  if (!sameTree(handoff?.runtimeSnapshot, currentSnapshot.runtimeSnapshot))
    fail("RUNTIME_SNAPSHOT_MISMATCH", "runtime/test/tool content changed after final evidence");
  const stages = Array.isArray(report.stages) ? report.stages : [];
  if (
    stages.length === 0 ||
    stages.some((stage) => !isFeature005JsonRecord(stage) || stage.status !== "PASS")
  )
    fail("PROCESS_GATE_NOT_PASS", "every recorded final stage must be PASS");
  const evidence = Array.isArray(report.evidence) ? report.evidence : [];
  for (const name of [...FEATURE_005_AUTHORITATIVE_EVIDENCE, "evidence.json"]) {
    const entry = evidence.find((item) => isFeature005JsonRecord(item) && item.name === name);
    const path = resolve(workspace, "reports/005-gitlab-automated-validation", name);
    if (!isFeature005JsonRecord(entry) || !existsSync(path)) {
      fail("EVIDENCE_REFERENCE_MISSING", name);
      continue;
    }
    if (entry.sha256 !== sha256Feature005File(path)) fail("EVIDENCE_DIGEST_MISMATCH", name);
    const actual = readFeature005Report(path);
    if (!acceptedFeature005EvidenceStatus(name, String(actual.status)))
      fail("EVIDENCE_STATUS_NOT_ACCEPTED", `${name}:${String(actual.status)}`);
  }
  return Object.freeze({
    status: failures.length === 0 ? "PASS" : "FAIL",
    failures: Object.freeze(failures),
    currentSnapshot,
  });
}

export function writeFeature005ReportAtomic(
  workspace: string,
  path: string,
  report: Readonly<Record<string, unknown>>,
): void {
  const target = resolve(path);
  if (target !== workspace && !target.startsWith(`${workspace}/`))
    throw new Error("REPORT_PATH_OUTSIDE_WORKSPACE");
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileSync(temporary, stringifyPortableJson(report, workspace), {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, target);
}
