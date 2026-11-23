import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";

import { canonicalInputHash008, containsSensitiveValue008 } from "./feature-008-inputs.mts";
import {
  FEATURE_008,
  hashBytes,
  record,
  ROOT_008,
  safeFile,
  treeHash,
} from "./feature-008-prerequisites.mts";

export type GateStatus008 = "PASS" | "FAIL" | "BLOCKED_INPUT" | "SKIPPED_GATED";
export interface EvidenceRef008 {
  readonly path: string;
  readonly sha256: string;
}
export interface GateScope008 {
  readonly workspaceId: string;
  readonly projectIds: readonly string[];
}
export interface Fingerprints008 {
  readonly source: string;
  readonly contracts: string;
  readonly migrations: string;
  readonly lockfile: string;
  readonly configuration: string;
  readonly inputs: string;
  readonly suite: string;
  readonly image?: string;
  readonly scannerDatabase?: string;
}
export interface GateCheck008 {
  readonly id: string;
  readonly status: GateStatus008;
  readonly evidence: readonly EvidenceRef008[];
  readonly reasonCodes: readonly string[];
}
export interface GateReport008 {
  readonly schemaVersion: 1;
  readonly feature: typeof FEATURE_008;
  readonly runId: string;
  readonly gate: string;
  readonly status: GateStatus008;
  readonly deploymentProfile: "local" | "integration" | "pilot";
  readonly scope: GateScope008;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly fingerprints: Fingerprints008;
  readonly executorIdentity: string;
  readonly checks: readonly GateCheck008[];
  readonly prerequisites: readonly EvidenceRef008[];
  readonly reasonCodes: readonly string[];
  readonly measurementsRef?: EvidenceRef008;
}
export interface ReportValidation008 {
  readonly now: number;
  readonly maximumAgeMs: number;
  readonly scope: GateScope008;
  readonly fingerprints: Fingerprints008;
  readonly allowedExecutors: readonly string[];
}
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictTypes: false,
  strictRequired: false,
  validateFormats: false,
});
const schema: unknown = JSON.parse(
  readFileSync(resolve(ROOT_008, `specs/${FEATURE_008}/contracts/gate-report.schema.json`), "utf8"),
);
if (!record(schema)) throw new Error("REPORT_SCHEMA_INVALID");
const validateShape = ajv.compile<GateReport008>(schema);
function instant(value: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value))
    return NaN;
  return new Date(time).toISOString().replace(".000Z", "Z") === value.replace(".000Z", "Z")
    ? time
    : NaN;
}
export function validateGateReport008(value: unknown, options: ReportValidation008): string[] {
  const errors: string[] = [];
  let bytes: string;
  try {
    bytes = JSON.stringify(value);
    if (bytes.length > 2_000_000) errors.push("REPORT_TOO_LARGE");
  } catch {
    return ["REPORT_INVALID_JSON"];
  }
  if (containsSensitiveValue008(value)) errors.push("REPORT_SENSITIVE_DATA");
  if (!validateShape(value)) return [...errors, "REPORT_SCHEMA_INVALID"];
  const started = instant(value.startedAt),
    finished = instant(value.finishedAt);
  if (
    !Number.isFinite(started) ||
    !Number.isFinite(finished) ||
    started > finished ||
    finished > options.now + 60_000
  )
    errors.push("REPORT_TIME_INVALID");
  if (
    !Number.isFinite(options.maximumAgeMs) ||
    options.maximumAgeMs <= 0 ||
    options.now - finished > options.maximumAgeMs
  )
    errors.push("REPORT_STALE");
  if (
    value.scope.workspaceId !== options.scope.workspaceId ||
    canonicalInputHash008([...value.scope.projectIds].sort()) !==
      canonicalInputHash008([...options.scope.projectIds].sort())
  )
    errors.push("REPORT_SCOPE_MISMATCH");
  for (const [key, expected] of Object.entries(options.fingerprints))
    if (value.fingerprints[key as keyof Fingerprints008] !== expected)
      errors.push(`REPORT_FINGERPRINT_MISMATCH:${key}`);
  if (!options.allowedExecutors.includes(value.executorIdentity))
    errors.push("REPORT_EXECUTOR_UNTRUSTED");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value.runId))
    errors.push("REPORT_RUN_ID_INVALID");
  if (new Set(value.checks.map((c) => c.id)).size !== value.checks.length)
    errors.push("REPORT_DUPLICATE_CHECK");
  if (
    value.deploymentProfile !== "local" &&
    value.gate === "security" &&
    (!value.fingerprints.image ||
      !value.fingerprints.scannerDatabase ||
      !options.fingerprints.image ||
      !options.fingerprints.scannerDatabase)
  )
    errors.push("REPORT_RELEASE_SCAN_BINDING_REQUIRED");
  return errors;
}
function evidenceBytes(root: string, ref: EvidenceRef008): Buffer {
  if (!ref.path.startsWith(`reports/${FEATURE_008}/`)) throw new Error("EVIDENCE_PATH_FORBIDDEN");
  const target = safeFile(root, ref.path);
  if (!statSync(target).isFile() || statSync(target).size > 20_000_000)
    throw new Error("EVIDENCE_FILE_INVALID");
  const bytes = readFileSync(target);
  if (hashBytes(bytes) !== ref.sha256) throw new Error("EVIDENCE_DIGEST_MISMATCH");
  return bytes;
}
function validateReferences(
  root: string,
  report: GateReport008,
  options: ReportValidation008,
  visited: Set<string>,
): void {
  for (const check of report.checks) for (const ref of check.evidence) evidenceBytes(root, ref);
  if (report.measurementsRef) evidenceBytes(root, report.measurementsRef);
  for (const ref of report.prerequisites) {
    const child = readGateReport008(root, ref, options, visited);
    if (report.status === "PASS" && child.status !== "PASS")
      throw new Error("PREREQUISITE_NOT_PASS");
  }
}
export function writeGateReport008(
  root: string,
  report: GateReport008,
  options: ReportValidation008,
): EvidenceRef008 {
  const errors = validateGateReport008(report, options);
  if (errors.length) throw new Error(errors.join(","));
  validateReferences(root, report, options, new Set());
  const path = `reports/${FEATURE_008}/runs/${report.runId}.json`,
    bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`),
    target = safeFile(root, path, false);
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target)) {
    if (!readFileSync(target).equals(bytes)) throw new Error("REPORT_IMMUTABLE_CONFLICT");
    return { path, sha256: hashBytes(bytes) };
  }
  let fd: number | undefined;
  try {
    fd = openSync(target, "wx", 0o600);
    writeFileSync(fd, bytes);
  } catch (error) {
    if (existsSync(target) && readFileSync(target).equals(bytes))
      return { path, sha256: hashBytes(bytes) };
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return { path, sha256: hashBytes(bytes) };
}
export function readGateReport008(
  root: string,
  ref: EvidenceRef008,
  options: ReportValidation008,
  ancestors = new Set<string>(),
): GateReport008 {
  if (ancestors.has(ref.path)) throw new Error("REPORT_REFERENCE_CYCLE");
  if (ancestors.size > 32) throw new Error("REPORT_REFERENCE_DEPTH");
  const visited = new Set(ancestors).add(ref.path);
  let bytes: Buffer;
  try {
    bytes = evidenceBytes(root, ref);
  } catch (error) {
    if (error instanceof Error && error.message === "EVIDENCE_DIGEST_MISMATCH")
      throw new Error("REPORT_DIGEST_MISMATCH");
    throw error;
  }
  const report: unknown = JSON.parse(bytes.toString("utf8"));
  const errors = validateGateReport008(report, options);
  if (errors.length) throw new Error(errors.join(","));
  const validated = report as GateReport008;
  validateReferences(root, validated, options, visited);
  return Object.freeze(validated);
}
export function aggregateGateReports008(
  root: string,
  refs: readonly EvidenceRef008[],
  options: ReportValidation008,
): Readonly<{
  status: GateStatus008;
  reports: readonly GateReport008[];
  reasonCodes: readonly string[];
}> {
  const reports: GateReport008[] = [],
    reasonCodes: string[] = [];
  if (!refs.length) reasonCodes.push("REQUIRED_REPORTS_MISSING");
  for (const ref of refs) {
    try {
      reports.push(readGateReport008(root, ref, options));
    } catch (error) {
      reasonCodes.push(error instanceof Error ? error.message : "REPORT_INVALID");
    }
  }
  const status =
    reasonCodes.length || reports.some((r) => r.status === "FAIL")
      ? "FAIL"
      : reports.some((r) => r.status === "BLOCKED_INPUT")
        ? "BLOCKED_INPUT"
        : reports.some((r) => r.status === "SKIPPED_GATED")
          ? "SKIPPED_GATED"
          : "PASS";
  return { status, reports, reasonCodes };
}
export function currentFingerprints008(root = ROOT_008): Fingerprints008 {
  return {
    source: treeHash(root, ["apps", "packages", "tools"]),
    contracts: treeHash(root, [`specs/${FEATURE_008}/contracts`]),
    migrations: treeHash(root, [
      "packages/platform-persistence-typeorm/src/migrations",
      "packages/competency-qa/src/persistence/migrations",
      "packages/connector-jira-persistence-typeorm/src/migrations",
      "packages/connector-gitlab-persistence-typeorm/src/migrations",
    ]),
    lockfile: hashBytes(readFileSync(safeFile(root, "pnpm-lock.yaml"))),
    configuration: treeHash(root, [
      "config/pilot",
      ".dockerignore",
      ".gitlab-ci.yml",
      ".gitlab/ci",
      "infra/compose/docker-compose.local.yml",
      "infra/compose/docker",
      "infra/compose/scripts",
      "infra/compose/postgres",
      "infra/compose/certs/fake-idp-openssl.cnf",
      "infra/observability",
      "package.json",
      "pnpm-workspace.yaml",
      ".npmrc",
      "nx.json",
      "tsconfig.json",
      "tsconfig.base.json",
      "eslint.config.mjs",
    ]),
    inputs: hashBytes(readFileSync(safeFile(root, "config/pilot/local-inputs.json"))),
    suite: treeHash(root, [
      "tests",
      "vitest.config.ts",
      "vitest.workspace.ts",
      "playwright.config.ts",
    ]),
  };
}
export function evidenceRef008(root: string, path: string): EvidenceRef008 {
  return { path, sha256: hashBytes(readFileSync(safeFile(root, path))) };
}
