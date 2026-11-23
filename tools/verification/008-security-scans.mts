import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  FEATURE_008,
  hashBytes,
  record,
  ROOT_008,
  safeFile,
  write008Json,
} from "./feature-008-prerequisites.mts";
import {
  currentFingerprints008,
  evidenceRef008,
  type Fingerprints008,
  type GateReport008,
  type GateStatus008,
  writeGateReport008,
} from "./feature-008-reports.mts";

export type ScanKind008 = "DEPENDENCY" | "IMAGE";
export type ScanSeverity008 = "CRITICAL" | "HIGH" | "MODERATE" | "LOW";
export type ScanCoverage008 = "FULL" | "ADAPTER_FIXTURE";
export interface ScanFinding008 {
  readonly id: string;
  readonly component: string;
  readonly installedVersion: string;
  readonly severity: ScanSeverity008;
  readonly status: "CLOSED" | "ACCEPTED_RISK" | "OPEN";
  readonly fixedVersion?: string;
  readonly owner?: string;
  readonly expiresAt?: string;
}
export interface SecurityScanReport008 {
  readonly schemaVersion: "security-scan@1.0.0";
  readonly kind: ScanKind008;
  readonly contour: "DEVELOPMENT_MOCKS" | "CORPORATE";
  readonly coverage: ScanCoverage008;
  readonly artifact: { readonly kind: "LOCKFILE" | "OCI_IMAGE"; readonly digest: string };
  readonly scanner: { readonly id: string; readonly version: string };
  readonly database: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
    readonly publishedAt: string;
  };
  readonly policy: { readonly id: string; readonly version: string; readonly digest: string };
  readonly scannedAt: string;
  readonly findings: readonly ScanFinding008[];
}
export interface SecurityScanPolicy008 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly contour: "DEVELOPMENT_MOCKS";
  readonly reportMaximumAgeMs: number;
  readonly databaseMaximumAgeMs: number;
  readonly acceptedRiskSeverities: readonly ScanSeverity008[];
  readonly scanners: Readonly<
    Record<ScanKind008, { readonly id: string; readonly version: string }>
  >;
  readonly dependencySnapshot: {
    readonly path: string;
    readonly sha256: string;
    readonly lockDigest: string;
  };
  readonly acceptedFindings: readonly {
    readonly id: string;
    readonly severity: ScanSeverity008;
    readonly owner: string;
    readonly expiresAt: string;
  }[];
}
export interface SecurityScanExpectation008 {
  readonly kind: ScanKind008;
  readonly contour: "DEVELOPMENT_MOCKS" | "CORPORATE";
  readonly artifactDigest: string;
  readonly requiredCoverage: ScanCoverage008;
  readonly scanner: { readonly id: string; readonly version: string };
  readonly database: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
    readonly publishedAt: string;
  };
  readonly policy: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
    readonly reportMaximumAgeMs: number;
    readonly databaseMaximumAgeMs: number;
    readonly acceptedRiskSeverities: readonly ScanSeverity008[];
    readonly acceptedFindings: SecurityScanPolicy008["acceptedFindings"];
  };
  readonly now: number;
}

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const versionPattern = /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$/u;
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const time = (value: unknown) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    ? Date.parse(value)
    : NaN;
const validRef = (value: unknown): value is { readonly id: string; readonly version: string } =>
  record(value) &&
  exact(value, ["id", "version"]) &&
  typeof value.id === "string" &&
  value.id.length > 0 &&
  typeof value.version === "string" &&
  versionPattern.test(value.version);
