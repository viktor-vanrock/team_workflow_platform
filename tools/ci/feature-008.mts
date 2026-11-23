import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";

import {
  FEATURE_008,
  hashBytes,
  record,
  ROOT_008,
  safeFile,
  write008Json,
} from "../verification/feature-008-prerequisites.mts";
import { currentFingerprints008 } from "../verification/feature-008-reports.mts";

if (process.argv.slice(2).some((value) => value !== "--"))
  throw new Error("UNKNOWN_CI_008_ARGUMENT");
const startedAt = new Date().toISOString();
const pathEnvironment = [dirname(process.execPath), process.env.PATH]
  .filter(Boolean)
  .join(delimiter);
const stages: Array<Readonly<Record<string, unknown>>> = [];
let localFailed = false;

function execute(
  id: string,
  executable: string,
  args: readonly string[],
  mandatory = true,
  timeout = 900_000,
): number {
  console.log(`[ci:008] ${id}`);
  const run = spawnSync(executable, [...args], {
    cwd: ROOT_008,
    env: { ...process.env, CI: "true", PATH: pathEnvironment },
    encoding: "utf8",
    timeout,
    maxBuffer: 100_000_000,
  });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  const status = run.status === 0 && run.error === undefined ? "PASS" : "FAIL";
  if (mandatory && status === "FAIL") localFailed = true;
  stages.push(
    Object.freeze({
      id,
      status,
      mandatory,
      exitCode: run.status ?? 1,
      outputSha256: hashBytes(`${run.stdout ?? ""}\n${run.stderr ?? ""}`),
    }),
  );
  return run.status ?? 1;
}

// A feature subset cannot substitute for strict root compilation and full regression.
execute("project-regression", "pnpm", ["ci:project"], true, 5_400_000);

// Run the broad foundation suite before the migration matrix so both groups get
// an otherwise idle container runtime. A slow local Docker startup may make the
// suite exceed the default stage budget even though each child command remains
// independently bounded.
execute(
  "foundation",
  process.execPath,
  ["tools/verification/008-foundation-checkpoint.mts"],
  true,
  1_800_000,
);
for (const [id, path] of [
  ["compatibility", "tools/verification/008-compatibility.mts"],
  ["migrations", "tools/ci/verify-008-migrations.mts"],
  ["quickstart", "tools/verification/008-quickstart.mts"],
] as const)
  execute(id, process.execPath, [path]);

execute("us1-development-up", "pnpm", ["dev:pilot:up"]);
try {
  execute("us1", process.execPath, ["tools/verification/008-us1-checkpoint.mts"]);
  execute("audit-coverage", process.execPath, ["tools/verification/008-audit-coverage.mts"]);
} finally {
  execute("us1-development-down", "pnpm", ["dev:pilot:down"]);
}

execute("us2", process.execPath, ["tools/verification/008-us2-checkpoint.mts"]);
for (const [id, path] of [
  ["hermes", "tools/verification/008-hermes-evaluation.mts"],
  ["security-scans", "tools/verification/008-security-scans.mts"],
  ["security", "tools/verification/feature-008-security.mts"],
] as const)
  execute(id, process.execPath, [path]);
for (const [id, path] of [
  ["us3", "tools/verification/008-us3-checkpoint.mts"],
  ["us4", "tools/verification/008-us4-checkpoint.mts"],
  ["us5", "tools/verification/008-us5-checkpoint.mts"],
  ["smoke", "tools/smoke/feature-008.mts"],
  ["trace", "tools/verification/feature-008-trace.mts"],
] as const)
  execute(id, process.execPath, [path]);

const fingerprints = currentFingerprints008();
const childPaths = Object.freeze([
  "reports/008-pilot-hardening-and-conformance/compatibility.json",
  "reports/008-pilot-hardening-and-conformance/migrations.json",
  "reports/008-pilot-hardening-and-conformance/foundation.json",
  "reports/008-pilot-hardening-and-conformance/quickstart.json",
  "reports/008-pilot-hardening-and-conformance/us1.json",
  "reports/008-pilot-hardening-and-conformance/us2.json",
  "reports/008-pilot-hardening-and-conformance/hermes.json",
  "reports/008-pilot-hardening-and-conformance/audit-coverage.json",
  "reports/008-pilot-hardening-and-conformance/security-scans.json",
  "reports/008-pilot-hardening-and-conformance/security.json",
  "reports/008-pilot-hardening-and-conformance/us3.json",
  "reports/008-pilot-hardening-and-conformance/us4.json",
  "reports/008-pilot-hardening-and-conformance/us5.json",
  "reports/008-pilot-hardening-and-conformance/smoke.json",
  "reports/008-pilot-hardening-and-conformance/trace.json",
]);
const children = childPaths.map((path) => {
  try {
    const bytes = readFileSync(safeFile(ROOT_008, path));
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!record(value)) throw new Error("CHILD_INVALID");
    const childPass = path.endsWith("/trace.json")
      ? value.localEngineeringStatus === "PASS"
      : value.status === "PASS";
    if (!childPass) throw new Error("CHILD_NOT_PASS");
    let immutableReport: Readonly<Record<string, unknown>> | undefined;
    if (
      record(value.report) &&
      typeof value.report.path === "string" &&
      typeof value.report.sha256 === "string"
    ) {
      const reportBytes = readFileSync(safeFile(ROOT_008, value.report.path));
      if (hashBytes(reportBytes) !== value.report.sha256)
        throw new Error("CHILD_REPORT_DIGEST_MISMATCH");
      const report: unknown = JSON.parse(reportBytes.toString("utf8"));
      const reportFingerprints =
        record(report) && record(report.fingerprints) ? report.fingerprints : undefined;
      const matchesCurrentSource =
        reportFingerprints !== undefined &&
        Object.entries(fingerprints).every(
          ([key, expected]) => reportFingerprints[key] === expected,
        );
      if (!record(report) || report.status !== "PASS" || !matchesCurrentSource)
        throw new Error("CHILD_REPORT_SOURCE_MISMATCH");
      immutableReport = Object.freeze({ path: value.report.path, sha256: value.report.sha256 });
    }
    return Object.freeze({
      path,
      sha256: hashBytes(bytes),
      status: "PASS",
      ...(immutableReport ? { immutableReport } : {}),
    });
  } catch (error) {
    localFailed = true;
    return Object.freeze({
      path,
      status: "FAIL",
      reasonCode: error instanceof Error ? error.message : "CHILD_INVALID",
    });
  }
});

