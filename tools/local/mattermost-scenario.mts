import {
  mattermostScenarioCatalog,
  type MattermostScenarioName,
} from "./mattermost-scenario-catalog.mts";

const name = process.argv[2];
if (!name || name === "--list") {
  console.log(Object.keys(mattermostScenarioCatalog).join("\n"));
  process.exit(0);
}
if (!(name in mattermostScenarioCatalog)) throw new Error(`MATTERMOST_SCENARIO_UNKNOWN:${name}`);
const fault = mattermostScenarioCatalog[name as MattermostScenarioName];
if (process.argv.includes("--plan")) {
  console.log(`${name} -> ${fault}`);
  process.exit(0);
}
const endpoint = new URL(
  "/mock/mattermost/fault",
  process.env.AWP_MOCK_HUB_URL ?? "http://127.0.0.1:4010",
);
const response = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ fault, remaining: 1 }),
});
if (!response.ok) throw new Error(`MATTERMOST_SCENARIO_HTTP_${response.status}`);
console.log(`[mattermost:scenario] ${name} -> ${fault}`);