const validFinding = (value: unknown): value is ScanFinding008 => {
  if (!record(value)) return false;
  const required = ["id", "component", "installedVersion", "severity", "status"],
    optional = ["fixedVersion", "owner", "expiresAt"];
  if (
    !required.every((key) => Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key))
  )
    return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.component === "string" &&
    value.component.length > 0 &&
    typeof value.installedVersion === "string" &&
    value.installedVersion.length > 0 &&
    ["CRITICAL", "HIGH", "MODERATE", "LOW"].includes(String(value.severity)) &&
    ["CLOSED", "ACCEPTED_RISK", "OPEN"].includes(String(value.status)) &&
    (value.fixedVersion === undefined || typeof value.fixedVersion === "string") &&
    (value.owner === undefined || typeof value.owner === "string") &&
    (value.expiresAt === undefined || Number.isFinite(time(value.expiresAt)))
  );
};
function parseReport(value: unknown): SecurityScanReport008 | null {
  if (
    !record(value) ||
    !exact(value, [
      "schemaVersion",
      "kind",
      "contour",
      "coverage",
      "artifact",
      "scanner",
      "database",
      "policy",
      "scannedAt",
      "findings",
    ])
  )
    return null;
  if (
    value.schemaVersion !== "security-scan@1.0.0" ||
    !["DEPENDENCY", "IMAGE"].includes(String(value.kind)) ||
    !["DEVELOPMENT_MOCKS", "CORPORATE"].includes(String(value.contour)) ||
    !["FULL", "ADAPTER_FIXTURE"].includes(String(value.coverage))
  )
    return null;
  if (
    !record(value.artifact) ||
    !exact(value.artifact, ["kind", "digest"]) ||
    !["LOCKFILE", "OCI_IMAGE"].includes(String(value.artifact.kind)) ||
    typeof value.artifact.digest !== "string" ||
    !digestPattern.test(value.artifact.digest)
  )
    return null;
  if (
    !validRef(value.scanner) ||
    !record(value.database) ||
    !exact(value.database, ["id", "version", "digest", "publishedAt"]) ||
    !validRef({ id: value.database.id, version: value.database.version }) ||
    typeof value.database.digest !== "string" ||
    !digestPattern.test(value.database.digest) ||
    !Number.isFinite(time(value.database.publishedAt))
  )
    return null;
  if (
    !record(value.policy) ||
    !exact(value.policy, ["id", "version", "digest"]) ||
    !validRef({ id: value.policy.id, version: value.policy.version }) ||
    typeof value.policy.digest !== "string" ||
    !digestPattern.test(value.policy.digest) ||
    !Number.isFinite(time(value.scannedAt))
  )
    return null;
  if (!Array.isArray(value.findings) || !value.findings.every(validFinding)) return null;
  return value as unknown as SecurityScanReport008;
}
export function evaluateSecurityScan008(value: unknown, expected: SecurityScanExpectation008) {
  const report = parseReport(value);
  if (!report)
    return Object.freeze({
      status: "BLOCKED_INPUT" as GateStatus008,
      releaseEligible: false,
      reasonCodes: Object.freeze([
        value === null || value === undefined ? "SCAN_MISSING" : "SCAN_SCHEMA_INVALID",
      ]),
      measurements: Object.freeze({
        critical: null,
        high: null,
        moderate: null,
        low: null,
        open: null,
      }),
    });
  const blocked: string[] = [];
  if (report.kind !== expected.kind || report.contour !== expected.contour)
    blocked.push("SCAN_SCOPE_MISMATCH");
  if (
    report.artifact.kind !== (expected.kind === "DEPENDENCY" ? "LOCKFILE" : "OCI_IMAGE") ||
    report.artifact.digest !== expected.artifactDigest
  )
    blocked.push("SCAN_ARTIFACT_MISMATCH");
  if (report.coverage !== expected.requiredCoverage) blocked.push("SCAN_COVERAGE_INSUFFICIENT");
  if (
    report.scanner.id !== expected.scanner.id ||
    report.scanner.version !== expected.scanner.version
  )
    blocked.push("SCAN_SCANNER_MISMATCH");
  if (
    report.database.id !== expected.database.id ||
    report.database.version !== expected.database.version ||
    report.database.digest !== expected.database.digest ||
    report.database.publishedAt !== expected.database.publishedAt
  )
    blocked.push("SCAN_DATABASE_MISMATCH");
  if (
    report.policy.id !== expected.policy.id ||
    report.policy.version !== expected.policy.version ||
    report.policy.digest !== expected.policy.digest
  )
    blocked.push("SCAN_POLICY_MISMATCH");
  const scanned = time(report.scannedAt),
    published = time(report.database.publishedAt);
  if (
    scanned > expected.now + 60_000 ||
    expected.now - scanned > expected.policy.reportMaximumAgeMs
  )
    blocked.push("SCAN_REPORT_STALE");
  if (published > scanned || expected.now - published > expected.policy.databaseMaximumAgeMs)
    blocked.push("SCAN_DATABASE_STALE");
  if (new Set(report.findings.map((finding) => finding.id)).size !== report.findings.length)
    blocked.push("SCAN_FINDING_DUPLICATE");
  const policyFailures: string[] = [];
  for (const finding of report.findings) {
    if (
      (finding.severity === "CRITICAL" || finding.severity === "HIGH") &&
      finding.status !== "CLOSED"
    )
      policyFailures.push(`${finding.severity}_FINDING_NOT_CLOSED`);
    if (finding.status === "OPEN") policyFailures.push("FINDING_OPEN");
    if (finding.status === "ACCEPTED_RISK") {
      const accepted = expected.policy.acceptedFindings.find(
        (item) =>
          item.id === finding.id &&
          item.severity === finding.severity &&
          item.owner === finding.owner &&
          item.expiresAt === finding.expiresAt,
      );
      if (
        !expected.policy.acceptedRiskSeverities.includes(finding.severity) ||
        !accepted ||
        !finding.owner ||
        time(finding.expiresAt) <= expected.now
      )
        policyFailures.push("FINDING_ACCEPTANCE_INVALID");
    }
  }
  const counts = (severity: ScanSeverity008) =>
    report.findings.filter((finding) => finding.severity === severity).length;
  const status: GateStatus008 = blocked.length
    ? "BLOCKED_INPUT"
    : policyFailures.length
      ? "FAIL"
      : "PASS";
  return Object.freeze({
    status,
    releaseEligible:
      status === "PASS" && report.coverage === "FULL" && report.contour === "CORPORATE",
    reasonCodes: Object.freeze([...new Set([...blocked, ...policyFailures])]),
    measurements: Object.freeze({
      critical: counts("CRITICAL"),
      high: counts("HIGH"),
      moderate: counts("MODERATE"),
      low: counts("LOW"),
      open: report.findings.filter((finding) => finding.status === "OPEN").length,
    }),
  });
}

