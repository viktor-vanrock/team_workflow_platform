import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const onboardingLocalContour = Object.freeze({
  composition: "qa-jira-gitlab-mattermost-local",
  environment: "LOCAL",
  runtimeProfile: "local",
  externalNetworkMode: "deny",
  productionEndpoints: 0,
  realProviderCredentials: 0,
  evidenceSigner: "local-ed25519",
});

const allowed = new Set(["up", "status", "migrate", "seed", "down", "reset"]);
function captureOnboardingStatus(): void {
  const workspace = resolve(import.meta.dirname, "../..");
  const composeFile = resolve(workspace, "infra/compose/docker-compose.local.yml");
  const projectName = process.env.AWP_LOCAL_PROJECT_NAME?.trim() || "awp-local";
  if (!/^awp-local(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/u.test(projectName))
    throw new Error(`AWP_LOCAL_PROJECT_NAME_INVALID:${projectName}`);
  const query = (database: "awp" | "awp_mock", sql: string): string => {
    const result = spawnSync(
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
        "-U",
        "awp_bootstrap",
        "-d",
        database,
        "-At",
        "-c",
        sql,
      ],
      { cwd: workspace, env: process.env, encoding: "utf8" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`ONBOARDING_LOCAL_STATUS_QUERY_FAILED:${database}`);
    return result.stdout.trim();
  };
  const schemaHeads = query(
    "awp",
    "SELECT namespace||'='||version FROM platform_schema_versions ORDER BY namespace",
  )
    .split("\n")
    .filter(Boolean);
  const effectCount = query(
    "awp_mock",
    "SELECT COALESCE((SELECT sum(effect_count) FROM mock_effects),0)+COALESCE((SELECT sum(effect_count) FROM operational_request_effects),0)+COALESCE((SELECT sum(effect_count) FROM operational_defect_effects),0)",
  );
  console.log(`schema.heads=${schemaHeads.join(",")}`);
  console.log(`mock-hub.effect-count=${effectCount}`);
  const projects = JSON.parse(
    query(
      "awp",
      "SELECT COALESCE(json_agg(row_to_json(p)),'[]'::json) FROM (SELECT h.project_id AS id,h.current_stage AS stage,h.current_capability_mode AS mode,h.current_operational_state AS state,p.classification_key AS classification FROM project_onboarding_headers h JOIN projects p ON p.workspace_id=h.workspace_id AND p.id=h.project_id ORDER BY h.workspace_id,h.project_id) p",
    ),
  ) as { id: string; stage: string; mode: string; state: string; classification: string }[];
  for (const project of projects)
    console.log(
      `onboarding.project=${project.id} stage=${project.stage} mode=${project.mode} state=${project.state} classification=${project.classification}`,
    );
}

export async function runOnboardingLocalCli(argv = process.argv.slice(2)): Promise<void> {
  const args = argv.filter((value) => value !== "--");
  const command = args[0] ?? "status";
  const plan = args.includes("--plan");
  if (!allowed.has(command)) throw new Error(`ONBOARDING_LOCAL_COMMAND_UNKNOWN:${command}`);
  const commandArgs = args.slice(1).filter((value) => value !== "--plan");
  if (command === "reset") {
    if (!plan && (commandArgs.length !== 1 || commandArgs[0] !== "--yes"))
      throw new Error("local:onboarding:reset requires the exact confirmation flag --yes");
  } else if (commandArgs.length > 0)
    throw new Error(`local:onboarding:${command} accepts no additional arguments`);
  if (
    process.env.AWP_COMPOSITION &&
    process.env.AWP_COMPOSITION !== onboardingLocalContour.composition
  )
    throw new Error("ONBOARDING_LOCAL_COMPOSITION_OVERRIDE_FORBIDDEN");
  if (process.env.AWP_EXTERNAL_NETWORK_MODE && process.env.AWP_EXTERNAL_NETWORK_MODE !== "deny")
    throw new Error("ONBOARDING_LOCAL_EXTERNAL_NETWORK_OVERRIDE_FORBIDDEN");
  if (plan) {
    console.log(
      JSON.stringify(
        {
          command,
          ...onboardingLocalContour,
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
  process.env.AWP_COMPOSITION = onboardingLocalContour.composition;
  process.env.AWP_EXTERNAL_NETWORK_MODE = "deny";
  process.env.AWP_QUEUE_STATIC_CONTOUR = "true";
  process.env.AWP_ONBOARDING_STATIC_CONTOUR = "true";
  process.env.AWP_EVIDENCE_SIGNER = "local-ed25519";
  process.env.AWP_EVIDENCE_SIGNER_KID = "local-ed25519:1";
  process.env.AWP_EVIDENCE_SIGNER_PRIVATE_MATERIAL = "true";
  const localCommand = command === "down" ? "reset" : command;
  const localArgs = command === "down" ? ["--yes"] : commandArgs;
  process.argv = [process.argv[0]!, process.argv[1]!, localCommand, ...localArgs];
  await import("./local.mts");
  if (command === "status") captureOnboardingStatus();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await runOnboardingLocalCli();
