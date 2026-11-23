import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const FEATURE = "003-jira-operational-authority";
const TASKS_PATH = "specs/003-jira-operational-authority/tasks.md";
const REPORTS_PATH = "reports/003-jira-operational-authority";
const IGNORED_DIRECTORY_NAMES = new Set([
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
const DOWNSTREAM_BINDING_FILES = new Set([
  "tools/verification/feature-004-prerequisites.mts",
  "tools/verification/feature-005-prerequisites.mts",
  "tools/verification/feature-006-prerequisites.mts",
]);

export const FEATURE_003_AUTHORITATIVE_EVIDENCE = Object.freeze([
  "prerequisites.json",
  "setup-gate.json",
  "foundation.json",
  "us1.json",
  "us2.json",
  "us3.json",
  "us4.json",
  "migrations.json",
  "smoke.json",
  "quickstart.json",
  "traceability.json",
  "nonprod-metadata.json",
  "nonprod.json",
] as const);

export const FEATURE_003_RUNTIME_DIRECTORIES = Object.freeze([
  ".github",
  "apps",
  "config",
  "docs",
  "infra",
  "packages",
  "specs/003-jira-operational-authority",
  "tests",
  "tools",
] as const);

export const FEATURE_003_RUNTIME_ROOT_FILES = Object.freeze([
  ".dockerignore",
  ".node-version",
  ".npmrc",
  "Dockerfile",
  "README.md",
  "eslint.config.mjs",
  "nx.json",
  "package.json",
  "playwright.config.ts",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
] as const);

export interface Feature003TaskSnapshot {
  readonly path: typeof TASKS_PATH;
  readonly sha256: string;
  readonly taskCount: number;
  readonly completedTaskIds: readonly string[];
  readonly pendingTaskIds: readonly string[];
}

export interface Feature003RuntimeSnapshot {
  readonly algorithm: "sha256(path\\0sha256(content)\\n)";
  readonly scope: Readonly<{
    readonly directories: readonly string[];
    readonly rootFiles: readonly string[];
    readonly excludedTaskFile: typeof TASKS_PATH;
    readonly excludedDownstreamBindingFiles: readonly string[];
  }>;
  readonly fileCount: number;
  readonly sha256: string;
}

export interface Feature003HandoffSnapshot {
  readonly taskSnapshot: Feature003TaskSnapshot;
  readonly runtimeSnapshot: Feature003RuntimeSnapshot;
}

export interface Feature003EvidenceFailure {
  readonly code: string;
  readonly detail: string;
}

export interface Feature003EvidenceVerification {
  readonly status: "PASS" | "FAIL";
  readonly failures: readonly Feature003EvidenceFailure[];
  readonly currentSnapshot?: Feature003HandoffSnapshot;
}

type JsonRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function portablePath(workspace: string, absolutePath: string): string {
  return relative(workspace, absolutePath).replaceAll("\\", "/");
}

function digestBytes(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function sha256File(path: string): string {
  return digestBytes(readFileSync(path));
}

function collectRuntimeFiles(workspace: string): readonly string[] {
  const collected = new Set<string>();
  const visit = (absolutePath: string): void => {
    const entries = readdirSync(absolutePath, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      if (IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
      const child = resolve(absolutePath, entry.name);
      if (entry.isDirectory()) {
        visit(child);
      } else if (entry.isFile()) {
        const path = portablePath(workspace, child);
        if (path !== TASKS_PATH && !DOWNSTREAM_BINDING_FILES.has(path)) collected.add(path);
      }
    }
  };

  for (const directory of FEATURE_003_RUNTIME_DIRECTORIES) {
    const absolutePath = resolve(workspace, directory);
    if (existsSync(absolutePath)) visit(absolutePath);
  }
  for (const rootFile of FEATURE_003_RUNTIME_ROOT_FILES) {
    if (existsSync(resolve(workspace, rootFile))) collected.add(rootFile);
  }
  return [...collected].sort();
}

function captureTaskSnapshot(workspace: string): Feature003TaskSnapshot {
  const path = resolve(workspace, TASKS_PATH);
  const content = readFileSync(path, "utf8");
  const taskRows = [...content.matchAll(/^- \[([ xX])\] (T\d{3})\b/gmu)];
  const completedTaskIds = taskRows
    .filter((match) => match[1]!.toLowerCase() === "x")
    .map((match) => match[2]!);
  const pendingTaskIds = taskRows
    .filter((match) => match[1]!.toLowerCase() !== "x")
    .map((match) => match[2]!);
  return Object.freeze({
    path: TASKS_PATH,
    sha256: digestBytes(content),
    taskCount: taskRows.length,
    completedTaskIds: Object.freeze(completedTaskIds),
    pendingTaskIds: Object.freeze(pendingTaskIds),
  });
}

function captureRuntimeSnapshot(workspace: string): Feature003RuntimeSnapshot {
  const files = collectRuntimeFiles(workspace);
  const digest = createHash("sha256");
  for (const path of files) {
    digest.update(path);
    digest.update("\0");
    digest.update(sha256File(resolve(workspace, path)));
    digest.update("\n");
  }
  return Object.freeze({
    algorithm: "sha256(path\\0sha256(content)\\n)",
    scope: Object.freeze({
      directories: FEATURE_003_RUNTIME_DIRECTORIES,
      rootFiles: FEATURE_003_RUNTIME_ROOT_FILES,
      excludedTaskFile: TASKS_PATH,
      excludedDownstreamBindingFiles: Object.freeze([...DOWNSTREAM_BINDING_FILES].sort()),
    }),
    fileCount: files.length,
    sha256: `sha256:${digest.digest("hex")}`,
  });
}

export function captureFeature003HandoffSnapshot(workspace: string): Feature003HandoffSnapshot {
  return Object.freeze({
    taskSnapshot: captureTaskSnapshot(workspace),
    runtimeSnapshot: captureRuntimeSnapshot(workspace),
  });
}

function evidenceStatusAccepted(name: string, status: string): boolean {
  if (name === "nonprod-metadata.json" || name === "nonprod.json") {
    return status === "PASS" || status === "SKIPPED_GATED";
  }
  return status === "PASS";
}

function sameStringArray(left: unknown, right: readonly string[]): boolean {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function verifyFeature003HandoffReport(
  input: Readonly<{
    workspace: string;
    report: JsonRecord;
    requiredEvidenceNames?: readonly string[];
  }>,
): Feature003EvidenceVerification {
  const failures: Feature003EvidenceFailure[] = [];
  const fail = (code: string, detail: string): void => {
    failures.push(Object.freeze({ code, detail }));
  };
  const requiredEvidenceNames = input.requiredEvidenceNames ?? FEATURE_003_AUTHORITATIVE_EVIDENCE;

  if (input.report.feature !== FEATURE || input.report.gate !== "feature-003-final") {
    fail("FINAL_REPORT_IDENTITY_MISMATCH", "final report feature/gate identity is incompatible");
  }
  if (input.report.status !== "PASS") {
    fail("FINAL_STATUS_NOT_PASS", `final report status=${String(input.report.status)}`);
  }

  const stages = Array.isArray(input.report.stages) ? input.report.stages : [];
  const stageStatuses = new Map<string, string>();
  for (const stage of stages) {
    if (isRecord(stage)) stageStatuses.set(String(stage.id), String(stage.status));
  }
  if (stages.length === 0 || [...stageStatuses.values()].some((status) => status !== "PASS")) {
    fail("PROCESS_GATE_NOT_PASS", "every recorded process gate must be present and PASS");
  }

  const handoff = isRecord(input.report.handoff) ? input.report.handoff : undefined;
  if (
    handoff?.status !== "BOUND" ||
    handoff.generatedAfterAllProcessGates !== true ||
    handoff.verificationCommand !== "pnpm verify:003:evidence"
  ) {
    fail(
      "HANDOFF_ATTESTATION_MISSING",
      "a PASS report requires a post-gate BOUND handoff attestation",
    );
  }

  let currentSnapshot: Feature003HandoffSnapshot | undefined;
  try {
    currentSnapshot = captureFeature003HandoffSnapshot(input.workspace);
    const recordedTasks =
      handoff && isRecord(handoff.taskSnapshot) ? handoff.taskSnapshot : undefined;
    if (
      recordedTasks?.path !== currentSnapshot.taskSnapshot.path ||
      recordedTasks.sha256 !== currentSnapshot.taskSnapshot.sha256 ||
      recordedTasks.taskCount !== currentSnapshot.taskSnapshot.taskCount ||
      !sameStringArray(
        recordedTasks.completedTaskIds,
        currentSnapshot.taskSnapshot.completedTaskIds,
      ) ||
      !sameStringArray(recordedTasks.pendingTaskIds, currentSnapshot.taskSnapshot.pendingTaskIds)
    ) {
      fail(
        "TASK_SNAPSHOT_MISMATCH",
        "tasks.md content or completion state changed after evidence generation",
      );
    }
    const recordedRuntime =
      handoff && isRecord(handoff.runtimeSnapshot) ? handoff.runtimeSnapshot : undefined;
    if (
      recordedRuntime?.algorithm !== currentSnapshot.runtimeSnapshot.algorithm ||
      recordedRuntime.sha256 !== currentSnapshot.runtimeSnapshot.sha256 ||
      recordedRuntime.fileCount !== currentSnapshot.runtimeSnapshot.fileCount
    ) {
      fail(
        "RUNTIME_SNAPSHOT_MISMATCH",
        "runtime/test/configuration content changed after evidence generation",
      );
    }
  } catch (error) {
    fail("SNAPSHOT_CAPTURE_FAILED", error instanceof Error ? error.message : String(error));
  }

  const evidence = Array.isArray(input.report.evidence) ? input.report.evidence : [];
  const evidenceByName = new Map<string, JsonRecord>();
  for (const entry of evidence) {
    if (!isRecord(entry)) continue;
    const name = String(entry.name);
    if (evidenceByName.has(name)) fail("DUPLICATE_EVIDENCE_REFERENCE", name);
    evidenceByName.set(name, entry);
  }
  for (const name of requiredEvidenceNames) {
    const entry = evidenceByName.get(name);
    if (!entry) {
      fail("EVIDENCE_REFERENCE_MISSING", name);
      continue;
    }
    const path = resolve(input.workspace, REPORTS_PATH, name);
    if (!existsSync(path)) {
      fail("EVIDENCE_FILE_MISSING", name);
      continue;
    }
    if (entry.sha256 !== sha256File(path)) {
      fail("EVIDENCE_DIGEST_MISMATCH", name);
    }
    let actualStatus = "INVALID_JSON";
    try {
      const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
      actualStatus = isRecord(value) ? String(value.status) : "INVALID_JSON";
    } catch {
      // The digest mismatch already preserves the byte-level failure; status remains INVALID_JSON.
    }
    if (entry.status !== actualStatus || !evidenceStatusAccepted(name, actualStatus)) {
      fail(
        "EVIDENCE_STATUS_MISMATCH",
        `${name}: recorded=${String(entry.status)} actual=${actualStatus}`,
      );
    }
    const stageId = String(entry.stageId);
    if (stageStatuses.get(stageId) !== "PASS") {
      fail("EVIDENCE_STAGE_NOT_PASS", `${name}: stage=${stageId}`);
    }
  }
  for (const name of evidenceByName.keys()) {
    if (!requiredEvidenceNames.includes(name)) fail("UNEXPECTED_EVIDENCE_REFERENCE", name);
  }

  return Object.freeze({
    status: failures.length === 0 ? "PASS" : "FAIL",
    failures: Object.freeze(failures),
    ...(currentSnapshot ? { currentSnapshot } : {}),
  });
}

export function writeFeature003ReportAtomic(
  workspace: string,
  reportPath: string,
  value: unknown,
): void {
  mkdirSync(dirname(reportPath), { recursive: true });
  const temporaryPath = `${reportPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, stringifyPortableJson(value, workspace), "utf8");
  renameSync(temporaryPath, reportPath);
}
