import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";

import { queueDocumentedScenarioIds } from "../local/queue-scenario-catalog.mts";
import { stringifyPortableJson } from "../verification/portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const composeFile = resolve(workspace, "infra/compose/docker-compose.local.yml");
const cli = resolve(workspace, "tools/local/queue-cli.mts");
const scenarioCli = resolve(workspace, "tools/local/queue-scenario.mts");
const browserProcess = resolve(workspace, "tools/smoke/feature-006-browser-process.mts");
const reportPath = resolve(workspace, "reports/006-queue-triage-capacity-sla/smoke.json");
const planOnly = process.argv.includes("--plan");
const unknown = process.argv.slice(2).filter((value) => value !== "--" && value !== "--plan");
if (unknown.length > 0) throw new Error(`Unknown smoke:006 arguments: ${unknown.join(", ")}`);
const token = `${Date.now().toString(36)}-${process.pid}`;
const projectName = `awp-local-006-smoke-${token}`;

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
  ? [42_000, 42_001, 42_002, 42_003, 42_004]
  : await Promise.all(Array.from({ length: 5 }, freePort));
const [apiPort, workerPort, mockHubPort, idpPort, webPort] = ports;
const environment = {
  ...process.env,
  AWP_LOCAL_PROJECT_NAME: projectName,
  AWP_ENVIRONMENT: "LOCAL",
  AWP_RUNTIME_PROFILE: "local",
  AWP_COMPOSITION: "qa-jira-gitlab-mattermost-local",
  AWP_EXTERNAL_NETWORK_MODE: "deny",
  AWP_QUEUE_STATIC_CONTOUR: "true",
  AWP_API_HOST_PORT: String(apiPort),
  AWP_WORKER_HOST_PORT: String(workerPort),
  AWP_MOCK_HUB_HOST_PORT: String(mockHubPort),
  AWP_IDP_HOST_PORT: String(idpPort),
  AWP_WEB_HOST_PORT: String(webPort),
  AWP_API_URL: `http://127.0.0.1:${apiPort}`,
  AWP_WORKER_URL: `http://127.0.0.1:${workerPort}`,
  AWP_MOCK_HUB_URL: `http://127.0.0.1:${mockHubPort}`,
  AWP_PUBLIC_API_URL: `http://127.0.0.1:${apiPort}`,
  AWP_WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
  AWP_WEB_URL: `http://127.0.0.1:${webPort}`,
  CI: "true",
};
const execute = (
  executable: string,
  args: readonly string[],
  inherit = true,
): SpawnSyncReturns<string> =>
  spawnSync(executable, [...args], {
    cwd: workspace,
    env: environment,
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
const requireSuccess = (
  label: string,
  executable: string,
  args: readonly string[],
  inherit = true,
): SpawnSyncReturns<string> => {
  const result = execute(executable, args, inherit);
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${label}_FAILED:${String(result.status)}:${result.stderr ?? ""}`);
  return result;
};
const compose = (args: readonly string[], inherit = true) =>
  requireSuccess(
    "FEATURE_006_COMPOSE",
    "docker",
    ["compose", "--project-name", projectName, "--file", composeFile, ...args],
    inherit,
  );
const sql = (statement: string): string =>
  compose(
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
      "awp",
      "--tuples-only",
      "--no-align",
      "--command",
      statement,
    ],
    false,
  ).stdout.trim();
async function waitReady(name: string, url: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The readiness probe is best-effort until its retry budget is exhausted.
    }
    await new Promise((resolveWait) => {
      setTimeout(resolveWait, 500);
    });
  }
  throw new Error(`FEATURE_006_${name}_RESTART_TIMEOUT`);
}

if (planOnly) {
  console.log(
    `AWP_LOCAL_PROJECT_NAME=${projectName} AWP_COMPOSITION=qa-jira-gitlab-mattermost-local`,
  );
  console.log([process.execPath, cli, "up"].join(" "));
  console.log(
    `${queueDocumentedScenarioIds.length} documented queue scenarios in isolated child processes`,
  );
  console.log(
    "docker compose restart postgres mock-hub worker api web; durable PostgreSQL inspection; readiness",
  );
  console.log([process.execPath, browserProcess, "--existing"].join(" "));
  console.log([process.execPath, cli, "reset", "--yes"].join(" "));
  process.exit(0);
}

const startedAt = new Date();
const stages: Array<
  Readonly<{ id: string; status: "PASS" | "FAIL" | "SKIP"; durationMs: number; details?: unknown }>
> = [];
let failure: string | undefined;
let inspection: Readonly<Record<string, number>> = Object.freeze({});
let scenarioCount = 0;
let cleanShutdown: boolean;
try {
  requireSuccess("SCOPED_PRECLEAN", process.execPath, [cli, "down"]);
  let at = Date.now();
  requireSuccess("QUEUE_LOCAL_UP", process.execPath, [cli, "up"]);
  await Promise.all([
    waitReady("API", `${environment.AWP_API_URL}/health/ready`),
    waitReady("WORKER", `${environment.AWP_WORKER_URL}/health/ready`),
    waitReady("MOCK_HUB", `${environment.AWP_MOCK_HUB_URL}/health/live`),
    waitReady("WEB", environment.AWP_WEB_URL),
  ]);
  stages.push(
    Object.freeze({
      id: "isolated-local-up",
      status: "PASS",
      durationMs: Date.now() - at,
      details: { projectName, ports },
    }),
  );
  at = Date.now();
  requireSuccess("SCENARIO_CATALOG", process.execPath, [
    "tools/local/queue-scenario-catalog.mts",
    "--check",
  ]);
  for (const id of queueDocumentedScenarioIds) {
    requireSuccess(`SCENARIO_${id}`, process.execPath, [scenarioCli, id], false);
    scenarioCount += 1;
  }
  stages.push(
    Object.freeze({
      id: "scenario-child-processes",
      status: "PASS",
      durationMs: Date.now() - at,
      details: { required: queueDocumentedScenarioIds.length, executed: scenarioCount },
    }),
  );
  at = Date.now();
  for (const service of ["postgres", "mock-hub", "worker", "api", "web"] as const) {
    compose(["restart", service]);
    if (service === "mock-hub")
      await waitReady("MOCK_HUB", `${environment.AWP_MOCK_HUB_URL}/health/live`);
    if (service === "worker")
      await waitReady("WORKER", `${environment.AWP_WORKER_URL}/health/ready`);
    if (service === "api") await waitReady("API", `${environment.AWP_API_URL}/health/ready`);
    if (service === "web") await waitReady("WEB", environment.AWP_WEB_URL);
  }
  stages.push(
    Object.freeze({
      id: "durable-service-restarts",
      status: "PASS",
      durationMs: Date.now() - at,
      details: { services: ["postgres", "mock-hub", "worker", "api", "web"] },
    }),
  );
  at = Date.now();
  inspection = Object.freeze(
    JSON.parse(
      sql(
        "SELECT json_build_object('migrations',(SELECT count(*)::int FROM typeorm_migrations),'queueSeed',(SELECT count(*)::int FROM local_seed_markers WHERE key='006-qa-jira-gitlab-mattermost-queue-local'),'queuePolicies',(SELECT count(*)::int FROM workspace_queue_policy_revisions),'queueEntries',(SELECT count(*)::int FROM queue_entry_revisions),'slaClocks',(SELECT count(*)::int FROM sla_clock_revisions),'capacityDecisions',(SELECT count(*)::int FROM capacity_admission_decisions))::text;",
      ),
    ) as Record<string, number>,
  );
  if (
    (inspection.migrations ?? 0) < 1 ||
    inspection.queueSeed !== 1 ||
    (inspection.queuePolicies ?? 0) < 1
  )
    throw new Error("FEATURE_006_POSTGRES_INSPECTION_INVALID");
  stages.push(
    Object.freeze({
      id: "postgres-durable-inspection",
      status: "PASS",
      durationMs: Date.now() - at,
      details: inspection,
    }),
  );
  at = Date.now();
  requireSuccess("LIVE_BROWSER", process.execPath, [browserProcess, "--existing"]);
  stages.push(Object.freeze({ id: "live-browser", status: "PASS", durationMs: Date.now() - at }));
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  console.error(error);
} finally {
  const at = Date.now();
  const cleanup = execute(process.execPath, [cli, "reset", "--yes"], false);
  const remaining = execute(
    "docker",
    ["compose", "--project-name", projectName, "--file", composeFile, "ps", "--quiet"],
    false,
  );
  cleanShutdown = cleanup.status === 0 && !remaining.stdout.trim();
  stages.push(
    Object.freeze({
      id: "clean-shutdown",
      status: cleanShutdown ? "PASS" : "FAIL",
      durationMs: Date.now() - at,
    }),
  );
  if (!cleanShutdown) failure ??= "FEATURE_006_CLEAN_SHUTDOWN_FAILED";
}
const digest = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const paths = [
  "tools/smoke/feature-006.mts",
  "tools/smoke/feature-006-browser-process.mts",
  "tests/e2e/acceptance/006-queue-live-browser.spec.ts",
  "tools/local/queue-cli.mts",
  "tools/local/queue-scenario.mts",
  "infra/compose/docker-compose.local.yml",
];
const files = paths.map((path) =>
  Object.freeze({ path, sha256: digest(readFileSync(resolve(workspace, path))) }),
);
const status =
  failure === undefined && stages.every(({ status: stageStatus }) => stageStatus === "PASS")
    ? "PASS"
    : "FAIL";
const report = Object.freeze({
  schemaVersion: 1,
  feature: "006-queue-triage-capacity-sla",
  checkpoint: "SMOKE",
  status,
  contour: "qa-jira-gitlab-mattermost-local",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  isolatedProjectName: projectName,
  scenarioExecution: { required: queueDocumentedScenarioIds.length, executed: scenarioCount },
  restarts: ["postgres", "mock-hub", "worker", "api", "web"],
  durableInspection: inspection,
  cleanShutdown,
  stages,
  sourceBinding: { files, aggregateSha256: digest(JSON.stringify(files)) },
  ...(failure ? { failure } : {}),
});
mkdirSync(dirname(reportPath), { recursive: true });
const temporary = `${reportPath}.${process.pid}.tmp`;
writeFileSync(temporary, stringifyPortableJson(report, workspace), "utf8");
renameSync(temporary, reportPath);
console.log(`[smoke:006] ${status}; report: ${reportPath}`);
if (status !== "PASS") process.exitCode = 1;
