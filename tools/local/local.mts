import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "../..");
const composeFile = resolve(workspace, "infra/compose/docker-compose.local.yml");
const certificateScript = resolve(workspace, "infra/compose/scripts/generate-fake-idp-cert.sh");
const projectName = process.env.AWP_LOCAL_PROJECT_NAME?.trim() || "awp-local";
if (!/^awp-local(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/u.test(projectName))
  throw new Error(`AWP_LOCAL_PROJECT_NAME_INVALID:${projectName}`);
const command = process.argv[2] ?? "status";
const commandArgs = process.argv.slice(3).filter((value) => value !== "--");
const composition = process.env.AWP_COMPOSITION?.trim() || "foundation";
if (
  !new Set([
    "foundation",
    "qa-local",
    "qa-jira-local",
    "qa-jira-mattermost-local",
    "qa-jira-gitlab-local",
    "qa-jira-gitlab-mattermost-local",
  ]).has(composition)
)
  throw new Error(`AWP_COMPOSITION_INVALID:${composition}`);

function run(executable: string, args: readonly string[]): void {
  const result = spawnSync(executable, [...args], {
    cwd: workspace,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function compose(args: readonly string[]): void {
  run("docker", ["compose", "--project-name", projectName, "--file", composeFile, ...args]);
}

function printStatus(): void {
  compose(["ps"]);
  const webPort = process.env.AWP_WEB_HOST_PORT?.trim() || "5173";
  const apiPort = process.env.AWP_API_HOST_PORT?.trim() || "3000";
  console.log(
    `runtime.profile=local | composition=${composition} | web=http://localhost:${webPort} | api=http://localhost:${apiPort} | OpenAPI=http://localhost:${apiPort}/api/docs`,
  );
}

switch (command) {
  case "up":
    if (commandArgs.length > 0) throw new Error("local:up accepts no additional arguments");
    run(certificateScript, []);
    compose(["build", "core-migrate"]);
    compose(["up", "--detach", "--wait"]);
    printStatus();
    break;
  case "status":
    if (commandArgs.length > 0) throw new Error("local:status accepts no additional arguments");
    printStatus();
    break;
  case "logs":
    if (commandArgs.some((value) => value.startsWith("-")))
      throw new Error("local:logs accepts service names only");
    compose(["logs", "--tail", "200", ...commandArgs]);
    break;
  case "seed":
    if (commandArgs.length > 0) throw new Error("local:seed accepts no additional arguments");
    compose(["run", "--rm", "core-seed"]);
    compose(["run", "--rm", "mock-seed"]);
    break;
  case "migrate":
    if (commandArgs.length > 0) throw new Error("local:migrate accepts no additional arguments");
    compose(["run", "--rm", "core-migrate"]);
    compose(["run", "--rm", "mock-migrate"]);
    break;
  case "down":
    if (commandArgs.length > 0) throw new Error("local:down accepts no additional arguments");
    compose(["down", "--remove-orphans"]);
    break;
  case "reset":
    if (commandArgs.length !== 1 || commandArgs[0] !== "--yes")
      throw new Error("local:reset requires the exact confirmation flag --yes");
    compose(["down", "--volumes", "--remove-orphans"]);
    console.log(
      `Removed only ${projectName} containers and named volumes; the next local:up will migrate and seed from scratch.`,
    );
    break;
  default:
    throw new Error(`Unknown local command: ${command}`);
}
