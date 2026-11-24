import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function runPilotDevelopment(argv = process.argv.slice(2)) {
  const [command = "status", ...args] = argv.filter((value) => value !== "--");
  if (
    !["up", "status", "logs", "migrate", "seed", "down"].includes(command) ||
    args.some((value) => value !== "--plan")
  )
    throw new Error("PILOT_DEV_COMMAND_INVALID");
  const environment = {
    AWP_LOCAL_PROJECT_NAME: "awp-local-pilot-dev",
    AWP_ENVIRONMENT: "LOCAL",
    AWP_RUNTIME_PROFILE: "local",
    AWP_COMPOSITION: "qa-jira-gitlab-mattermost-local",
    AWP_EXTERNAL_NETWORK_MODE: "deny",
    AWP_QUEUE_STATIC_CONTOUR: "true",
    AWP_ONBOARDING_STATIC_CONTOUR: "true",
    AWP_PILOT_ADAPTER_MODE: "development",
    AWP_PILOT_COMPOSE_OVERRIDE: "true",
    AWP_API_HOST_PORT: "5300",
    AWP_WORKER_HOST_PORT: "5310",
    AWP_WEB_HOST_PORT: "55173",
    AWP_MOCK_HUB_HOST_PORT: "54010",
    AWP_IDP_HOST_PORT: "54443",
    AWP_WEB_ORIGIN: "http://localhost:55173",
    AWP_PUBLIC_API_URL: "http://localhost:5300",
    AWP_EVIDENCE_SIGNER: "local-ed25519",
    COMPOSE_PROFILES: "observability",
    AWP_OTEL_COLLECTOR_ORIGIN: "http://otel-collector:4318",
    AWP_OTEL_GRPC_HOST_PORT: "54317",
    AWP_OTEL_HTTP_HOST_PORT: "54318",
  };
  for (const key of [
    "AWP_ENVIRONMENT",
    "AWP_RUNTIME_PROFILE",
    "AWP_COMPOSITION",
    "AWP_EXTERNAL_NETWORK_MODE",
  ] as const)
    if (process.env[key] && process.env[key] !== environment[key])
      throw new Error("PILOT_DEV_ENVIRONMENT_CONFLICT");
  if (args.includes("--plan")) {
    console.log(
      JSON.stringify(
        { command, environment, adapters: "DEVELOPMENT_MOCKS", corporateConformance: "NOT_RUN" },
        null,
        2,
      ),
    );
    return;
  }
  Object.assign(process.env, environment);
  process.argv = [process.argv[0]!, process.argv[1]!, command];
  await import("./local.mts");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await runPilotDevelopment();
