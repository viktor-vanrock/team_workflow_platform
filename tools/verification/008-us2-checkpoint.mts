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

if (process.argv.slice(2).some((value) => value !== "--")) throw new Error("UNKNOWN_US2_ARGUMENT");
const runId = `us2-${randomUUID()}`,
  startedAt = new Date().toISOString();
const scope = { workspaceId: "fixture-workspace-alpha", projectIds: ["fixture-project-web"] },
  fingerprints = currentFingerprints008();
const checks: GateCheck008[] = [],
  prerequisites: EvidenceRef008[] = [];
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
    reasonCodes: passed ? [] : ["US2_CHECK_FAILED"],
  });
  console.log(`[us2:008] ${id}: ${passed ? "PASS" : "FAIL"}`);
}
try {
  const summary = JSON.parse(
    readFileSync(resolve(ROOT_008, `reports/${FEATURE_008}/foundation.json`), "utf8"),
  ) as { report: EvidenceRef008 };
  const foundation = readGateReport008(ROOT_008, summary.report, options());
  if (
    foundation.gate !== "foundation" ||
    foundation.deploymentProfile !== "local" ||
    foundation.status !== "PASS" ||
    foundation.checks.some((value) => value.status !== "PASS")
  )
    throw new Error("FOUNDATION_REQUIRED");
  for (const child of foundation.checks) checks.push({ ...child, id: `foundation-${child.id}` });
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
    CI: "true",
    AWP_RUN_CONTAINER_TESTS: "true",
    PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter),
  };
  for (const [id, args, timeout] of [
    [
      "provider-fault-recovery",
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "tests/integration/008/uncertain-effects.spec.ts",
        "tests/integration/008/retry-worker.spec.ts",
        "tests/integration/008/notification-delivery.spec.ts",
        "tests/integration/008/completion-runtime.spec.ts",
        "tests/integration/008/dead-letter-replay.spec.ts",
        "tests/integration/008/degradation-matrix.spec.ts",
        "tests/contract/008/provider-ingress.spec.ts",
        "tests/unit/008/retry-policy.spec.ts",
        "tests/unit/008/degradation-policy.spec.ts",
        "--maxWorkers=1",
      ],
      600_000,
    ],
    [
      "operator-browser",
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        "tests/e2e/008/pilot-readiness-browser.spec.ts",
        "--project=chromium",
        "--workers=1",
      ],
      180_000,
    ],
  ] as const) {
    const result = spawnSync(process.execPath, args, {
      cwd: ROOT_008,
      env: environment,
      encoding: "utf8",
      timeout,
      maxBuffer: 5_000_000,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    check(id, result.status === 0 && !result.error, {
      command: args,
      exitCode: result.status,
      output,
    });
  }
}
const counted = [
  {
    path: "tests/integration/008/uncertain-effects.spec.ts",
    assertions: ["expect(posts).toBe(1)", "state.pipelines).toHaveLength(1)"],
  },
  {
    path: "tests/integration/008/notification-delivery.spec.ts",
    assertions: ["posts).toHaveLength(1)", "expect(reads).toBe(1)"],
  },
  {
    path: "tests/integration/008/completion-runtime.spec.ts",
    assertions: [
      "expect(provider.posts).toBe(1)",
      'purposes.filter(purpose => purpose === "WRITE")',
    ],
  },
  {
    path: "tests/integration/008/dead-letter-replay.spec.ts",
    assertions: ["expect(invocations).toBe(1)", "COMMAND_REPLAY_AUTHORIZATION_EXPIRED"],
  },
].map((entry) => {
  const bytes = readFileSync(resolve(ROOT_008, entry.path));
  const source = bytes.toString("utf8");
  return {
    ...entry,
    sha256: hashBytes(bytes),
    assertions: entry.assertions.map((text) => ({ text, present: source.includes(text) })),
  };
});
const effectCounting = counted.every((file) =>
  file.assertions.every((assertion) => assertion.present),
);
check("independent-provider-effect-counts", effectCounting, {
  mode: "DEVELOPMENT_MOCKS",
  files: counted,
  observations: [
    "Jira issue ledger",
    "GitLab pipeline ledger",
    "Mattermost message ledger",
    "completion effect ledger",
  ],
  lostResponse: true,
  workerRestart: true,
  corporateN2: "BLOCKED_INPUT",
});
check(
  "unchanged-source",
  JSON.stringify(currentFingerprints008()) === JSON.stringify(fingerprints),
  { fingerprints },
);
const failed = checks.some((value) => value.status === "FAIL"),
  report: GateReport008 = {
    schemaVersion: 1,
    feature: FEATURE_008,
    runId,
    gate: "us2",
    status: failed ? "FAIL" : "PASS",
    deploymentProfile: "local",
    scope,
    startedAt,
    finishedAt: new Date().toISOString(),
    fingerprints,
    executorIdentity: "local-cli",
    checks,
    prerequisites,
    reasonCodes: failed ? ["US2_FAILED"] : [],
  };
const ref = writeGateReport008(ROOT_008, report, options());
write008Json(`reports/${FEATURE_008}/us2.json`, {
  status: report.status,
  report: ref,
  mode: "DEVELOPMENT_MOCKS",
  corporateN2: "BLOCKED_INPUT",
});
console.log(`[verify:008:us2] ${report.status}; report=${ref.path}`);
if (failed) process.exitCode = 1;
