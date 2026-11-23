import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { FEATURE_008, ROOT_008, write008Json } from "./feature-008-prerequisites.mts";
import {
  currentFingerprints008,
  type EvidenceRef008,
  evidenceRef008,
  type GateCheck008,
  type GateReport008,
  readGateReport008,
  writeGateReport008,
} from "./feature-008-reports.mts";

if (process.argv.slice(2).some((value) => value !== "--")) throw new Error("UNKNOWN_US3_ARGUMENT");
const runId = `us3-${randomUUID()}`,
  startedAt = new Date().toISOString(),
  scope = { workspaceId: "fixture-workspace-alpha", projectIds: ["fixture-project-web"] },
  fingerprints = currentFingerprints008();
const checks: GateCheck008[] = [],
  prerequisites: EvidenceRef008[] = [];
const options = (targetScope = scope) => ({
  now: Date.now(),
  maximumAgeMs: 3_600_000,
  scope: targetScope,
  fingerprints,
  allowedExecutors: ["local-cli"],
});
const add = (
  id: string,
  passed: boolean,
  evidence: readonly EvidenceRef008[],
  detail: unknown,
): void => {
  const path = `reports/${FEATURE_008}/evidence/${runId}/${id}.json`;
  write008Json(path, detail);
  checks.push({
    id,
    status: passed ? "PASS" : "FAIL",
    evidence: [...evidence, evidenceRef008(ROOT_008, path)],
    reasonCodes: passed ? [] : ["US3_CHECK_FAILED"],
  });
  console.log(`[us3:008] ${id}: ${passed ? "PASS" : "FAIL"}`);
};
function summary(name: string): {
  readonly status?: string;
  readonly report: EvidenceRef008;
  readonly corporateRelease?: { readonly status?: string; readonly releaseEligible?: boolean };
} {
  return JSON.parse(
    readFileSync(resolve(ROOT_008, `reports/${FEATURE_008}/${name}.json`), "utf8"),
  ) as {
    status?: string;
    report: EvidenceRef008;
    corporateRelease?: { status?: string; releaseEligible?: boolean };
  };
}
for (const [name, gate, requiredChecks] of [
  ["foundation", "foundation", []],
  ["hermes", "hermes", ["hermes-corpus"]],
  ["security", "security", ["scan-adapter-binding", "local-adversarial-suite"]],
] as const) {
  try {
    const item = summary(name),
      report = readGateReport008(ROOT_008, item.report, options());
    const passed =
      report.gate === gate &&
      report.status === "PASS" &&
      requiredChecks.every((id) =>
        report.checks.some((check) => check.id === id && check.status === "PASS"),
      );
    if (!passed) throw new Error(`${gate.toUpperCase()}_REQUIRED`);
    prerequisites.push(item.report);
    add(`${name}-prerequisite`, true, [item.report], {
      gate: report.gate,
      status: report.status,
      requiredChecks,
    });
  } catch (error) {
    add(`${name}-prerequisite`, false, [], {
      reasonCode: error instanceof Error ? error.message : `${gate.toUpperCase()}_REQUIRED`,
    });
  }
}
try {
  const item = summary("audit-coverage"),
    auditScope = {
      workspaceId: "10000000-0000-4000-8000-000000000001",
      projectIds: ["20000000-0000-4000-8000-000000000001"],
    };
  const report = readGateReport008(ROOT_008, item.report, options(auditScope)),
    passed =
      report.gate === "audit-coverage" &&
      report.status === "PASS" &&
      report.checks.some(
        (check) => check.id === "effect-audit-coverage" && check.status === "PASS",
      );
  add("independent-audit-coverage", passed, [item.report], {
    gate: report.gate,
    status: report.status,
    scope: auditScope,
  });
} catch (error) {
  add("independent-audit-coverage", false, [], {
    reasonCode: error instanceof Error ? error.message : "AUDIT_COVERAGE_REQUIRED",
  });
}
let corporateStatus = "BLOCKED_INPUT",
  releaseEligible = false;
try {
  const security = summary("security");
  corporateStatus = security.corporateRelease?.status ?? "BLOCKED_INPUT";
  releaseEligible = security.corporateRelease?.releaseEligible === true;
} catch {
  /* represented by blocked status */
}
add("corporate-scan-separation", corporateStatus !== "PASS" && !releaseEligible, [], {
  corporateStatus,
  releaseEligible,
  requiredInputs: ["AWP_008_RELEASE_IMAGE_DIGEST", "AWP_008_RELEASE_SCAN_BUNDLE"],
  localCheckpointUnaffected: true,
});
const unchanged = JSON.stringify(currentFingerprints008()) === JSON.stringify(fingerprints);
add("unchanged-source", unchanged, [], { fingerprints });
const failed = checks.some((check) => check.status !== "PASS"),
  report: GateReport008 = {
    schemaVersion: 1,
    feature: FEATURE_008,
    runId,
    gate: "us3",
    status: failed ? "FAIL" : "PASS",
    deploymentProfile: "local",
    scope,
    startedAt,
    finishedAt: new Date().toISOString(),
    fingerprints,
    executorIdentity: "local-cli",
    checks,
    prerequisites,
    reasonCodes: failed ? ["US3_FAILED"] : [],
  };
const ref = writeGateReport008(ROOT_008, report, options());
write008Json(`reports/${FEATURE_008}/us3.json`, {
  status: report.status,
  report: ref,
  mode: "DEVELOPMENT_MOCKS",
  corporateScan: { status: corporateStatus, releaseEligible },
});
console.log(
  `[verify:008:us3] local=${report.status}; corporateScan=${corporateStatus}; report=${ref.path}`,
);
if (failed) process.exitCode = 1;
