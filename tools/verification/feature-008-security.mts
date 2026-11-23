import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { evaluateSecurityScan008, type SecurityScanExpectation008 } from "./008-security-scans.mts";
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
  type EvidenceRef008,
  evidenceRef008,
  type Fingerprints008,
  type GateCheck008,
  type GateReport008,
  type GateStatus008,
  readGateReport008,
  writeGateReport008,
} from "./feature-008-reports.mts";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const ref = (value: unknown): value is { readonly id: string; readonly version: string } =>
  record(value) &&
  exact(value, ["id", "version"]) &&
  typeof value.id === "string" &&
  value.id.length > 0 &&
  typeof value.version === "string" &&
  value.version.length > 0;
const database = (value: unknown): value is SecurityScanExpectation008["database"] =>
  record(value) &&
  exact(value, ["id", "version", "digest", "publishedAt"]) &&
  ref({ id: value.id, version: value.version }) &&
  typeof value.digest === "string" &&
  digestPattern.test(value.digest) &&
  typeof value.publishedAt === "string" &&
  Number.isFinite(Date.parse(value.publishedAt));

export function evaluateReleaseSecurity008(
  value: unknown,
  actualImageDigest: string | null,
  now: number,
) {
  if (!actualImageDigest || !digestPattern.test(actualImageDigest))
    return Object.freeze({
      status: "BLOCKED_INPUT" as GateStatus008,
      releaseEligible: false,
      reasonCodes: Object.freeze(["RELEASE_IMAGE_DIGEST_MISSING"]),
      imageDigest: null,
      scannerDatabase: null,
    });
  if (
    !record(value) ||
    !exact(value, ["schemaVersion", "scanner", "database", "policy", "report"]) ||
    value.schemaVersion !== "release-security@1.0.0" ||
    !ref(value.scanner) ||
    !database(value.database) ||
    !record(value.policy) ||
    !exact(value.policy, [
      "id",
      "version",
      "digest",
      "reportMaximumAgeMs",
      "databaseMaximumAgeMs",
      "acceptedRiskSeverities",
      "acceptedFindings",
    ])
  )
    return Object.freeze({
      status: "BLOCKED_INPUT" as GateStatus008,
      releaseEligible: false,
      reasonCodes: Object.freeze(["RELEASE_SCAN_BUNDLE_INVALID"]),
      imageDigest: actualImageDigest,
      scannerDatabase: null,
    });
  const policy = value.policy;
  if (
    typeof policy.id !== "string" ||
    typeof policy.version !== "string" ||
    typeof policy.digest !== "string" ||
    !digestPattern.test(policy.digest) ||
    typeof policy.reportMaximumAgeMs !== "number" ||
    policy.reportMaximumAgeMs <= 0 ||
    typeof policy.databaseMaximumAgeMs !== "number" ||
    policy.databaseMaximumAgeMs <= 0 ||
    !Array.isArray(policy.acceptedRiskSeverities) ||
    policy.acceptedRiskSeverities.some((item) => !["MODERATE", "LOW"].includes(String(item))) ||
    !Array.isArray(policy.acceptedFindings) ||
    policy.acceptedFindings.some(
      (item) =>
        !record(item) ||
        !exact(item, ["id", "severity", "owner", "expiresAt"]) ||
        typeof item.id !== "string" ||
        !["MODERATE", "LOW"].includes(String(item.severity)) ||
        typeof item.owner !== "string" ||
        typeof item.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(item.expiresAt)),
    )
  )
    return Object.freeze({
      status: "BLOCKED_INPUT" as GateStatus008,
      releaseEligible: false,
      reasonCodes: Object.freeze(["RELEASE_SCAN_BUNDLE_INVALID"]),
      imageDigest: actualImageDigest,
      scannerDatabase: value.database.digest,
    });
  const expectation: SecurityScanExpectation008 = {
    kind: "IMAGE",
    contour: "CORPORATE",
    artifactDigest: actualImageDigest,
    requiredCoverage: "FULL",
    scanner: value.scanner,
    database: value.database,
    policy: policy as unknown as SecurityScanExpectation008["policy"],
    now,
  };
  const result = evaluateSecurityScan008(value.report, expectation);
  return Object.freeze({
    ...result,
    imageDigest: actualImageDigest,
    scannerDatabase: value.database.digest,
  });
}

function localImageDigest(): string | null {
  const result = spawnSync(
    "docker",
    ["image", "inspect", "awp-local-node:24.20.0", "--format", "{{.Id}}"],
    { cwd: ROOT_008, encoding: "utf8", timeout: 15_000 },
  );
  const value = result.status === 0 ? result.stdout.trim() : "";
  return digestPattern.test(value) ? value : null;
}
function corporateEvidence(): unknown {
  const path = process.env.AWP_008_RELEASE_SCAN_BUNDLE?.trim();
  if (!path) return null;
  return JSON.parse(readFileSync(safeFile(ROOT_008, path), "utf8")) as unknown;
}

