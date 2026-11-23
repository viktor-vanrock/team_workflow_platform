import { jiraScenarioCatalog, type JiraScenarioName } from "./jira-scenario-catalog.mts";

const name = process.argv[2];
if (!name || name === "--list") {
  console.log(Object.keys(jiraScenarioCatalog).join("\n"));
  process.exit(0);
}
if (!(name in jiraScenarioCatalog)) throw new Error(`JIRA_SCENARIO_UNKNOWN:${name}`);

const scenario = jiraScenarioCatalog[name as JiraScenarioName];
if (process.argv.includes("--plan")) {
  console.log(`${name} -> ${scenario}`);
  process.exit(0);
}

const endpoint = new URL(
  "/mock/jira/scenario",
  process.env.AWP_MOCK_HUB_URL ?? "http://127.0.0.1:4010",
);
const response = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ scenario }),
});
if (!response.ok) throw new Error(`JIRA_SCENARIO_HTTP_${response.status}`);
console.log(`[jira:scenario] ${name} -> ${scenario}`);
