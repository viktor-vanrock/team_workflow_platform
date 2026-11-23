import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";

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

if (process.argv.slice(2).some((value) => value !== "--")) throw new Error("UNKNOWN_US5_ARGUMENT");
const runId = `us5-${randomUUID()}`,
  startedAt = new Date().toISOString(),
  scope = { workspaceId: "fixture-workspace-alpha", projectIds: ["fixture-project-web"] },
  fingerprints = currentFingerprints008();
const checks: GateCheck008[] = [],
  prerequisites: EvidenceRef008[] = [];
const options = () => ({
  now: Date.now(),
  maximumAgeMs: 3_600_000,
  scope,
  fingerprints,
  allowedExecutors: ["local-cli"],
});
function check(
  id: string,
  passed: boolean,
  detail: unknown,
  evidence: readonly EvidenceRef008[] = [],
): void {
  const path = `reports/${FEATURE_008}/evidence/${runId}/${id}.json`;
  write008Json(path, detail);
  checks.push({
    id,
    status: passed ? "PASS" : "FAIL",
    evidence: [...evidence, evidenceRef008(ROOT_008, path)],
    reasonCodes: passed ? [] : ["US5_CHECK_FAILED"],
  });
  console.log(`[us5:008] ${id}: ${passed ? "PASS" : "FAIL"}`);
}
try {
  const summary = JSON.parse(
    readFileSync(resolve(ROOT_008, `reports/${FEATURE_008}/foundation.json`), "utf8"),
  ) as { report: EvidenceRef008 };
  const report = readGateReport008(ROOT_008, summary.report, options());
  if (report.gate !== "foundation" || report.status !== "PASS")
    throw new Error("FOUNDATION_REQUIRED");
  prerequisites.push(summary.report);
  check("foundation-prerequisite", true, { report: summary.report }, [summary.report]);
} catch (error) {
  check("foundation-prerequisite", false, {
    reasonCode: error instanceof Error ? error.message : "FOUNDATION_REQUIRED",
  });
}

if (prerequisites.length) {
  const environment = {
    ...process.env,
    CI: "true",
    PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter),
  };
  const commands = [
    {
      id: "pilot-domain-and-activation",
      args: [
        "node_modules/vitest/vitest.mjs",
        "run",
        "tests/unit/008/pilot-measurements.spec.ts",
        "tests/unit/008/pilot-corporate-evidence.spec.ts",
        "tests/integration/008/pilot-activation.spec.ts",
        "tests/integration/008/shadow-fence.spec.ts",
        "tests/integration/008/pilot-cohort.spec.ts",
        "tests/integration/008/pilot-review.spec.ts",
        "tests/integration/008/pilot-observation-worker.spec.ts",
        "tests/integration/008/pilot-run-api.spec.ts",
        "--maxWorkers=1",
      ],
      timeout: 180_000,
    },
    {
      id: "pilot-typecheck",
      args: [
        "node_modules/typescript/bin/tsc",
        "-p",
        "tests/008.tsconfig.json",
        "--pretty",
        "false",
      ],
      timeout: 180_000,
    },
    {
      id: "pilot-api-typecheck",
      args: [
        "node_modules/typescript/bin/tsc",
        "-p",
        "apps/api/tsconfig.json",
        "--pretty",
        "false",
      ],
      timeout: 180_000,
    },
    {
      id: "pilot-web-typecheck",
      args: [
        "node_modules/typescript/bin/tsc",
        "-p",
        "apps/web/tsconfig.json",
        "--pretty",
        "false",
      ],
      timeout: 180_000,
    },
    {
      id: "pilot-browser-workflow",
      args: [
        "node_modules/@playwright/test/cli.js",
        "test",
        "tests/e2e/008/pilot-operation.spec.ts",
        "--project=chromium",
        "--workers=1",
      ],
      timeout: 180_000,
    },
  ];
  for (const command of commands) {
    const result = spawnSync(process.execPath, command.args, {
      cwd: ROOT_008,
      env: environment,
      encoding: "utf8",
      timeout: command.timeout,
      maxBuffer: 5_000_000,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    process.stdout.write(output);
    check(command.id, result.status === 0 && !result.error, {
      command: command.args,
      exitCode: result.status,
      output,
    });
  }
  let shadowStatus = "BLOCKED_INPUT",
    reviewStatus = "BLOCKED_INPUT";
  try {
    shadowStatus =
      (
        JSON.parse(
          readFileSync(resolve(ROOT_008, `reports/${FEATURE_008}/shadow.json`), "utf8"),
        ) as { status?: string }
      ).status ?? shadowStatus;
  } catch {
    /* absent corporate result is blocked */
  }
  try {
    reviewStatus =
      (
        JSON.parse(
          readFileSync(resolve(ROOT_008, `reports/${FEATURE_008}/review.json`), "utf8"),
        ) as { status?: string }
      ).status ?? reviewStatus;
  } catch {
    /* absent corporate result is blocked */
  }
  check("local-corporate-separation", shadowStatus !== "PASS" && reviewStatus !== "PASS", {
    localMode: "DEVELOPMENT_MOCKS",
    corporateShadow: shadowStatus,
    actualObservedPilotReview: reviewStatus,
    localSampleIsCorporateOutcome: false,
  });
}
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
  gate: "us5",
  status: failed ? "FAIL" : "PASS",
  deploymentProfile: "local",
  scope,
  startedAt,
  finishedAt: new Date().toISOString(),
  fingerprints,
  executorIdentity: "local-cli",
  checks,
  prerequisites,
  reasonCodes: failed ? ["US5_FAILED"] : [],
};
const ref = writeGateReport008(ROOT_008, report, options());
write008Json(`reports/${FEATURE_008}/us5.json`, {
  status: report.status,
  report: ref,
  mode: "DEVELOPMENT_MOCKS",
  corporateShadow: "BLOCKED_INPUT",
  actualObservedPilotReview: "BLOCKED_INPUT",
});
console.log(
  `[verify:008:us5] local=${report.status}; corporateShadow=BLOCKED_INPUT; observedReview=BLOCKED_INPUT; report=${ref.path}`,
);
if (failed) process.exitCode = 1;
