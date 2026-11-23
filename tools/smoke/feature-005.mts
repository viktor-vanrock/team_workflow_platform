import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";

import { gitLabDocumentedScenarioNames } from "../local/gitlab-scenario-catalog.mts";
import { stringifyPortableJson } from "../verification/portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const composeFile = resolve(workspace, "infra/compose/docker-compose.local.yml");
const cli = resolve(workspace, "tools/local/gitlab-cli.mts");
const scenarioCli = resolve(workspace, "tools/local/gitlab-scenario.mts");
const browserProcess = resolve(workspace, "tools/smoke/feature-005-browser-process.mts");
const reportPath = resolve(workspace, "reports/005-gitlab-automated-validation/smoke.json");
const planOnly = process.argv.includes("--plan");
const unknown = process.argv.slice(2).filter((value) => value !== "--" && value !== "--plan");
if (unknown.length > 0) throw new Error(`Unknown smoke:005 arguments: ${unknown.join(", ")}`);
const token = `${Date.now().toString(36)}-${process.pid}`;
const projectName = `awp-local-005-smoke-${token}`;

async function freePort(): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return server.close(() => reject(new Error("AWP_SMOKE_FREE_PORT_UNAVAILABLE")));
      return server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });
}

const ports = planOnly
  ? [40_000, 40_001, 40_002, 40_003, 40_004]
  : await Promise.all(Array.from({ length: 5 }, freePort));
const [apiPort, workerPort, mockHubPort, idpPort, webPort] = ports;
const environment = {
  ...process.env,
  AWP_LOCAL_PROJECT_NAME: projectName,
  AWP_COMPOSITION: "qa-jira-gitlab-local",
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
  AWP_WEB_URL: `http://127.0.0.1:${webPort}`,
  CI: "true",
};