const localReport = Object.freeze({
  schemaVersion: 1,
  feature: FEATURE_008,
  gate: "local-engineering",
  startedAt,
  finishedAt: new Date().toISOString(),
  status: localFailed ? "FAIL" : "PASS",
  mode: "DEVELOPMENT_MOCKS",
  localEngineeringReady: !localFailed,
  corporateReady: false,
  fingerprints,
  stages,
  children,
});
write008Json(`reports/${FEATURE_008}/local.json`, localReport);

// Refresh each corporate boundary as an explicit BLOCKED_INPUT artifact. Their
// nonzero exits are expected while no real corporate input/evidence is supplied.
for (const [id, path] of [
  ["corporate-inputs", "tools/verification/feature-008-inputs.mts"],
  ["corporate-integration", "tools/verification/feature-008-integration.mts"],
  ["corporate-recovery", "tools/verification/feature-008-recovery.mts"],
  ["corporate-shadow", "tools/verification/feature-008-shadow.mts"],
  ["corporate-review", "tools/verification/feature-008-review.mts"],
] as const)
  execute(id, process.execPath, [path], false, 180_000);

function readinessEvidence(
  path: string,
  nestedStatus?: (value: Record<string, unknown>) => unknown,
): Readonly<Record<string, unknown>> {
  if (!existsSync(resolve(ROOT_008, path)))
    return Object.freeze({
      path: null,
      sha256: null,
      status: "BLOCKED_INPUT",
      reasonCode: "EVIDENCE_MISSING",
    });
  const bytes = readFileSync(safeFile(ROOT_008, path));
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  return Object.freeze({
    path,
    sha256: hashBytes(bytes),
    status: record(value)
      ? nestedStatus
        ? nestedStatus(value)
        : (value.status ?? "BLOCKED_INPUT")
      : "BLOCKED_INPUT",
  });
}
const corporate = Object.freeze({
  inputs: readinessEvidence(`reports/${FEATURE_008}/input-validation.json`),
  integration: readinessEvidence(`reports/${FEATURE_008}/integration.json`),
  security: readinessEvidence(`reports/${FEATURE_008}/security.json`, (value) =>
    record(value.corporateRelease) ? value.corporateRelease.status : "BLOCKED_INPUT",
  ),
  recovery: readinessEvidence(`reports/${FEATURE_008}/recovery.json`),
  shadow: readinessEvidence(`reports/${FEATURE_008}/shadow.json`),
  limitedPilot: readinessEvidence(`reports/${FEATURE_008}/limited-pilot.json`),
  review: readinessEvidence(`reports/${FEATURE_008}/review.json`),
});
const corporateReady = Object.values(corporate).every((item) => item.status === "PASS");
const localPath = `reports/${FEATURE_008}/local.json`;
const localBytes = readFileSync(safeFile(ROOT_008, localPath));
const readiness = Object.freeze({
  schemaVersion: 1,
  feature: FEATURE_008,
  gate: "readiness",
  generatedAt: new Date().toISOString(),
  status:
    localReport.status === "PASS" && corporateReady
      ? "PASS"
      : localReport.status === "PASS"
        ? "BLOCKED_INPUT"
        : "FAIL",
  localEngineering: Object.freeze({
    path: localPath,
    sha256: hashBytes(localBytes),
    status: localReport.status,
    ready: localReport.localEngineeringReady,
  }),
  corporate: Object.freeze({
    status: corporateReady ? "PASS" : "BLOCKED_INPUT",
    ready: corporateReady,
    evidence: corporate,
  }),
  reasonCodes: corporateReady
    ? []
    : [
        "CORPORATE_C1_INPUT_REQUIRED",
        "CORPORATE_N2_CONFORMANCE_REQUIRED",
        "CORPORATE_RELEASE_SCAN_REQUIRED",
        "CORPORATE_RECOVERY_DRILL_REQUIRED",
        "CORPORATE_SHADOW_REQUIRED",
        "OBSERVED_LIMITED_PILOT_REQUIRED",
        "HUMAN_PILOT_REVIEW_REQUIRED",
      ],
  fullFeatureClosure: localReport.status === "PASS" && corporateReady,
});
write008Json(`reports/${FEATURE_008}/readiness.json`, readiness);
console.log(
  `[ci:008] local=${localReport.status}; corporate=${corporateReady ? "PASS" : "BLOCKED_INPUT"}; readiness=${readiness.status}`,
);
if (localFailed) process.exitCode = 1;
