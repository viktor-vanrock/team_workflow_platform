import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { documentedJiraScenarioNames } from "../local/jira-scenario-catalog.mts";
import {
  assertFeature003ExecutionCoverage,
  feature003ProcessStages,
  type Feature003StageStatus,
} from "../smoke/feature-003-process-contract.mts";
import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const quickstartPath = resolve(workspace, "specs/003-jira-operational-authority/quickstart.md");
const reportPath = resolve(workspace, "reports/003-jira-operational-authority/quickstart.json");
const smokeReportPath = resolve(workspace, "reports/003-jira-operational-authority/smoke.json");
const scenarioReportPath = resolve(
  workspace,
  "reports/003-jira-operational-authority/documented-scenarios.json",
);
const pnpm = process.env.AWP_PNPM_BINARY?.trim() || "/opt/homebrew/bin/pnpm";
const planOnly = process.argv.includes("--plan");
const unexpected = process.argv
  .slice(2)
  .filter((argument) => argument !== "--plan" && argument !== "--");
if (unexpected.length > 0)
  throw new Error(`Unknown verify:003:quickstart arguments: ${unexpected.join(" ")}`);

const markdown = readFileSync(quickstartPath, "utf8");
const packageJson = JSON.parse(readFileSync(resolve(workspace, "package.json"), "utf8")) as {
  readonly scripts: Readonly<Record<string, string>>;
};
const documentedCommands = [
  ...new Set(
    markdown
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.startsWith("pnpm ") && !line.startsWith("pnpm --") && line !== "pnpm 11.21.0",
      ),
  ),
];
const documentedScripts = documentedCommands.map((line) => line.split(/\s+/u)[1]!);
const orphanedScripts = [
  ...new Set(documentedScripts.filter((script) => !(script in packageJson.scripts))),
];
const documentedScenarios = documentedCommands
  .filter((line) => line.startsWith("pnpm jira:scenario "))
  .map((line) => line.split(/\s+/u)[2]!);
const orphanedScenarios = documentedScenarios.filter(
  (name) =>
    !documentedJiraScenarioNames.includes(name as (typeof documentedJiraScenarioNames)[number]),
);
const undocumentedScenarios = documentedJiraScenarioNames.filter(
  (name) => !documentedScenarios.includes(name),
);

type CommandDisposition =
  | "EXECUTED"
  | "EXECUTED_BY_QA_JIRA_PROCESS"
  | "PARENT_GATE"
  | "GATED_NONPROD"
  | "OPERATOR_DESTRUCTIVE";

const directlyExecutedScripts = new Set([
  "test:contract:003",
  "test:integration:003",
  "test:e2e:003",
  "smoke:003",
]);
const processLifecycleScripts = new Set([
  "local:jira:up",
  "local:jira:migrate",
  "local:jira:seed",
  "local:jira:status",
  "local:jira:down",
]);
const parentGateScripts = new Set([
  "prerequisites",
  "verify:001",
  "verify:002",
  "verify:003:prerequisites",
  "verify:003:foundation",
  "verify:003:us1",
  "verify:003:us2",
  "verify:003:us3",
  "verify:003:us4",
  "trace:003",
  "verify:003",
]);
const nonprodScripts = new Set([
  "jira:nonprod:preflight",
  "jira:nonprod:contract",
  "jira:nonprod:least-privilege",
]);

function disposition(command: string): CommandDisposition | undefined {
  const script = command.split(/\s+/u)[1]!;
  if (directlyExecutedScripts.has(script) || script === "jira:scenario") return "EXECUTED";
  if (processLifecycleScripts.has(script)) return "EXECUTED_BY_QA_JIRA_PROCESS";
  if (parentGateScripts.has(script)) return "PARENT_GATE";
  if (nonprodScripts.has(script)) return "GATED_NONPROD";
  if (script === "local:jira:reset") return "OPERATOR_DESTRUCTIVE";
  return undefined;
}

const commandCoverage = documentedCommands.map((command) => ({
  command,
  disposition: disposition(command) ?? "UNCLASSIFIED",
}));
const unclassifiedCommands = commandCoverage
  .filter(({ disposition: commandDisposition }) => commandDisposition === "UNCLASSIFIED")
  .map(({ command }) => command);

const commands = Object.freeze([
  Object.freeze(["test:contract:003"]),
  Object.freeze(["test:integration:003"]),
  Object.freeze(["test:e2e:003"]),
  Object.freeze(["smoke:003"]),
]);

if (planOnly) {
  for (const [script] of commands) console.log(`${pnpm} ${script}`);
  console.log(`documented scenarios executed by smoke:003: ${documentedJiraScenarioNames.length}`);
  console.table(commandCoverage);
  process.exit(0);
}

interface CommandResult {
  readonly command: readonly string[];
  readonly status: "PASS" | "FAIL" | "SKIP";
  readonly durationMs: number;
  readonly exitCode?: number;
}