function execute(
  executable: string,
  args: readonly string[],
  inherit = true,
  processEnvironment: NodeJS.ProcessEnv = environment,
): SpawnSyncReturns<string> {
  return spawnSync(executable, [...args], {
    cwd: workspace,
    env: processEnvironment,
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
}
function requireSuccess(
  label: string,
  executable: string,
  args: readonly string[],
  inherit = true,
): SpawnSyncReturns<string> {
  const result = execute(executable, args, inherit);
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${label}_FAILED:${String(result.status)}:${result.stderr ?? ""}`);
  return result;
}
function compose(args: readonly string[], inherit = true): SpawnSyncReturns<string> {
  return requireSuccess(
    "FEATURE_005_COMPOSE",
    "docker",
    ["compose", "--project-name", projectName, "--file", composeFile, ...args],
    inherit,
  );
}
function sql(database: "awp" | "awp_mock", statement: string): string {
  return compose(
    [
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
      database,
      "--tuples-only",
      "--no-align",
      "--command",
      statement,
    ],
    false,
  ).stdout.trim();
}
function persistedScenarioNames(): readonly string[] {
  const raw = sql(
    "awp_mock",
    "SELECT COALESCE(json_agg(key ORDER BY key),'[]'::json)::text FROM jsonb_object_keys((SELECT capabilities FROM mock_gitlab_projects WHERE project_id=5001)) AS keys(key) WHERE key LIKE 'scenario:%';",
  );
  return Object.freeze(
    (JSON.parse(raw) as string[]).map((value) => value.slice("scenario:".length)),
  );
}
async function assertReady(name: string, url: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`FEATURE_005_${name}_NOT_READY:${response.status}`);
}
async function waitReady(name: string, url: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await assertReady(name, url);
      return;
    } catch {
      await new Promise((resolveWait) => {
        setTimeout(resolveWait, 500);
      });
    }
  }
  throw new Error(`FEATURE_005_${name}_RESTART_TIMEOUT`);
}

if (planOnly) {
  console.log(`AWP_LOCAL_PROJECT_NAME=${projectName} AWP_COMPOSITION=qa-jira-gitlab-local`);
  console.log([process.execPath, cli, "up"].join(" "));
  for (const id of gitLabDocumentedScenarioNames)
    console.log([process.execPath, scenarioCli, id].join(" "));
  console.log(
    "docker compose restart mock-hub worker api; PostgreSQL durable inspection; HTTP readiness",
  );
  console.log([process.execPath, browserProcess].join(" "));
  console.log([process.execPath, cli, "down"].join(" "));
  process.exit(0);
}

const startedAt = new Date();
const stages: Array<
  Readonly<{ id: string; status: "PASS" | "FAIL" | "SKIP"; durationMs: number; details?: unknown }>
> = [];
let failure: string | undefined;
let persistedBeforeRestart: readonly string[] = [];
let persistedAfterRestart: readonly string[] = [];
const executedScenarioIds: string[] = [];
let platformInspection: Readonly<Record<string, number>> = Object.freeze({});
let mockInspection: Readonly<Record<string, number>> = Object.freeze({});
let coreClean: boolean;

try {
  requireSuccess("SCOPED_PRECLEAN", process.execPath, [cli, "down"]);
  let stageStarted = Date.now();
  requireSuccess("DOCUMENTED_SCENARIOS", process.execPath, [
    "tools/local/gitlab-scenario-catalog.mts",
    "--check",
  ]);
  stages.push(
    Object.freeze({
      id: "documented-scenarios",
      status: "PASS",
      durationMs: Date.now() - stageStarted,
      details: { required: 30 },
    }),
  );

  stageStarted = Date.now();
  requireSuccess("GITLAB_LOCAL_UP", process.execPath, [cli, "up"]);
  await Promise.all([
    assertReady("API", `http://127.0.0.1:${apiPort}/health/ready`),
    assertReady("WORKER", `http://127.0.0.1:${workerPort}/health/ready`),
    assertReady("MOCK_HUB", `http://127.0.0.1:${mockHubPort}/health/live`),
  ]);
  stages.push(
    Object.freeze({
      id: "isolated-local-up",
      status: "PASS",
      durationMs: Date.now() - stageStarted,
      details: { projectName, ports },
    }),
  );

  stageStarted = Date.now();
  for (const id of gitLabDocumentedScenarioNames) {
    console.log(`[smoke:005:scenario] ${id}`);
    requireSuccess(`SCENARIO_${id}`, process.execPath, [scenarioCli, id], false);
    const persisted = persistedScenarioNames();
    if (persisted.length !== 1 || persisted[0] !== id)
      throw new Error(`FEATURE_005_PERSISTED_SCENARIO_INVALID:${id}:${persisted.join(",")}`);
    executedScenarioIds.push(id);
  }
  persistedBeforeRestart = persistedScenarioNames();
  if (JSON.stringify(executedScenarioIds) !== JSON.stringify(gitLabDocumentedScenarioNames))
    throw new Error("FEATURE_005_EXECUTED_SCENARIO_SET_INVALID");
  stages.push(
    Object.freeze({
      id: "stateful-scenario-execution",
      status: "PASS",
      durationMs: Date.now() - stageStarted,
      details: {
        executed: executedScenarioIds.length,
        persistedCurrent: persistedBeforeRestart[0],
      },
    }),
  );

  stageStarted = Date.now();
  for (const service of ["mock-hub", "worker", "api"] as const) {
    compose(["restart", service]);
    await waitReady(
      service.toUpperCase().replace("-", "_"),
      service === "mock-hub"
        ? `http://127.0.0.1:${mockHubPort}/health/live`
        : service === "worker"
          ? `http://127.0.0.1:${workerPort}/health/ready`
          : `http://127.0.0.1:${apiPort}/health/ready`,
    );
  }
  persistedAfterRestart = persistedScenarioNames();
  if (JSON.stringify(persistedAfterRestart) !== JSON.stringify(persistedBeforeRestart))
    throw new Error("FEATURE_005_RESTART_DURABILITY_INVALID");
  stages.push(
    Object.freeze({
      id: "api-worker-mock-hub-restarts",
      status: "PASS",
      durationMs: Date.now() - stageStarted,
      details: { services: ["mock-hub", "worker", "api"], statePreserved: true },
    }),
  );

  stageStarted = Date.now();
  platformInspection = Object.freeze(
    JSON.parse(
      sql(
        "awp",
        "SELECT json_build_object('migrations',(SELECT count(*)::int FROM typeorm_migrations),'suiteBindings',(SELECT count(*)::int FROM qa_automation_suite_bindings),'automationAttempts',(SELECT count(*)::int FROM qa_automation_attempts),'connectorCommands',(SELECT count(*)::int FROM connector_commands))::text;",
      ),
    ) as Record<string, number>,
  );
  mockInspection = Object.freeze(
    JSON.parse(
      sql(
        "awp_mock",
        "SELECT json_build_object('projects',(SELECT count(*)::int FROM mock_gitlab_projects),'pipelines',(SELECT count(*)::int FROM mock_gitlab_pipelines),'faultRows',(SELECT count(*)::int FROM mock_gitlab_faults),'webhookDeliveries',(SELECT count(*)::int FROM mock_gitlab_webhook_deliveries))::text;",
      ),
    ) as Record<string, number>,
  );
  if (
    (platformInspection.migrations ?? 0) < 1 ||
    (platformInspection.connectorCommands ?? 0) < 1 ||
    mockInspection.projects !== 2 ||
    (mockInspection.pipelines ?? 0) < 1 ||
    (mockInspection.faultRows ?? 0) < 1 ||
    (mockInspection.webhookDeliveries ?? 0) < 1
  )
    throw new Error("FEATURE_005_POSTGRES_INSPECTION_INVALID");
  stages.push(
    Object.freeze({
      id: "postgresql-inspection",
      status: "PASS",
      durationMs: Date.now() - stageStarted,
      details: { platformInspection, mockInspection },
    }),
  );
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  console.error(error);
} finally {
  const cleanupStarted = Date.now();
  const cleanup = execute(process.execPath, [cli, "reset", "--yes"]);
  const remaining = execute(
    "docker",
    ["compose", "--project-name", projectName, "--file", composeFile, "ps", "--quiet"],
    false,
  );
  coreClean = cleanup.status === 0 && !remaining.stdout.trim();
  stages.push(
    Object.freeze({
      id: "core-clean-shutdown",
      status: coreClean ? "PASS" : "FAIL",
      durationMs: Date.now() - cleanupStarted,
    }),
  );
  if (!coreClean) failure ??= "FEATURE_005_CORE_CLEAN_SHUTDOWN_FAILED";
}

