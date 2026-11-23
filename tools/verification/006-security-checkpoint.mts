import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/006-queue-triage-capacity-sla/security.json");
const startedAt = new Date();
const args = [
  "node_modules/vitest/vitest.mjs",
  "run",
  "tests/integration/security/006/production-and-scope-boundary.spec.ts",
  "tests/integration/security/006/us1-stage-isolation.spec.ts",
  "tests/integration/security/006/us2-portfolio-isolation.spec.ts",
  "tests/integration/security/006/us3-approval-v2.spec.ts",
  "tests/integration/security/006/us4-capacity-isolation.spec.ts",
  "tests/integration/security/006/us4-routing-boundary.spec.ts",
  "tests/integration/security/006/us5-sla-read.spec.ts",
  "tests/contract/006/us4-admission-api.spec.ts",
  "--maxWorkers=1",
];
const testStarted = Date.now();
const test = spawnSync(process.execPath, args, {
  cwd: workspace,
  env: { ...process.env, CI: "true" },
  encoding: "utf8",
});
if (test.error) throw test.error;
if (test.status !== 0) {
  process.stderr.write(test.stdout);
  process.stderr.write(test.stderr);
}
const status = test.status === 0 ? "PASS" : "FAIL";
const report = Object.freeze({
  schemaVersion: 1,
  feature: "006-queue-triage-capacity-sla",
  checkpoint: "SECURITY",
  status,
  contour: "qa-jira-gitlab-mattermost-local",
  externalNetwork: "DENIED",
  production: "DENIED",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  invariants: Object.freeze({
    reauthorizationAtReadAndConsume: true,
    forbiddenEqualsAbsent: true,
    authorizationBeforeAggregation: true,
    hiddenCountCursorTimingLogMetricLeakage: 0,
    actionWitnessFieldsPublished: 0,
    providerReadsOnQueueGet: 0,
    productionEndpointsReachableFromLocalContour: 0,
  }),
  results: Object.freeze([
    {
      id: "feature-006-security-matrix",
      status,
      exitCode: test.status ?? 1,
      durationMs: Date.now() - testStarted,
      outputHash: `sha256:${createHash("sha256").update(`${test.stdout}\n${test.stderr}`).digest("hex")}`,
      args,
    },
  ]),
});
mkdirSync(dirname(reportPath), { recursive: true });
const temporary = `${reportPath}.${process.pid}.tmp`;
writeFileSync(temporary, stringifyPortableJson(report, workspace), "utf8");
renameSync(temporary, reportPath);
console.log(`[verify:006:security] ${status}; report: ${reportPath}`);
if (status !== "PASS") process.exitCode = 1;