const startedAt = new Date();
const results: CommandResult[] = [];
let failed =
  orphanedScripts.length > 0 ||
  orphanedScenarios.length > 0 ||
  undocumentedScenarios.length > 0 ||
  unclassifiedCommands.length > 0;
for (const [script] of commands) {
  if (!script) throw new Error("QUICKSTART_COMMAND_MISSING");
  const command = Object.freeze([pnpm, script]);
  if (failed) {
    results.push(Object.freeze({ command, status: "SKIP", durationMs: 0 }));
    continue;
  }
  const started = Date.now();
  const run = spawnSync(pnpm, [script], {
    cwd: workspace,
    env: { ...process.env, CI: "true" },
    encoding: "utf8",
    stdio: "inherit",
    timeout: script === "smoke:003" ? 3_600_000 : 600_000,
  });
  const exitCode = run.status ?? 1;
  failed = run.error !== undefined || exitCode !== 0;
  if (run.error) console.error(run.error.message);
  results.push(
    Object.freeze({
      command,
      status: failed ? "FAIL" : "PASS",
      durationMs: Date.now() - started,
      exitCode,
    }),
  );
}

interface SmokeReport {
  readonly status?: unknown;
  readonly startedAt?: unknown;
  readonly stages?: readonly Feature003StageStatus[];
  readonly executionCoverage?: Readonly<{
    readonly unexecutedStages?: unknown;
    readonly unexecutedSuccessCriteria?: unknown;
  }>;
}
interface ScenarioReport {
  readonly status?: unknown;
  readonly startedAt?: unknown;
  readonly results?: readonly Readonly<{ readonly name?: unknown; readonly status?: unknown }>[];
  readonly unexecutedScenarios?: unknown;
  readonly executedLifecycleCommands?: unknown;
}

function readJson<T>(path: string): T | undefined {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : undefined;
}

const smoke = readJson<SmokeReport>(smokeReportPath);
const scenarios = readJson<ScenarioReport>(scenarioReportPath);
const smokeFresh =
  typeof smoke?.startedAt === "string" && Date.parse(smoke.startedAt) >= startedAt.getTime();
const scenariosFresh =
  typeof scenarios?.startedAt === "string" &&
  Date.parse(scenarios.startedAt) >= startedAt.getTime();
let coverageFailure: string | undefined;
try {
  if (!smokeFresh || smoke?.status !== "PASS" || !Array.isArray(smoke.stages)) {
    throw new Error("QUICKSTART_SMOKE_EVIDENCE_MISSING_OR_STALE");
  }
  assertFeature003ExecutionCoverage(smoke.stages);
} catch (error) {
  coverageFailure = error instanceof Error ? error.message : String(error);
}
const executedScenarioNames =
  scenariosFresh && Array.isArray(scenarios?.results)
    ? scenarios.results
        .filter(({ status: scenarioStatus }) => scenarioStatus === "PASS")
        .map(({ name }) => String(name))
    : [];
const unexecutedScenarios = documentedScenarios.filter(
  (name) => !executedScenarioNames.includes(name),
);
const expectedLifecycleCommands = [
  "local:jira:down",
  "local:jira:up",
  "local:jira:migrate",
  "local:jira:seed",
  "local:jira:status",
];
const lifecycleCommands =
  scenariosFresh && Array.isArray(scenarios?.executedLifecycleCommands)
    ? scenarios.executedLifecycleCommands.map(String)
    : [];
const unexecutedLifecycleCommands = expectedLifecycleCommands.filter(
  (command) => !lifecycleCommands.includes(command),
);
const unexecutedSuccessCriteria = Array.isArray(smoke?.executionCoverage?.unexecutedSuccessCriteria)
  ? smoke.executionCoverage.unexecutedSuccessCriteria.map(String)
  : [...feature003ProcessStages.flatMap(({ successCriteria }) => successCriteria)];
const unexecutedInvariants = [
  ...unexecutedSuccessCriteria,
  ...unexecutedScenarios.map((name) => `scenario:${name}`),
  ...unexecutedLifecycleCommands.map((command) => `command:${command}`),
];
failed ||=
  scenarios?.status !== "PASS" || unexecutedInvariants.length > 0 || coverageFailure !== undefined;

const report = {
  schemaVersion: 2,
  feature: "003-jira-operational-authority",
  gate: "quickstart",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  documentedCommands: documentedCommands.length,
  documentedScenarios: documentedScenarios.length,
  orphanedScripts,
  orphanedScenarios,
  undocumentedScenarios,
  unclassifiedCommands,
  commandCoverage,
  results,
  executedScenarioNames,
  unexecutedInvariants,
  ...(coverageFailure ? { coverageFailure } : {}),
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(
  `[quickstart:003] ${report.status}; commands=${documentedCommands.length}; scenarios=${documentedScenarios.length}; report: ${reportPath}`,
);
if (failed) process.exitCode = 1;
