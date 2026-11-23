import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";

import { FEATURE_008, hashBytes, ROOT_008, write008Json } from "./feature-008-prerequisites.mts";
import {
  currentFingerprints008,
  type EvidenceRef008,
  evidenceRef008,
  type GateCheck008,
  type GateReport008,
  readGateReport008,
  writeGateReport008,
} from "./feature-008-reports.mts";

if (process.argv.slice(2).some((value) => value !== "--")) throw new Error("UNKNOWN_US1_ARGUMENT");
const runId = `us1-${randomUUID()}`;
const startedAt = new Date().toISOString();
const scope = { workspaceId: "fixture-workspace-alpha", projectIds: ["fixture-project-web"] };
const fingerprints = currentFingerprints008();
const checks: GateCheck008[] = [];
const prerequisites: EvidenceRef008[] = [];
const options = () => ({
  now: Date.now(),
  maximumAgeMs: 3600_000,
  scope,
  fingerprints,
  allowedExecutors: ["local-cli"],
});
function check(id: string, passed: boolean, evidence: unknown) {
  const path = `reports/${FEATURE_008}/evidence/${runId}/${id}.json`;
  write008Json(path, evidence);
  checks.push({
    id,
    status: passed ? "PASS" : "FAIL",
    evidence: [evidenceRef008(ROOT_008, path)],
    reasonCodes: passed ? [] : ["US1_CHECK_FAILED"],
  });
  console.log(`[us1:008] ${id}: ${passed ? "PASS" : "FAIL"}`);
}
// Reuse only a fresh, immutable and source-bound full run. Never accept a summary PASS alone.
try {
  const summary = JSON.parse(
    readFileSync(resolve(ROOT_008, `reports/${FEATURE_008}/foundation.json`), "utf8"),
  ) as { report: EvidenceRef008 };
  const foundation = readGateReport008(ROOT_008, summary.report, options());
  if (
    foundation.gate !== "foundation" ||
    foundation.deploymentProfile !== "local" ||
    foundation.status !== "PASS"
  )
    throw new Error("FOUNDATION_REQUIRED");
  const required = [
    "entry-and-published-history",
    "boundaries-and-databases",
    "unit-and-contract-boundaries",
    "identity-security-boundaries",
    "development-runtime",
    "published-runtime-configuration",
    "qa-http-regression",
    "corporate-browser-correlation",
    "typecheck",
    "worker-typecheck",
    "api-typecheck",
    "web-typecheck",
    "architecture",
    "lint",
    "unchanged-source",
  ];
  for (const id of required) {
    const child = foundation.checks.find((value) => value.id === id);
    if (!child || child.status !== "PASS" || !child.evidence.length)
      throw new Error("FOUNDATION_REQUIRED_CHECK_MISSING");
    checks.push({ ...child, id: `foundation-${id}` });
  }
  prerequisites.push(summary.report);
} catch {
  check("foundation-prerequisite", false, {
    reasonCode: "FRESH_FOUNDATION_REQUIRED",
    command: "pnpm verify:008:foundation",
  });
}
if (prerequisites.length) {
  const environment = {
    ...process.env,
    PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter),
  };
  for (const [id, args] of [
    ["development-launch-plan", ["tools/local/pilot-cli.mts", "up", "--plan"]],
    ["development-stack-browser-worker", ["tools/smoke/008-development.mts"]],
  ] as const) {
    const result = spawnSync(process.execPath, args, {
      cwd: ROOT_008,
      env: environment,
      encoding: "utf8",
      timeout: 150_000,
      maxBuffer: 2_000_000,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    check(id, result.status === 0 && !result.error, {
      command: args,
      exitCode: result.status,
      output,
    });
  }
}
const files = [
  "infra/compose/docker-compose.local.yml",
  "infra/compose/docker/node-runtime.Dockerfile",
  "infra/observability/otel-collector.yaml",
];
check("development-infrastructure", true, {
  files: files.map((path) => ({ path, sha256: hashBytes(readFileSync(resolve(ROOT_008, path))) })),
  mode: "DEVELOPMENT_MOCKS",
  corporateReady: false,
  corporateConformance: "BLOCKED_INPUT",
  requires: ["C1", "N2", "P3"],
});
check(
  "unchanged-source",
  JSON.stringify(currentFingerprints008()) === JSON.stringify(fingerprints),
  { fingerprints },
);
const failed = checks.some((value) => value.status !== "PASS");
const report: GateReport008 = {
  schemaVersion: 1,
  feature: FEATURE_008,
  runId,
  gate: "us1",
  status: failed ? "FAIL" : "PASS",
  deploymentProfile: "local",
  scope,
  startedAt,
  finishedAt: new Date().toISOString(),
  fingerprints,
  executorIdentity: "local-cli",
  checks,
  prerequisites,
  reasonCodes: failed ? ["US1_FAILED"] : [],
};
const ref = writeGateReport008(ROOT_008, report, options());
write008Json(`reports/${FEATURE_008}/us1.json`, {
  status: report.status,
  report: ref,
  mode: "DEVELOPMENT_MOCKS",
  corporateReady: false,
  corporateBindingConformance: "BLOCKED_INPUT",
});
console.log(`[verify:008:us1] ${report.status}; report=${ref.path}`);
if (failed) process.exitCode = 1;
