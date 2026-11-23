import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";

import { validateCommandCatalog008 } from "./feature-008-command-catalog.mts";
import { validateInputPackage008 } from "./feature-008-inputs.mts";
import {
  FEATURE_008,
  ROOT_008,
  verifyFeature008Prerequisites,
  write008Json,
} from "./feature-008-prerequisites.mts";
import {
  currentFingerprints008,
  evidenceRef008,
  type GateCheck008,
  type GateReport008,
  writeGateReport008,
} from "./feature-008-reports.mts";
import { validateTraceRegistry008 } from "./feature-008-trace.mts";

if (process.argv.slice(2).filter((a) => a !== "--").length)
  throw new Error("UNKNOWN_SETUP_ARGUMENT");
const startedAt = new Date().toISOString(),
  runId = `setup-${randomUUID()}`,
  scope = { workspaceId: "fixture-workspace-alpha", projectIds: ["fixture-project-web"] };
const fingerprints = currentFingerprints008(),
  checks: GateCheck008[] = [];
function recordCheck(id: string, passed: boolean, result: unknown, reason: string): void {
  const path = `reports/${FEATURE_008}/evidence/${runId}/${id}.json`;
  write008Json(path, result);
  checks.push({
    id,
    status: passed ? "PASS" : "FAIL",
    evidence: [evidenceRef008(ROOT_008, path)],
    reasonCodes: passed ? [] : [reason],
  });
  console.log(`[setup:008] ${id}: ${passed ? "PASS" : "FAIL"}`);
}
const nodeVersion = readFileSync(resolve(ROOT_008, ".node-version"), "utf8").trim();
recordCheck(
  "runtime",
  process.versions.node === nodeVersion,
  { configured: nodeVersion, actual: process.versions.node },
  "NODE_VERSION_MISMATCH",
);
const prerequisite = verifyFeature008Prerequisites();
recordCheck("prerequisites", prerequisite.status === "PASS", prerequisite, "UPSTREAM_NOT_VERIFIED");
const catalog = validateCommandCatalog008();
recordCheck("catalog", catalog.length === 0, { errors: catalog }, "COMMAND_CATALOG_INVALID");
const inputs = validateInputPackage008(
  JSON.parse(readFileSync(resolve(ROOT_008, "config/pilot/local-inputs.json"), "utf8")) as unknown,
);
recordCheck("inputs", inputs.status === "PASS", inputs, "LOCAL_INPUTS_INVALID");
const trace = validateTraceRegistry008();
recordCheck(
  "trace-registry",
  trace.length === 0,
  {
    errors: trace,
    requirements: 31,
    successCriteria: 7,
    guardrails: 7,
    executionProof: "NOT_CLAIMED",
  },
  "TRACE_REGISTRY_INVALID",
);
const env = {
  ...process.env,
  CI: "true",
  PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter),
};
const commands = [
  {
    id: "contract-tests",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/contract/008/prerequisites.spec.ts",
      "tests/contract/008/inputs.spec.ts",
      "tests/contract/008/gate-reports.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "typecheck",
    args: ["node_modules/typescript/bin/tsc", "-p", "tests/008.tsconfig.json", "--pretty", "false"],
  },
  {
    id: "lint",
    args: [
      "node_modules/eslint/bin/eslint.js",
      "tools/verification/feature-008-prerequisites.mts",
      "tools/verification/feature-008-command-catalog.mts",
      "tools/verification/feature-008-inputs.mts",
      "tools/verification/feature-008-reports.mts",
      "tools/verification/feature-008-trace.mts",
      "tools/verification/008-setup-gate.mts",
      "tests/contract/008/prerequisites.spec.ts",
      "tests/contract/008/inputs.spec.ts",
      "tests/contract/008/gate-reports.spec.ts",
    ],
  },
];
for (const command of commands) {
  if (checks.some((c) => c.status !== "PASS")) {
    checks.push({
      id: command.id,
      status: "SKIPPED_GATED",
      evidence: [],
      reasonCodes: ["SETUP_PREREQUISITE_FAILED"],
    });
    continue;
  }
  const started = Date.now();
  const result = spawnSync(process.execPath, command.args, {
    cwd: ROOT_008,
    env,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 5_000_000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);
  recordCheck(
    command.id,
    result.status === 0 && !result.error,
    {
      command: command.args,
      exitCode: result.status,
      signal: result.signal,
      durationMs: Date.now() - started,
      output,
    },
    "CHECK_EXECUTION_FAILED",
  );
}
const after = currentFingerprints008();
recordCheck(
  "unchanged-source",
  JSON.stringify(after) === JSON.stringify(fingerprints),
  { before: fingerprints, after },
  "SOURCE_CHANGED_DURING_GATE",
);
const failed = checks.some((c) => c.status !== "PASS"),
  report: GateReport008 = {
    schemaVersion: 1,
    feature: FEATURE_008,
    runId,
    gate: "setup",
    status: failed ? "FAIL" : "PASS",
    deploymentProfile: "local",
    scope,
    startedAt,
    finishedAt: new Date().toISOString(),
    fingerprints,
    executorIdentity: "local-cli",
    checks,
    prerequisites: [],
    reasonCodes: failed ? ["SETUP_CHECK_FAILED"] : [],
  };
const ref = writeGateReport008(ROOT_008, report, {
  now: Date.now(),
  maximumAgeMs: 3_600_000,
  scope,
  fingerprints,
  allowedExecutors: ["local-cli"],
});
write008Json(`reports/${FEATURE_008}/setup.json`, {
  status: report.status,
  report: ref,
  corporateReady: false,
});
console.log(`[verify:008:setup] ${report.status}; report=${ref.path}`);
if (failed) process.exitCode = 1;
