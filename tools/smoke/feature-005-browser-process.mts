import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const requested = process.env.AWP_LOCAL_PROJECT_NAME?.trim();
const projectName = requested || `awp-local-005-browser-${Date.now().toString(36)}-${process.pid}`;
const planOnly = process.argv.includes("--plan");
const keep = process.argv.includes("--keep");
if (!/^awp-local-005-browser-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(projectName))
  throw new Error(`AWP_LOCAL_PROJECT_NAME_UNSAFE:${projectName}`);

async function freePort(): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return server.close(() => reject(new Error("AWP_BROWSER_FREE_PORT_UNAVAILABLE")));
      return server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });
}

const ports = planOnly
  ? [39_000, 39_001, 39_002, 39_003, 39_004]
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
  AWP_MOCK_HUB_PUBLIC_URL: `http://127.0.0.1:${mockHubPort}`,
  AWP_PUBLIC_API_URL: `http://127.0.0.1:${apiPort}`,
  AWP_WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
  AWP_WEB_URL: `http://127.0.0.1:${webPort}`,
  CI: "true",
};
const cli = resolve(workspace, "tools/local/gitlab-cli.mts");
const playwright = resolve(workspace, "node_modules/@playwright/test/cli.js");
const journey = "tests/e2e/acceptance/005-gitlab-human-review-browser.spec.ts";

function execute(executable: string, args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync(executable, [...args], {
    cwd: workspace,
    env: environment,
    encoding: "utf8",
    stdio: "inherit",
  });
}
function requireSuccess(label: string, executable: string, args: readonly string[]): void {
  const result = execute(executable, args);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label}_FAILED:${String(result.status)}`);
}

if (planOnly) {
  console.log(
    `AWP_LOCAL_PROJECT_NAME=${projectName} AWP_COMPOSITION=qa-jira-gitlab-local AWP_WEB_URL=${environment.AWP_WEB_URL}`,
  );
  console.log([process.execPath, cli, "up"].join(" "));
  console.log(
    [process.execPath, playwright, "test", journey, "--project=chromium", "--workers=1"].join(" "),
  );
  console.log([process.execPath, cli, "down"].join(" "));
  process.exit(0);
}

let exitCode = 1;
try {
  requireSuccess("SCOPED_PRECLEAN", process.execPath, [cli, "down"]);
  requireSuccess("GITLAB_LOCAL_UP", process.execPath, [cli, "up"]);
  const run = execute(process.execPath, [
    playwright,
    "test",
    journey,
    "--project=chromium",
    "--workers=1",
  ]);
  if (run.error) throw run.error;
  exitCode = run.status ?? 1;
} catch (error) {
  console.error(error);
} finally {
  if (!keep) {
    const cleanup = execute(process.execPath, [cli, "reset", "--yes"]);
    if (cleanup.error || cleanup.status !== 0) exitCode = 1;
  }
}
if (exitCode !== 0) process.exitCode = exitCode;
