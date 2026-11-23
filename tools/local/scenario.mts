const allowedScenarios = new Set([
  "NORMAL",
  "TIMEOUT",
  "AUTHENTICATION_FAILED",
  "AUTHORIZATION_DENIED",
  "RATE_LIMITED",
  "SERVER_ERROR",
  "SCHEMA_DRIFT",
  "DUPLICATE_EVENT",
  "OUT_OF_ORDER_EVENT",
]);
const action = process.argv[2];
const value = process.argv[3];
const baseUrl = process.env.AWP_MOCK_HUB_URL ?? "http://127.0.0.1:4010";
const endpoint = new URL(baseUrl);
if (
  endpoint.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "mock-hub"].includes(endpoint.hostname)
)
  throw new Error("SCENARIO_ENDPOINT_FORBIDDEN");

async function post(path: string, body?: unknown): Promise<void> {
  const response = await fetch(new URL(path, endpoint), {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`MOCK_HUB_SCENARIO_FAILED:${response.status}`);
  console.log(await response.text());
}

if (action === "set") {
  if (!value || !allowedScenarios.has(value))
    throw new Error(`Scenario must be one of: ${[...allowedScenarios].join(", ")}`);
  await post("/mock/scenario", { scenario: value });
} else if (action === "reset") {
  if (value !== undefined) throw new Error("scenario:reset accepts no value");
  await post("/mock/reset");
  await post("/mock/seed", { seed: 42 });
} else {
  throw new Error("Use: pnpm scenario:set <SCENARIO> or pnpm scenario:reset");
}