if (failure === undefined) {
  const browserStarted = Date.now();
  const browser = execute(process.execPath, [browserProcess], true, {
    ...environment,
    AWP_LOCAL_PROJECT_NAME: `awp-local-005-browser-${token}`,
  });
  const passed = browser.status === 0 && browser.error === undefined;
  stages.push(
    Object.freeze({
      id: "visible-human-review-browser",
      status: passed ? "PASS" : "FAIL",
      durationMs: Date.now() - browserStarted,
    }),
  );
  if (!passed) failure = `FEATURE_005_BROWSER_PROCESS_FAILED:${String(browser.status)}`;
} else {
  stages.push(Object.freeze({ id: "visible-human-review-browser", status: "SKIP", durationMs: 0 }));
}

const digest = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const sourcePaths = Object.freeze([
  "tools/smoke/feature-005.mts",
  "tools/smoke/feature-005-browser-process.mts",
  "tests/e2e/acceptance/005-gitlab-human-review-browser.spec.ts",
  "tools/local/gitlab-scenario-catalog.mts",
  "tools/local/gitlab-scenario.mts",
  "infra/compose/docker-compose.local.yml",
]);
const files = sourcePaths.map((path) =>
  Object.freeze({ path, sha256: digest(readFileSync(resolve(workspace, path))) }),
);
const status =
  failure === undefined && stages.every(({ status: stageStatus }) => stageStatus === "PASS")
    ? "PASS"
    : "FAIL";
const report = Object.freeze({
  schemaVersion: 1,
  feature: "005-gitlab-automated-validation",
  gate: "smoke",
  composition: "qa-jira-gitlab-local",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status,
  isolatedProjectName: projectName,
  scenarios: Object.freeze({
    required: 30,
    executed: executedScenarioIds.length,
    persistedCurrentAfterRestart: persistedAfterRestart[0] ?? null,
    unexecuted: gitLabDocumentedScenarioNames.filter((id) => !executedScenarioIds.includes(id)),
  }),
  restartDurability: Object.freeze({
    api: "PASS",
    worker: "PASS",
    mockHub: "PASS",
    postgresStatePreserved:
      JSON.stringify(persistedBeforeRestart) === JSON.stringify(persistedAfterRestart),
  }),
  durableInspection: Object.freeze({
    platform: platformInspection,
    mockHub: mockInspection,
    sources: ["POSTGRESQL", "MOCK_HUB", "PROCESS_HTTP"],
  }),
  cleanShutdown: coreClean ? "PASS" : "FAIL",
  stages,
  sourceBinding: Object.freeze({ files, aggregateSha256: digest(JSON.stringify(files)) }),
  ...(failure === undefined ? {} : { failure }),
});
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(`[smoke:005] ${status}; report: ${reportPath}`);
if (status !== "PASS") process.exitCode = 1;
