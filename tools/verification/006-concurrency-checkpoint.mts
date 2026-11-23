import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { queueScenarioCatalog, runQueueScenario } from "../local/queue-scenario.mts";
import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/006-queue-triage-capacity-sla/concurrency.json");
const scenarioIds = Object.freeze([
  "us4-concurrent-last-slot",
  "us4-concurrent-review-reservation",
  "us4-exact-wip-override",
  "us4-stale-or-self-approved-override-denied",
  "us4-concurrent-expedite-singleton",
  "us4-expedite-clear-and-expiry-lock",
  "us3-exact-lead-order-override",
  "us3-order-hidden-anchor-terminal-no-op",
]);
const unknown = scenarioIds.filter(
  (id) => !queueScenarioCatalog.some((scenario) => scenario.id === id),
);
if (unknown.length > 0) throw new Error(`Unknown concurrency scenarios: ${unknown.join(", ")}`);

const startedAt = new Date();
const args = [
  "node_modules/vitest/vitest.mjs",
  "run",
  "tests/integration/006/concurrency-matrix.spec.ts",
  "tests/integration/006/us4-concurrent-admission.spec.ts",
  "tests/integration/006/us4-reservation-lifecycle.spec.ts",
  "tests/integration/006/us4-wip-override.spec.ts",
  "tests/integration/006/us4-expedite.spec.ts",
  "tests/integration/006/us2-order-actions.spec.ts",
  "tests/integration/006/us2-order-persistence.spec.ts",
  "tests/integration/006/us2-order-consumption.spec.ts",
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
const scenarios = await Promise.all(
  scenarioIds.map((id) => runQueueScenario(id, { mode: "TEST" })),
);
const status =
  test.status === 0 && scenarios.every((scenario) => scenario.status === "PASS") ? "PASS" : "FAIL";
const report = Object.freeze({
  schemaVersion: 1,
  feature: "006-queue-triage-capacity-sla",
  checkpoint: "CONCURRENCY",
  status,
  contour: "qa-jira-gitlab-mattermost-local",
  externalNetwork: "DENIED",
  production: "DENIED",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  invariants: Object.freeze({
    isolation: "SERIALIZABLE",
    capacityLockFirst: true,
    singleLastSlotWinner: true,
    singleExpediteWinner: true,
    deliveryAuthority: "POSTGRESQL",
    hiddenAnchorNoOp: true,
  }),
  scenarios,
  results: Object.freeze([
    {
      id: "concurrency-vitest-matrix",
      status: test.status === 0 ? "PASS" : "FAIL",
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
console.log(
  `[verify:006:concurrency] ${status}; scenarios=${scenarios.length}/${scenarioIds.length}; report: ${reportPath}`,
);
if (status !== "PASS") process.exitCode = 1;