function parsePolicy(value: unknown): SecurityScanPolicy008 {
  if (
    !record(value) ||
    !exact(value, [
      "schemaVersion",
      "id",
      "version",
      "contour",
      "reportMaximumAgeMs",
      "databaseMaximumAgeMs",
      "acceptedRiskSeverities",
      "scanners",
      "dependencySnapshot",
      "acceptedFindings",
    ]) ||
    value.schemaVersion !== 1 ||
    value.contour !== "DEVELOPMENT_MOCKS"
  )
    throw new Error("SCAN_POLICY_INVALID");
  if (
    typeof value.id !== "string" ||
    !versionPattern.test(String(value.version)) ||
    typeof value.reportMaximumAgeMs !== "number" ||
    typeof value.databaseMaximumAgeMs !== "number" ||
    value.reportMaximumAgeMs <= 0 ||
    value.databaseMaximumAgeMs <= 0
  )
    throw new Error("SCAN_POLICY_INVALID");
  if (
    !Array.isArray(value.acceptedRiskSeverities) ||
    value.acceptedRiskSeverities.some((item) => !["MODERATE", "LOW"].includes(String(item))) ||
    !record(value.scanners) ||
    !exact(value.scanners, ["DEPENDENCY", "IMAGE"]) ||
    !validRef(value.scanners.DEPENDENCY) ||
    !validRef(value.scanners.IMAGE)
  )
    throw new Error("SCAN_POLICY_INVALID");
  if (
    !record(value.dependencySnapshot) ||
    !exact(value.dependencySnapshot, ["path", "sha256", "lockDigest"]) ||
    typeof value.dependencySnapshot.path !== "string" ||
    typeof value.dependencySnapshot.sha256 !== "string" ||
    !digestPattern.test(value.dependencySnapshot.sha256) ||
    typeof value.dependencySnapshot.lockDigest !== "string" ||
    !digestPattern.test(value.dependencySnapshot.lockDigest)
  )
    throw new Error("SCAN_POLICY_INVALID");
  if (
    !Array.isArray(value.acceptedFindings) ||
    value.acceptedFindings.some(
      (item) =>
        !record(item) ||
        !exact(item, ["id", "severity", "owner", "expiresAt"]) ||
        typeof item.id !== "string" ||
        !["MODERATE", "LOW"].includes(String(item.severity)) ||
        typeof item.owner !== "string" ||
        !Number.isFinite(time(item.expiresAt)),
    )
  )
    throw new Error("SCAN_POLICY_INVALID");
  return value as unknown as SecurityScanPolicy008;
}
function parseDatabase(value: unknown) {
  if (
    !record(value) ||
    !exact(value, ["schemaVersion", "id", "version", "publishedAt", "evidenceMode", "coverage"]) ||
    value.schemaVersion !== 1 ||
    value.evidenceMode !== "DEVELOPMENT_MOCKS" ||
    typeof value.id !== "string" ||
    !versionPattern.test(String(value.version)) ||
    !Number.isFinite(time(value.publishedAt)) ||
    !Array.isArray(value.coverage) ||
    value.coverage.join(",") !== "DEPENDENCY_ADAPTER,IMAGE_ADAPTER"
  )
    throw new Error("SCANNER_DATABASE_INVALID");
  return {
    id: value.id,
    version: value.version as string,
    publishedAt: value.publishedAt as string,
  };
}
function imageDigest(): string | null {
  const result = spawnSync(
    "docker",
    ["image", "inspect", "awp-local-node:24.20.0", "--format", "{{.Id}}"],
    { cwd: ROOT_008, encoding: "utf8", timeout: 15_000 },
  );
  const value = result.status === 0 ? result.stdout.trim() : "";
  return digestPattern.test(value) ? value : null;
}
function advisoryId(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    return new URL(value).pathname.split("/").filter(Boolean).at(-1) ?? "";
  } catch {
    return "";
  }
}

