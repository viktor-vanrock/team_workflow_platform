import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "../verification/portable-json.mts";
import {
  assertFeature003ExecutionCoverage,
  feature003ProcessStages,
  summarizeFeature003ExecutionCoverage,
} from "./feature-003-process-contract.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/003-jira-operational-authority/smoke.json");
const scenarioReportPath = resolve(
  workspace,
  "reports/003-jira-operational-authority/documented-scenarios.json",
);
const flags = new Set(process.argv.slice(2).filter((argument) => argument !== "--"));
const unknown = [...flags].filter((flag) => flag !== "--plan");
if (unknown.length > 0) throw new Error(`Unknown smoke:003 arguments: ${unknown.join(", ")}`);

const suiteToken = `${Date.now().toString(36)}-${process.pid}`;

function stageEnvironment(projectPrefix?: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CI: "true",
    AWP_COMPOSITION: "qa-jira-local",
  };
  delete environment.AWP_LOCAL_PROJECT_NAME;
  if (projectPrefix) environment.AWP_LOCAL_PROJECT_NAME = `${projectPrefix}${suiteToken}`;
  return environment;
}

if (flags.has("--plan")) {
  for (const stage of feature003ProcessStages) {
    const project = stage.projectPrefix
      ? `AWP_LOCAL_PROJECT_NAME=${stage.projectPrefix}${suiteToken} `
      : "";
    console.log(
      `[smoke:003:${stage.id}] ${project}AWP_COMPOSITION=qa-jira-local ${[
        process.execPath,
        ...stage.args,
        "--plan",
      ].join(" ")}`,
    );
  }
  process.exit(0);
}

type StageStatus = "PASS" | "FAIL" | "SKIP";
interface StageResult {
  readonly id: string;
  readonly command: readonly string[];
  readonly composition: "qa-jira-local";
  readonly projectName?: string;
  readonly status: StageStatus;
  readonly durationMs: number;
  readonly exitCode?: number;
  readonly evidenceSources: readonly string[];
  readonly successCriteria: readonly string[];
  readonly documentedScenarios: readonly string[];
}

const startedAt = new Date();
const results: StageResult[] = [];
let failed = false;
for (const stage of feature003ProcessStages) {
  const projectName = stage.projectPrefix ? `${stage.projectPrefix}${suiteToken}` : undefined;
  const base = {
    id: stage.id,
    command: Object.freeze([process.execPath, ...stage.args]),
    composition: "qa-jira-local" as const,
    ...(projectName ? { projectName } : {}),
    evidenceSources: stage.evidenceSources,
    successCriteria: stage.successCriteria,
    documentedScenarios: stage.documentedScenarios,
  };
  if (failed) {
    results.push(Object.freeze({ ...base, status: "SKIP", durationMs: 0 }));
    continue;
  }

  console.log(`\n[smoke:003] ${stage.id}`);
  const started = Date.now();
  const run = spawnSync(process.execPath, [...stage.args], {
    cwd: workspace,
    env: stageEnvironment(stage.projectPrefix),
    encoding: "utf8",
    stdio: "inherit",
    timeout: stage.timeoutMs,
  });
  const exitCode = run.status ?? 1;
  failed = run.error !== undefined || exitCode !== 0;
  if (run.error) console.error(run.error.message);
  results.push(
    Object.freeze({
      ...base,
      status: failed ? "FAIL" : "PASS",
      durationMs: Date.now() - started,
      exitCode,
    }),
  );
}

const coverage = summarizeFeature003ExecutionCoverage(results);
let coverageFailure: string | undefined;
try {
  assertFeature003ExecutionCoverage(results);
} catch (error) {
  coverageFailure = error instanceof Error ? error.message : String(error);
}

interface ScenarioReport {
  readonly status?: unknown;
  readonly startedAt?: unknown;
  readonly unexecutedScenarios?: unknown;
  readonly results?: unknown;
}
const scenarioReport = existsSync(scenarioReportPath)
  ? (JSON.parse(readFileSync(scenarioReportPath, "utf8")) as ScenarioReport)
  : undefined;
const scenarioReportFresh =
  scenarioReport !== undefined &&
  typeof scenarioReport.startedAt === "string" &&
  Date.parse(scenarioReport.startedAt) >= startedAt.getTime();
const unexecutedScenarios =
  scenarioReportFresh && Array.isArray(scenarioReport?.unexecutedScenarios)
    ? scenarioReport.unexecutedScenarios.map(String)
    : feature003ProcessStages[0]!.documentedScenarios;
const scenariosPassed =
  scenarioReportFresh && scenarioReport?.status === "PASS" && unexecutedScenarios.length === 0;
const status = !failed && !coverageFailure && scenariosPassed ? "PASS" : "FAIL";
const report = {
  schemaVersion: 2,
  feature: "003-jira-operational-authority",
  gate: "smoke",
  composition: "qa-jira-local",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status,
  stages: results,
  executionCoverage: coverage,
  durableEffectInspection: {
    platform: "US1-US4 process tests query the awp PostgreSQL database",
    provider: "US1-US4 process tests query awp_mock effects/issues/links/comments",
    evidenceSources: ["POSTGRESQL", "MOCK_HUB", "PROCESS_HTTP"],
  },
  documentedScenarios: {
    status: scenariosPassed ? "PASS" : "FAIL",
    report: "reports/003-jira-operational-authority/documented-scenarios.json",
    executed:
      scenarioReportFresh && Array.isArray(scenarioReport?.results)
        ? scenarioReport.results.length
        : 0,
    required: feature003ProcessStages[0]!.documentedScenarios.length,
    unexecutedScenarios,
  },
  ...(coverageFailure ? { coverageFailure } : {}),
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(`[smoke:003] ${status}; report: ${reportPath}`);
if (status !== "PASS") process.exitCode = 1;
