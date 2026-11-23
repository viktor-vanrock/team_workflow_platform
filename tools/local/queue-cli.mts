import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const queueLocalContour = Object.freeze({
  composition: "qa-jira-gitlab-mattermost-local",
  environment: "LOCAL",
  runtimeProfile: "local",
  externalNetworkMode: "deny",
  productionEndpoints: 0,
  realProviderCredentials: 0,
});

const allowed = new Set(["up", "status", "migrate", "seed", "down", "reset"]);

export async function runQueueLocalCli(argv = process.argv.slice(2)): Promise<void> {
  const args = argv.filter((value) => value !== "--");
  const command = args[0] ?? "status";
  const plan = args.includes("--plan");
  if (!allowed.has(command)) throw new Error(`QUEUE_LOCAL_COMMAND_UNKNOWN:${command}`);
  const commandArgs = args.slice(1).filter((value) => value !== "--plan");
  if (command === "reset") {
    if (!plan && (commandArgs.length !== 1 || commandArgs[0] !== "--yes"))
      throw new Error("local:queue:reset requires the exact confirmation flag --yes");
    if (plan && commandArgs.some((value) => value !== "--yes"))
      throw new Error("QUEUE_LOCAL_RESET_ARGUMENTS_INVALID");
  } else if (commandArgs.length > 0)
    throw new Error(`local:queue:${command} accepts no additional arguments`);
  if (process.env.AWP_COMPOSITION && process.env.AWP_COMPOSITION !== queueLocalContour.composition)
    throw new Error("QUEUE_LOCAL_COMPOSITION_OVERRIDE_FORBIDDEN");
  if (process.env.AWP_EXTERNAL_NETWORK_MODE && process.env.AWP_EXTERNAL_NETWORK_MODE !== "deny")
    throw new Error("QUEUE_LOCAL_EXTERNAL_NETWORK_OVERRIDE_FORBIDDEN");
  if (plan) {
    console.log(
      JSON.stringify(
        {
          command,
          ...queueLocalContour,
          destructive: command === "reset",
          requiresConfirmation: command === "reset",
        },
        null,
        2,
      ),
    );
    return;
  }
  process.env.AWP_ENVIRONMENT = "LOCAL";
  process.env.AWP_RUNTIME_PROFILE = "local";
  process.env.AWP_COMPOSITION = queueLocalContour.composition;
  process.env.AWP_EXTERNAL_NETWORK_MODE = "deny";
  process.env.AWP_QUEUE_STATIC_CONTOUR = "true";
  process.argv = [process.argv[0]!, process.argv[1]!, command, ...commandArgs];
  await import("./local.mts");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await runQueueLocalCli();
