import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";

import {
  documentedJiraScenarioNames,
  jiraScenarioCatalog,
} from "../local/jira-scenario-catalog.mts";
import { stringifyPortableJson } from "../verification/portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const composeFile = resolve(workspace, "infra/compose/docker-compose.local.yml");
const jiraCli = resolve(workspace, "tools/local/jira-cli.mts");
const reportPath = resolve(
  workspace,
  "reports/003-jira-operational-authority/documented-scenarios.json",
);
const requestedProjectName = process.env.AWP_LOCAL_PROJECT_NAME?.trim();
const projectName =
  requestedProjectName || `awp-local-003-scenarios-${Date.now().toString(36)}-${process.pid}`;
const pnpmOverride = process.env.AWP_PNPM_BINARY?.trim();
const packageManager = pnpmOverride
  ? Object.freeze({ executable: pnpmOverride, prefixArgs: Object.freeze([] as string[]) })
  : Object.freeze({
      executable: process.execPath,
      prefixArgs: Object.freeze([
        resolve(dirname(process.execPath), "../lib/node_modules/corepack/dist/corepack.js"),
        "pnpm",
      ]),
    });
const planOnly = process.argv.includes("--plan");

if (!/^awp-local-003-scenarios-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(projectName)) {
  throw new Error(`AWP_LOCAL_PROJECT_NAME_UNSAFE:${projectName}`);
}

async function freePort(): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("AWP_SMOKE_FREE_PORT_UNAVAILABLE"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });
}

const [apiPort, workerPort, mockHubPort, idpPort, webPort] = planOnly
  ? [37_000, 37_001, 37_002, 37_003, 37_004]
  : await Promise.all(Array.from({ length: 5 }, async () => await freePort()));
const environment = {
  ...process.env,
  AWP_LOCAL_PROJECT_NAME: projectName,
  AWP_COMPOSITION: "qa-jira-local",
  AWP_API_HOST_PORT: String(apiPort),
  AWP_WORKER_HOST_PORT: String(workerPort),
  AWP_MOCK_HUB_HOST_PORT: String(mockHubPort),
  AWP_IDP_HOST_PORT: String(idpPort),
  AWP_WEB_HOST_PORT: String(webPort),
  AWP_API_URL: `http://127.0.0.1:${apiPort}`,
  AWP_WORKER_URL: `http://127.0.0.1:${workerPort}`,
  AWP_MOCK_HUB_URL: `http://127.0.0.1:${mockHubPort}`,
  AWP_MOCK_HUB_PUBLIC_URL: `http://127.0.0.1:${mockHubPort}`,
  AWP_PUBLIC_API_URL: `http://127.0.0.1:${apiPort}`,
  AWP_WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
  CI: "true",
};

function execute(
  executable: string,
  args: readonly string[],
  stdio: "inherit" | "pipe" = "inherit",
): SpawnSyncReturns<string> {
  return spawnSync(executable, [...args], {
    cwd: workspace,
    env: environment,
    encoding: "utf8",
    stdio,
  });
}

function requireSuccess(label: string, executable: string, args: readonly string[]): void {
  const result = execute(executable, args);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label}_FAILED:${String(result.status)}`);
}

function persistedScenario(): string {
  const result = execute(
    "docker",
    [
      "compose",
      "--project-name",
      projectName,
      "--file",
      composeFile,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-X",
      "--set",
      "ON_ERROR_STOP=1",
      "--username",
      "awp_bootstrap",
      "--dbname",
      "awp_mock",
      "--tuples-only",
      "--no-align",
      "--command",
      "SELECT scenario FROM jira_mock_scenario WHERE singleton=1;",
    ],
    "pipe",
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`MOCK_HUB_SCENARIO_QUERY_FAILED:${String(result.status)}`);
  return result.stdout.trim();
}

if (planOnly) {
  console.log(`AWP_LOCAL_PROJECT_NAME=${projectName} AWP_COMPOSITION=qa-jira-local`);
  console.log([process.execPath, jiraCli, "down"].join(" "));
  console.log([process.execPath, jiraCli, "up"].join(" "));
  console.log([process.execPath, jiraCli, "migrate"].join(" "));
  console.log([process.execPath, jiraCli, "seed"].join(" "));
  console.log([process.execPath, jiraCli, "status"].join(" "));
  for (const name of documentedJiraScenarioNames) console.log(`pnpm jira:scenario ${name}`);
  console.log("psql awp_mock: SELECT scenario FROM jira_mock_scenario WHERE singleton=1");
  console.log([process.execPath, jiraCli, "down"].join(" "));
  process.exit(0);
}

const startedAt = new Date();
const results: Array<
  Readonly<{
    name: string;
    expected: string;
    observed: string;
    command: readonly string[];
    status: "PASS" | "FAIL";
  }>
> = [];
let status: "PASS" | "FAIL" = "FAIL";
let failure: string | undefined;

try {
  requireSuccess("SCOPED_PRECLEAN", process.execPath, [jiraCli, "down"]);
  requireSuccess("QA_JIRA_LOCAL_UP", process.execPath, [jiraCli, "up"]);
  requireSuccess("QA_JIRA_LOCAL_MIGRATE", process.execPath, [jiraCli, "migrate"]);
  requireSuccess("QA_JIRA_LOCAL_SEED", process.execPath, [jiraCli, "seed"]);
  requireSuccess("QA_JIRA_LOCAL_STATUS", process.execPath, [jiraCli, "status"]);
  for (const name of documentedJiraScenarioNames) {
    const expected = jiraScenarioCatalog[name];
    const command = Object.freeze([
      packageManager.executable,
      ...packageManager.prefixArgs,
      "jira:scenario",
      name,
    ]);
    const run = execute(packageManager.executable, [
      ...packageManager.prefixArgs,
      "jira:scenario",
      name,
    ]);
    if (run.error) throw run.error;
    const observed = run.status === 0 ? persistedScenario() : "NOT_OBSERVED";
    const scenarioStatus = run.status === 0 && observed === expected ? "PASS" : "FAIL";
    results.push(Object.freeze({ name, expected, observed, command, status: scenarioStatus }));
    if (scenarioStatus !== "PASS") {
      throw new Error(`DOCUMENTED_SCENARIO_NOT_EXECUTED:${name}:${expected}:${observed}`);
    }
  }
  status = "PASS";
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  console.error(error);
} finally {
  const cleanup = execute(process.execPath, [jiraCli, "down"]);
  if (cleanup.error || cleanup.status !== 0) {
    status = "FAIL";
    failure ??= `SCOPED_CLEANUP_FAILED:${String(cleanup.status)}`;
  }
}

const executedNames = results.filter((result) => result.status === "PASS").map(({ name }) => name);
const unexecutedScenarios = documentedJiraScenarioNames.filter(
  (name) => !executedNames.includes(name),
);
if (unexecutedScenarios.length > 0) status = "FAIL";
const report = {
  schemaVersion: 1,
  feature: "003-jira-operational-authority",
  gate: "documented-scenarios-process",
  composition: "qa-jira-local",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status,
  durableInspection: "awp_mock.jira_mock_scenario",
  executedLifecycleCommands:
    status === "PASS"
      ? [
          "local:jira:down",
          "local:jira:up",
          "local:jira:migrate",
          "local:jira:seed",
          "local:jira:status",
          "local:jira:down",
        ]
      : [],
  results,
  unexecutedScenarios,
  ...(failure ? { failure } : {}),
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(
  `[smoke:003:scenarios:process] ${status}; executed=${executedNames.length}/${documentedJiraScenarioNames.length}; report: ${reportPath}`,
);
if (status !== "PASS") process.exitCode = 1;
