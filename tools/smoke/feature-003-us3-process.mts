import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const requestedProjectName = process.env.AWP_LOCAL_PROJECT_NAME?.trim();
const projectName =
  requestedProjectName || `awp-local-003-us3-${Date.now().toString(36)}-${process.pid}`;
const planOnly = process.argv.includes("--plan");
const keep = process.argv.includes("--keep");
if (!/^awp-local-003-us3-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(projectName))
  throw new Error(`AWP_LOCAL_PROJECT_NAME_UNSAFE:${projectName}`);

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
  ? [35_000, 35_001, 35_002, 35_003, 35_004]
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
  AWP_MOCK_HUB_PUBLIC_URL: `http://127.0.0.1:${mockHubPort}`,
  AWP_PUBLIC_API_URL: `http://127.0.0.1:${apiPort}`,
  AWP_WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
  CI: "true",
};
const jiraCli = resolve(workspace, "tools/local/jira-cli.mts");
const playwrightCli = resolve(workspace, "node_modules/@playwright/test/cli.js");
const acceptanceSpec = "tests/e2e/acceptance/003-us3-operational-action-worker.spec.ts";
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
function cleanup(): void {
  if (keep) {
    console.log(`[smoke:003:us3:process] keeping scoped stack ${projectName}`);
    return;
  }
  const result = execute(process.execPath, [jiraCli, "down"]);
  if (result.error) console.error(result.error);
}
if (planOnly) {
  console.log(`AWP_LOCAL_PROJECT_NAME=${projectName} AWP_COMPOSITION=qa-jira-local`);
  console.log([process.execPath, jiraCli, "up"].join(" "));
  console.log(
    [
      process.execPath,
      playwrightCli,
      "test",
      acceptanceSpec,
      "--project=chromium",
      "--workers=1",
    ].join(" "),
  );
  process.exit(0);
}
let exitCode = 1;
try {
  requireSuccess("SCOPED_PRECLEAN", process.execPath, [jiraCli, "down"]);
  requireSuccess("QA_JIRA_LOCAL_UP", process.execPath, [jiraCli, "up"]);
  const run = execute(process.execPath, [
    playwrightCli,
    "test",
    acceptanceSpec,
    "--project=chromium",
    "--workers=1",
  ]);
  if (run.error) throw run.error;
  exitCode = run.status ?? 1;
} catch (error) {
  console.error(error);
} finally {
  cleanup();
}
if (exitCode !== 0) process.exitCode = exitCode;
