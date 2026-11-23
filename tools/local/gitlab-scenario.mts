import { gitLabDocumentedScenarioNames } from "./gitlab-scenario-catalog.mts";

const scenarios = Object.freeze({
  ...(Object.fromEntries(
    gitLabDocumentedScenarioNames.map((scenarioId) => [
      scenarioId,
      Object.freeze({ kind: "scenario", scenarioId }),
    ]),
  ) as Readonly<
    Record<
      (typeof gitLabDocumentedScenarioNames)[number],
      Readonly<{ kind: "scenario"; scenarioId: string }>
    >
  >),
  "fault-authentication": Object.freeze({
    kind: "fault",
    operation: "PROJECT_READ",
    fault: "AUTHENTICATION_401",
  }),
  "fault-permission": Object.freeze({
    kind: "fault",
    operation: "PROJECT_READ",
    fault: "PERMISSION_403",
  }),
  "fault-rate-limit": Object.freeze({
    kind: "fault",
    operation: "PIPELINE_READ",
    fault: "RATE_LIMIT_429",
  }),
  "fault-timeout-before-effect": Object.freeze({
    kind: "fault",
    operation: "PIPELINE_TRIGGER",
    fault: "TIMEOUT_BEFORE_INVOCATION",
  }),
  "fault-timeout-after-effect": Object.freeze({
    kind: "fault",
    operation: "PIPELINE_TRIGGER",
    fault: "TIMEOUT_AFTER_POSSIBLE_EFFECT",
  }),
  reset: Object.freeze({ kind: "fault", operation: "PROJECT_READ", fault: "NORMAL" }),
} as const);
type ScenarioName = keyof typeof scenarios;

const name = process.argv[2];
if (!name || name === "--list") {
  console.log(Object.keys(scenarios).join("\n"));
  process.exit(0);
}
if (!(name in scenarios)) throw new Error(`GITLAB_SCENARIO_UNKNOWN:${name}`);
const scenario = scenarios[name as ScenarioName];
if (process.argv.includes("--plan")) {
  console.log(`${name} -> ${JSON.stringify(scenario)}`);
  process.exit(0);
}
const baseUrl = new URL(process.env.AWP_MOCK_HUB_URL ?? "http://127.0.0.1:4010");
if (
  baseUrl.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "mock-hub"].includes(baseUrl.hostname)
)
  throw new Error("GITLAB_SCENARIO_ENDPOINT_FORBIDDEN");
const response = await fetch(new URL(`/mock/gitlab/${scenario.kind}`, baseUrl), {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-awp-mock-control-key": process.env.AWP_MOCK_CONTROL_KEY ?? "local-gitlab-control",
  },
  body: JSON.stringify({
    projectId: 5001,
    ...(scenario.kind === "scenario"
      ? { scenarioId: scenario.scenarioId }
      : { operation: scenario.operation, fault: scenario.fault, remaining: 1 }),
  }),
});
if (!response.ok) throw new Error(`GITLAB_SCENARIO_HTTP_${response.status}`);
console.log(`[gitlab:scenario] ${name} -> ${await response.text()}`);