async function run(): Promise<void> {
  if (process.argv.slice(2).some((value) => value !== "--"))
    throw new Error("UNKNOWN_SECURITY_SCANS_ARGUMENT");
  const startedAt = new Date().toISOString(),
    baseFingerprints = currentFingerprints008(),
    now = Date.now();
  const policyPath = "config/pilot/development-scan-policy.json",
    databasePath = "config/pilot/development-scanner-database.json";
  const policyBytes = readFileSync(safeFile(ROOT_008, policyPath)),
    databaseBytes = readFileSync(safeFile(ROOT_008, databasePath)),
    policy = parsePolicy(JSON.parse(policyBytes.toString())),
    database = parseDatabase(JSON.parse(databaseBytes.toString()));
  const policyDigest = hashBytes(policyBytes),
    databaseDigest = hashBytes(databaseBytes),
    lockDigest = hashBytes(readFileSync(safeFile(ROOT_008, "pnpm-lock.yaml"))),
    image = imageDigest();
  const snapshotBytes = readFileSync(safeFile(ROOT_008, policy.dependencySnapshot.path)),
    snapshotStat = statSync(safeFile(ROOT_008, policy.dependencySnapshot.path));
  const snapshot = JSON.parse(snapshotBytes.toString()) as {
    advisories?: Record<
      string,
      {
        module_name?: unknown;
        severity?: unknown;
        patched_versions?: unknown;
        url?: unknown;
        findings?: readonly { version?: unknown }[];
      }
    >;
  };
  const dependencyFindings = Object.values(snapshot.advisories ?? {}).map((item) => {
    const id = advisoryId(item.url),
      accepted = policy.acceptedFindings.find((value) => value.id === id);
    return {
      id,
      component: String(item.module_name ?? "unknown"),
      installedVersion: String(item.findings?.[0]?.version ?? "unknown"),
      severity: String(item.severity ?? "").toUpperCase() as ScanSeverity008,
      status: "ACCEPTED_RISK" as const,
      fixedVersion: String(item.patched_versions ?? ""),
      owner: accepted?.owner,
      expiresAt: accepted?.expiresAt,
    };
  });
  const common = {
    schemaVersion: "security-scan@1.0.0" as const,
    contour: "DEVELOPMENT_MOCKS" as const,
    coverage: "ADAPTER_FIXTURE" as const,
    database: { ...database, digest: databaseDigest },
    policy: { id: policy.id, version: policy.version, digest: policyDigest },
  };
  const dependencyReport = {
    ...common,
    kind: "DEPENDENCY" as const,
    artifact: { kind: "LOCKFILE" as const, digest: lockDigest },
    scanner: policy.scanners.DEPENDENCY,
    scannedAt: snapshotStat.mtime.toISOString(),
    findings: dependencyFindings,
  };
  const imageReport = image
    ? {
        ...common,
        kind: "IMAGE" as const,
        artifact: { kind: "OCI_IMAGE" as const, digest: image },
        scanner: policy.scanners.IMAGE,
        scannedAt: new Date(now).toISOString(),
        findings: [],
      }
    : null;
  const expectation = (kind: ScanKind008, artifactDigest: string): SecurityScanExpectation008 => ({
    kind,
    contour: "DEVELOPMENT_MOCKS",
    artifactDigest,
    requiredCoverage: "ADAPTER_FIXTURE",
    scanner: policy.scanners[kind],
    database: { ...database, digest: databaseDigest },
    policy: {
      id: policy.id,
      version: policy.version,
      digest: policyDigest,
      reportMaximumAgeMs: policy.reportMaximumAgeMs,
      databaseMaximumAgeMs: policy.databaseMaximumAgeMs,
      acceptedRiskSeverities: policy.acceptedRiskSeverities,
      acceptedFindings: policy.acceptedFindings,
    },
    now,
  });
  const dependencyPins =
    policy.dependencySnapshot.sha256 === hashBytes(snapshotBytes) &&
    policy.dependencySnapshot.lockDigest === lockDigest;
  const dependencyEvaluation = dependencyPins
    ? evaluateSecurityScan008(dependencyReport, expectation("DEPENDENCY", lockDigest))
    : {
        status: "BLOCKED_INPUT" as GateStatus008,
        releaseEligible: false,
        reasonCodes: ["DEPENDENCY_SNAPSHOT_PIN_MISMATCH"],
        measurements: { critical: null, high: null, moderate: null, low: null, open: null },
      };
  const imageEvaluation = evaluateSecurityScan008(
    imageReport,
    expectation("IMAGE", image ?? `sha256:${"0".repeat(64)}`),
  );
  const runId = `scans-${randomUUID()}`,
    evidencePath = `reports/${FEATURE_008}/evidence/${runId}/security-scans.json`;
  write008Json(evidencePath, {
    mode: "DEVELOPMENT_MOCKS",
    releaseScan: "BLOCKED_INPUT",
    policyRef: { path: policyPath, sha256: policyDigest },
    databaseRef: { path: databasePath, sha256: databaseDigest },
    dependency: { report: dependencyReport, evaluation: dependencyEvaluation },
    image: { report: imageReport, evaluation: imageEvaluation },
  });
  const unchanged = JSON.stringify(currentFingerprints008()) === JSON.stringify(baseFingerprints),
    fingerprints: Fingerprints008 = image
      ? { ...baseFingerprints, image, scannerDatabase: databaseDigest }
      : { ...baseFingerprints, scannerDatabase: databaseDigest },
    scope = { workspaceId: "fixture-workspace-alpha", projectIds: ["fixture-project-web"] };
  const passed =
    dependencyEvaluation.status === "PASS" && imageEvaluation.status === "PASS" && unchanged;
  const evidence = [evidenceRef008(ROOT_008, evidencePath)];
  const report: GateReport008 = {
    schemaVersion: 1,
    feature: FEATURE_008,
    runId,
    gate: "security-scans",
    status: passed ? "PASS" : "BLOCKED_INPUT",
    deploymentProfile: "local",
    scope,
    startedAt,
    finishedAt: new Date().toISOString(),
    fingerprints,
    executorIdentity: "local-cli",
    prerequisites: [],
    reasonCodes: passed ? [] : ["SECURITY_SCAN_ADAPTER_BLOCKED"],
    checks: [
      {
        id: "dependency-scan-adapter",
        status: dependencyEvaluation.status,
        evidence,
        reasonCodes: dependencyEvaluation.reasonCodes,
      },
      {
        id: "image-scan-adapter",
        status: imageEvaluation.status,
        evidence,
        reasonCodes: imageEvaluation.reasonCodes,
      },
      {
        id: "unchanged-source",
        status: unchanged ? "PASS" : "FAIL",
        evidence,
        reasonCodes: unchanged ? [] : ["SOURCE_CHANGED"],
      },
    ],
  };
  const ref = writeGateReport008(ROOT_008, report, {
    now: Date.now(),
    maximumAgeMs: 3_600_000,
    scope,
    fingerprints,
    allowedExecutors: ["local-cli"],
  });
  write008Json(`reports/${FEATURE_008}/security-scans.json`, {
    status: report.status,
    report: ref,
    mode: "DEVELOPMENT_MOCKS",
    releaseEligibility: "BLOCKED_INPUT",
    imageDigest: image,
    scannerDatabase: databaseDigest,
  });
  console.log(
    `[verify:008:scans] ${report.status}; dependency=${dependencyEvaluation.status}; imageAdapter=${imageEvaluation.status}; release=BLOCKED_INPUT; report=${ref.path}`,
  );
  if (!passed) process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await run();
