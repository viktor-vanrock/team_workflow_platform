import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "../verification/portable-json.mts";
import {
  feature004ProcessStages,
  summarizeFeature004ExecutionCoverage,
} from "./feature-004-process-contract.mts";

const workspace = resolve(import.meta.dirname, "../.."),
  plan = process.argv.includes("--plan"),
  token = `${Date.now().toString(36)}-${process.pid}`;
if (plan) {
  for (const stage of feature004ProcessStages)
    console.log(
      `[smoke:004:${stage.id}] AWP_LOCAL_PROJECT_NAME=${stage.projectPrefix}${token} ${process.execPath} ${stage.args.join(" ")} --plan`,
    );
  process.exit(0);
}
const startedAt = new Date(),
  results: Array<Record<string, unknown>> = [];
let failed = false;
for (const stage of feature004ProcessStages) {
  const base = {
    ...stage,
    command: [process.execPath, ...stage.args],
    projectName: `${stage.projectPrefix}${token}`,
  };
  if (failed) {
    results.push({ ...base, status: "SKIP", durationMs: 0 });
    continue;
  }
  const started = Date.now(),
    run = spawnSync(process.execPath, [...stage.args], {
      cwd: workspace,
      env: {
        ...process.env,
        CI: "true",
        AWP_COMPOSITION: "qa-jira-mattermost-local",
        AWP_LOCAL_PROJECT_NAME: `${stage.projectPrefix}${token}`,
      },
      stdio: "inherit",
      timeout: stage.timeoutMs,
    });
  failed = run.status !== 0 || !!run.error;
  results.push({
    ...base,
    status: failed ? "FAIL" : "PASS",
    durationMs: Date.now() - started,
    exitCode: run.status ?? 1,
  });
}
const coverage = summarizeFeature004ExecutionCoverage(
  results.map((value) => ({ id: String(value.id), status: String(value.status) })),
);
const scenarioPath = resolve(
    workspace,
    "reports/004-mattermost-hermes-intake/documented-scenarios.json",
  ),
  scenario = existsSync(scenarioPath)
    ? (JSON.parse(readFileSync(scenarioPath, "utf8")) as Record<string, unknown>)
    : undefined;
const scenarioFresh =
  typeof scenario?.startedAt === "string" && Date.parse(scenario.startedAt) >= startedAt.getTime();
const status =
  !failed &&
  !coverage.unexecutedStages.length &&
  !coverage.unexecutedSuccessCriteria.length &&
  scenarioFresh &&
  scenario?.status === "PASS"
    ? "PASS"
    : "FAIL";
const report = {
  schemaVersion: 1,
  feature: "004-mattermost-hermes-intake",
  gate: "smoke",
  composition: "qa-jira-mattermost-local",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status,
  stages: results,
  executionCoverage: coverage,
  documentedScenarios: {
    status: scenarioFresh ? scenario?.status : "STALE_OR_MISSING",
    report: "reports/004-mattermost-hermes-intake/documented-scenarios.json",
  },
  evidenceSources: ["POSTGRESQL", "MOCK_HUB", "PROCESS_HTTP", "SECURITY_TEST_EVIDENCE"],
};
const path = resolve(workspace, "reports/004-mattermost-hermes-intake/smoke.json");
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, stringifyPortableJson(report, workspace));
console.log(`[smoke:004] ${status}; report: ${path}`);
if (status !== "PASS") process.exitCode = 1;
