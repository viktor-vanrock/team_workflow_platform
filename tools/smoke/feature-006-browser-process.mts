import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const planOnly = process.argv.includes("--plan");
const existing = process.argv.includes("--existing");
const keep = process.argv.includes("--keep");
const unknown = process.argv
  .slice(2)
  .filter((value) => !["--plan", "--existing", "--keep"].includes(value));
if (unknown.length > 0)
  throw new Error(`FEATURE_006_BROWSER_ARGUMENT_UNKNOWN:${unknown.join(",")}`);
const requested = process.env.AWP_LOCAL_PROJECT_NAME?.trim();
const projectName = requested || `awp-local-006-browser-${Date.now().toString(36)}-${process.pid}`;
if (!/^awp-local-006-(?:browser|smoke)-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(projectName))
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
  ? [41_000, 41_001, 41_002, 41_003, 41_004]
  : existing
    ? [
        Number(process.env.AWP_API_HOST_PORT),
        Number(process.env.AWP_WORKER_HOST_PORT),
        Number(process.env.AWP_MOCK_HUB_HOST_PORT),
        Number(process.env.AWP_IDP_HOST_PORT),
        Number(process.env.AWP_WEB_HOST_PORT),
      ]
    : await Promise.all(Array.from({ length: 5 }, freePort));
if (ports.some((value) => !Number.isSafeInteger(value) || value < 1))
  throw new Error("FEATURE_006_BROWSER_PORTS_INVALID");
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
  AWP_WEB_URL: `http://127.0.0.1:${webPort}`,
  AWP_PUBLIC_API_URL: `http://127.0.0.1:${apiPort}`,
  AWP_WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
  CI: "true",
};
const cli = resolve(workspace, "tools/local/queue-cli.mts");
const playwright = resolve(workspace, "node_modules/@playwright/test/cli.js");
const journey = "tests/e2e/acceptance/006-queue-live-browser.spec.ts";
const execute = (executable: string, args: readonly string[]): SpawnSyncReturns<string> =>
  spawnSync(executable, [...args], {
    cwd: workspace,
    env: environment,
    encoding: "utf8",
    stdio: "inherit",
  });
const requireSuccess = (label: string, executable: string, args: readonly string[]) => {
  const result = execute(executable, args);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label}_FAILED:${String(result.status)}`);
};

if (planOnly) {
  console.log(
    `AWP_LOCAL_PROJECT_NAME=${projectName} AWP_COMPOSITION=qa-jira-gitlab-mattermost-local AWP_WEB_URL=${environment.AWP_WEB_URL}`,
  );
  if (!existing) console.log([process.execPath, cli, "up"].join(" "));
  console.log(
    [process.execPath, playwright, "test", journey, "--project=chromium", "--workers=1"].join(" "),
  );
  if (!existing) console.log([process.execPath, cli, "reset", "--yes"].join(" "));
  process.exit(0);
}

let exitCode = 1;
try {
  if (!existing) {
    requireSuccess("SCOPED_PRECLEAN", process.execPath, [cli, "down"]);
    requireSuccess("QUEUE_LOCAL_UP", process.execPath, [cli, "up"]);
  }
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
  if (!existing && !keep) {
    const cleanup = execute(process.execPath, [cli, "reset", "--yes"]);
    if (cleanup.error || cleanup.status !== 0) exitCode = 1;
  }
}
if (exitCode !== 0) process.exitCode = exitCode;
