import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/006-queue-triage-capacity-sla/browser.json");
const startedAt = new Date();
const args = ["node_modules/vitest/vitest.mjs", "run", "tests/e2e/006", "--maxWorkers=1"];
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
  checkpoint: "BROWSER",
  status,
  contour: "qa-jira-gitlab-mattermost-local",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  journey: Object.freeze({
    independentlyNavigablePath: "/qa/queue",
    stories: Object.freeze(["US1", "US2", "US3", "US4", "US5"]),
    forbiddenProjectIdentifiersRendered: 0,
    explanations: Object.freeze(["STAGE", "ORDER", "TRIAGE", "CAPACITY", "SLA"]),
    exactOverrideProvenance: true,
  }),
  results: Object.freeze([
    {
      id: "feature-006-browser-journey",
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
console.log(`[verify:006:browser] ${status}; report: ${reportPath}`);
if (status !== "PASS") process.exitCode = 1;
