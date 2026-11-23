import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const composeFile = resolve(workspace, "infra/compose/docker-compose.local.yml");
async function freePort() {
  return await new Promise<number>((done, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("AWP_004_FREE_PORT_UNAVAILABLE"));
        return;
      }
      server.close((error) => (error ? reject(error) : done(address.port)));
    });
  });
}
const config = {
  us1: { test: "tests/e2e/004-us1-guided-intake.spec.ts", table: "intake_drafts" },
  us2: { test: "tests/e2e/004-us2-candidate-decisions.spec.ts", table: "intake_candidates" },
  us3: { test: "tests/e2e/004-us3-hermes-proposals.spec.ts", table: "agent_runs" },
  us4: { test: "tests/e2e/004-us4-notification-outage.spec.ts", table: "notification_intents" },
} as const;
async function requireHealthy(url: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let detail = "not attempted";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      detail = `HTTP ${response.status}`;
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, 500);
    });
  }
  throw new Error(`PROCESS_HEALTH_TIMEOUT:${url}:${detail}`);
}
export async function runFeature004StoryProcess(story: keyof typeof config) {
  const plan = process.argv.includes("--plan"),
    keep = process.argv.includes("--keep"),
    requested = process.env.AWP_LOCAL_PROJECT_NAME?.trim(),
    project = requested ?? `awp-local-004-${story}-${Date.now().toString(36)}-${process.pid}`;
  if (!new RegExp(`^awp-local-004-${story}-[a-z0-9]+(?:-[a-z0-9]+)*$`, `u`).test(project))
    throw new Error(`AWP_LOCAL_PROJECT_NAME_UNSAFE:${project}`);
  const ports = plan
    ? [39_000, 39_001, 39_002, 39_003, 39_004]
    : await Promise.all(Array.from({ length: 5 }, freePort));
  const [api, worker, mock, idp, web] = ports;
  const env = {
    ...process.env,
    AWP_LOCAL_PROJECT_NAME: project,
    AWP_COMPOSITION: "qa-jira-mattermost-local",
    AWP_API_HOST_PORT: String(api),
    AWP_WORKER_HOST_PORT: String(worker),
    AWP_MOCK_HUB_HOST_PORT: String(mock),
    AWP_IDP_HOST_PORT: String(idp),
    AWP_WEB_HOST_PORT: String(web),
    AWP_API_URL: `http://127.0.0.1:${api}`,
    AWP_WORKER_URL: `http://127.0.0.1:${worker}`,
    AWP_MOCK_HUB_URL: `http://127.0.0.1:${mock}`,
    AWP_MOCK_HUB_PUBLIC_URL: `http://127.0.0.1:${mock}`,
    AWP_PUBLIC_API_URL: `http://127.0.0.1:${api}`,
    AWP_WEB_ORIGIN: `http://127.0.0.1:${web}`,
    CI: "true",
  };
  const cli = resolve(workspace, "tools/local/mattermost-cli.mts");
  const execute = (
    bin: string,
    args: readonly string[],
    stdio: "inherit" | "pipe" = "inherit",
  ): SpawnSyncReturns<string> =>
    spawnSync(bin, [...args], { cwd: workspace, env, encoding: "utf8", stdio });
  const requireSuccess = (
    label: string,
    bin: string,
    args: readonly string[],
    stdio: "inherit" | "pipe" = "inherit",
  ) => {
    const result = execute(bin, args, stdio);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${label}_FAILED:${result.status}`);
    return result;
  };
  const compose = (args: readonly string[], stdio: "inherit" | "pipe" = "inherit") =>
    requireSuccess(
      "COMPOSE",
      "docker",
      ["compose", "--project-name", project, "--file", composeFile, ...args],
      stdio,
    );
  if (plan) {
    console.log(`AWP_LOCAL_PROJECT_NAME=${project} AWP_COMPOSITION=qa-jira-mattermost-local`);
    console.log([process.execPath, cli, "up"].join(" "));
    console.log(
      [
        process.execPath,
        "node_modules/vitest/vitest.mjs",
        "run",
        config[story].test,
        "--maxWorkers=1",
      ].join(" "),
    );
    console.log(`docker compose restart worker; inspect ${config[story].table}`);
    process.exit(0);
  }
  let exit = 1;
  try {
    requireSuccess("PRECLEAN", process.execPath, [cli, "down"]);
    requireSuccess("UP", process.execPath, [cli, "up"]);
    for (const url of [
      `${env.AWP_API_URL}/health/ready`,
      `${env.AWP_WORKER_URL}/health/ready`,
      `${env.AWP_MOCK_HUB_URL}/health/live`,
    ])
      await requireHealthy(url);
    requireSuccess("STORY_E2E", process.execPath, [
      "node_modules/vitest/vitest.mjs",
      "run",
      config[story].test,
      "--maxWorkers=1",
    ]);
    const table = compose(
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
        `SELECT to_regclass('public.${config[story].table}');`,
      ],
      "pipe",
    ).stdout.trim();
    if (table !== config[story].table) throw new Error(`DURABLE_TABLE_MISSING:${table}`);
    compose(["restart", "worker"]);
    await requireHealthy(`${env.AWP_WORKER_URL}/health/ready`);
    await requireHealthy(`${env.AWP_API_URL}/health/ready`);
    if (story === "us4") {
      compose(["restart", "mock-hub"]);
      await requireHealthy(`${env.AWP_MOCK_HUB_URL}/health/live`);
    }
    exit = 0;
  } catch (error) {
    console.error(error);
  } finally {
    if (!keep) execute(process.execPath, [cli, "down"]);
  }
  if (exit !== 0) process.exitCode = exit;
}