async function run(): Promise<void> {
  if (process.argv.slice(2).some((value) => value !== "--"))
    throw new Error("UNKNOWN_SECURITY_ARGUMENT");
  const runId = `security-${randomUUID()}`,
    startedAt = new Date().toISOString(),
    base = currentFingerprints008(),
    image = localImageDigest();
  const databasePath = "config/pilot/development-scanner-database.json",
    scannerDatabase = hashBytes(readFileSync(safeFile(ROOT_008, databasePath)));
  const fingerprints: Fingerprints008 = image
      ? { ...base, image, scannerDatabase }
      : { ...base, scannerDatabase },
    scope = { workspaceId: "fixture-workspace-alpha", projectIds: ["fixture-project-web"] };
  const checks: GateCheck008[] = [],
    prerequisites: EvidenceRef008[] = [];
  const check = (
    id: string,
    status: GateStatus008,
    evidence: unknown,
    reasonCodes: readonly string[] = [],
  ): void => {
    const path = `reports/${FEATURE_008}/evidence/${runId}/${id}.json`;
    write008Json(path, evidence);
    checks.push({ id, status, evidence: [evidenceRef008(ROOT_008, path)], reasonCodes });
    console.log(`[security:008] ${id}: ${status}`);
  };
  try {
    const summary = JSON.parse(
      readFileSync(safeFile(ROOT_008, `reports/${FEATURE_008}/security-scans.json`), "utf8"),
    ) as { report: EvidenceRef008 };
    const scan = readGateReport008(ROOT_008, summary.report, {
      now: Date.now(),
      maximumAgeMs: 3_600_000,
      scope,
      fingerprints,
      allowedExecutors: ["local-cli"],
    });
    if (
      scan.gate !== "security-scans" ||
      scan.status !== "PASS" ||
      scan.fingerprints.image !== image ||
      scan.fingerprints.scannerDatabase !== scannerDatabase
    )
      throw new Error("SECURITY_SCAN_ADAPTER_REQUIRED");
    prerequisites.push(summary.report);
    check("scan-adapter-binding", "PASS", {
      report: summary.report,
      imageDigest: image,
      scannerDatabase,
    });
  } catch (error) {
    check(
      "scan-adapter-binding",
      "FAIL",
      { reasonCode: error instanceof Error ? error.message : "SECURITY_SCAN_ADAPTER_REQUIRED" },
      ["FRESH_SECURITY_SCAN_ADAPTER_REQUIRED"],
    );
  }
  const args = [
    "node_modules/vitest/vitest.mjs",
    "run",
    "tests/integration/security/008/access-boundaries.spec.ts",
    "tests/integration/security/008/exact-approvals.spec.ts",
    "tests/integration/security/008/secret-canaries.spec.ts",
    "tests/integration/security/008/network-policy.spec.ts",
    "tests/integration/security/008/secret-resolution.spec.ts",
    "tests/integration/security/008/telemetry-redaction.spec.ts",
    "tests/integration/security/008/identity-tokens.spec.ts",
    "tests/integration/security/008/corporate-identity.spec.ts",
    "tests/integration/security/008/corporate-sessions.spec.ts",
    "tests/integration/security/008/corporate-auth-http.spec.ts",
    "tests/unit/008/security-scans.spec.ts",
    "tests/unit/008/hermes-evaluation.spec.ts",
    "tests/unit/008/hermes-model-boundary.spec.ts",
    "--maxWorkers=1",
  ];
  const environment = {
    ...process.env,
    CI: "true",
    AWP_RUN_CONTAINER_TESTS: "true",
    PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter),
  };
  const local = spawnSync(process.execPath, args, {
      cwd: ROOT_008,
      env: environment,
      encoding: "utf8",
      timeout: 600_000,
      maxBuffer: 5_000_000,
    }),
    output = `${local.stdout ?? ""}${local.stderr ?? ""}`;
  process.stdout.write(output);
  check(
    "local-adversarial-suite",
    local.status === 0 && !local.error ? "PASS" : "FAIL",
    { command: args, exitCode: local.status, durationBoundMs: 600_000, output },
    local.status === 0 && !local.error ? [] : ["LOCAL_ADVERSARIAL_SUITE_FAILED"],
  );
  const release = evaluateReleaseSecurity008(
    corporateEvidence(),
    process.env.AWP_008_RELEASE_IMAGE_DIGEST?.trim() || null,
    Date.now(),
  );
  const releasePath = `reports/${FEATURE_008}/evidence/${runId}/corporate-release.json`;
  write008Json(releasePath, {
    status: release.status,
    releaseEligible: release.releaseEligible,
    reasonCodes: release.reasonCodes,
    imageDigest: release.imageDigest,
    scannerDatabase: release.scannerDatabase,
    inputRef: process.env.AWP_008_RELEASE_SCAN_BUNDLE ?? null,
  });
  const unchanged = JSON.stringify(currentFingerprints008()) === JSON.stringify(base);
  check(
    "unchanged-source",
    unchanged ? "PASS" : "FAIL",
    { fingerprints: base },
    unchanged ? [] : ["SOURCE_CHANGED"],
  );
  const failed = checks.some((item) => item.status !== "PASS"),
    report: GateReport008 = {
      schemaVersion: 1,
      feature: FEATURE_008,
      runId,
      gate: "security",
      status: failed ? "FAIL" : "PASS",
      deploymentProfile: "local",
      scope,
      startedAt,
      finishedAt: new Date().toISOString(),
      fingerprints,
      executorIdentity: "local-cli",
      checks,
      prerequisites,
      reasonCodes: failed ? ["LOCAL_SECURITY_FAILED"] : [],
    };
  const reportRef = writeGateReport008(ROOT_008, report, {
    now: Date.now(),
    maximumAgeMs: 3_600_000,
    scope,
    fingerprints,
    allowedExecutors: ["local-cli"],
  });
  write008Json(`reports/${FEATURE_008}/security.json`, {
    status: report.status,
    report: reportRef,
    mode: "DEVELOPMENT_MOCKS",
    corporateRelease: {
      status: release.status,
      releaseEligible: release.releaseEligible,
      evidence: evidenceRef008(ROOT_008, releasePath),
    },
  });
  console.log(
    `[verify:008:security] local=${report.status}; corporateRelease=${release.status}; report=${reportRef.path}`,
  );
  if (failed) process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await run();
