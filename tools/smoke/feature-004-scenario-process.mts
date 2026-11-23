import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";

import {
  documentedMattermostScenarioNames,
  mattermostScenarioCatalog,
} from "../local/mattermost-scenario-catalog.mts";
import { stringifyPortableJson } from "../verification/portable-json.mts";

const workspace = resolve(import.meta.dirname, "../.."),
  plan = process.argv.includes("--plan"),
  requested = process.env.AWP_LOCAL_PROJECT_NAME?.trim(),
  project = requested ?? `awp-local-004-scenarios-${Date.now().toString(36)}-${process.pid}`;
if (!/^awp-local-004-scenarios-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(project))
  throw new Error(`AWP_LOCAL_PROJECT_NAME_UNSAFE:${project}`);
async function port() {
  return await new Promise<number>((done, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("PORT_UNAVAILABLE"));
      server.close((error) => (error ? reject(error) : done(address.port)));
    });
  });
}
const ports = plan
  ? [40_000, 40_001, 40_002, 40_003, 40_004]
  : await Promise.all(Array.from({ length: 5 }, port));
const [api, worker, mock, idp, web] = ports,
  env = {
    ...process.env,
    AWP_LOCAL_PROJECT_NAME: project,
    AWP_COMPOSITION: "qa-jira-mattermost-local",
    AWP_API_HOST_PORT: String(api),
    AWP_WORKER_HOST_PORT: String(worker),
    AWP_MOCK_HUB_HOST_PORT: String(mock),
    AWP_IDP_HOST_PORT: String(idp),
    AWP_WEB_HOST_PORT: String(web),
    AWP_MOCK_HUB_URL: `http://127.0.0.1:${mock}`,
    AWP_PUBLIC_API_URL: `http://127.0.0.1:${api}`,
    AWP_WEB_ORIGIN: `http://127.0.0.1:${web}`,
    CI: "true",
  },
  cli = resolve(workspace, "tools/local/mattermost-cli.mts"),
  scenario = resolve(workspace, "tools/local/mattermost-scenario.mts");
const run = (args: readonly string[]) =>
  spawnSync(process.execPath, [...args], { cwd: workspace, env, stdio: "inherit" });
if (plan) {
  console.log(`${process.execPath} ${cli} up`);
  for (const name of documentedMattermostScenarioNames)
    console.log(`${process.execPath} ${scenario} ${name}`);
  process.exit(0);
}
const startedAt = new Date(),
  results: Array<Record<string, unknown>> = [];
let status: "PASS" | "FAIL" = "PASS";
try {
  run([cli, "down"]);
  const up = run([cli, "up"]);
  if (up.status !== 0) throw new Error("SCENARIO_STACK_UP_FAILED");
  for (const name of documentedMattermostScenarioNames) {
    const result = run([scenario, name]);
    const itemStatus = result.status === 0 ? "PASS" : "FAIL";
    results.push({ name, fault: mattermostScenarioCatalog[name], status: itemStatus });
    if (itemStatus === "FAIL") throw new Error(`SCENARIO_FAILED:${name}`);
  }
  await fetch(new URL("/mock/mattermost/fault", env.AWP_MOCK_HUB_URL), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fault: "NORMAL", remaining: 0 }),
  });
} catch (error) {
  status = "FAIL";
  console.error(error);
} finally {
  const down = run([cli, "down"]);
  if (down.status !== 0) status = "FAIL";
}
const executed = results.filter(({ status }) => status === "PASS").map(({ name }) => String(name)),
  unexecutedScenarios = documentedMattermostScenarioNames.filter(
    (name) => !executed.includes(name),
  );
if (unexecutedScenarios.length) status = "FAIL";
const report = {
  schemaVersion: 1,
  feature: "004-mattermost-hermes-intake",
  gate: "documented-scenarios-process",
  composition: "qa-jira-mattermost-local",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status,
  results,
  unexecutedScenarios,
};
const path = resolve(workspace, "reports/004-mattermost-hermes-intake/documented-scenarios.json");
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, stringifyPortableJson(report, workspace));
if (status !== "PASS") process.exitCode = 1;
