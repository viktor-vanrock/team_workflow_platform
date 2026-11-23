import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { tsImport } from "tsx/esm/api";

import { runQueueScenario } from "../local/queue-scenario.mts";
import { stringifyPortableJson } from "./portable-json.mts";

const runtime = (await tsImport(
  "../../packages/runtime-composition/src/index.ts",
  import.meta.url,
)) as typeof import("../../packages/runtime-composition/src/index.ts");

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/006-queue-triage-capacity-sla/setup-contour.json");
const startedAt = new Date();
const commands = ["up", "status", "migrate", "seed", "down", "reset"];
const commandResults = commands.map((command) => {
  const args = [
    "tools/local/queue-cli.mts",
    command,
    "--plan",
    ...(command === "reset" ? ["--yes"] : []),
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: workspace,
    encoding: "utf8",
    env: {
      ...process.env,
      AWP_COMPOSITION: "qa-jira-gitlab-mattermost-local",
      AWP_EXTERNAL_NETWORK_MODE: "deny",
    },
  });
  return Object.freeze({
    command,
    status: result.status === 0 ? ("PASS" as const) : ("FAIL" as const),
    exitCode: result.status ?? 1,
    outputHash: `sha256:${createHash("sha256").update(`${result.stdout}\n${result.stderr}`).digest("hex")}`,
  });
});
const environment = runtime.loadEnvironment({
  AWP_ENVIRONMENT: "LOCAL",
  AWP_RUNTIME_PROFILE: "local",
  AWP_COMPOSITION: "qa-jira-gitlab-mattermost-local",
  AWP_EXTERNAL_NETWORK_MODE: "deny",
  AWP_MOCK_HUB_URL: "http://mock-hub:4010",
} as NodeJS.ProcessEnv);
const fixture = runtime.buildQaJiraGitLabMattermostQueueLocalFixture();
const scenarios = await Promise.all(
  ["setup-portfolio", "external-network-denied"].map((id) =>
    runQueueScenario(id, { mode: "TEST" }),
  ),
);
const compose = readFileSync(resolve(workspace, "infra/compose/docker-compose.local.yml"), "utf8");
const composeEvidence = Object.freeze({
  internalNetwork: /awp-internal:\s*\n\s*internal: true/u.test(compose),
  queueStaticContourForwarded:
    /AWP_QUEUE_STATIC_CONTOUR:\s*\$\{AWP_QUEUE_STATIC_CONTOUR:-false\}/u.test(compose),
  queueServiceCount: (compose.match(/^\s{2}queue[-\w]*:/gmu) ?? []).length,
  queueDatabaseOwnerCount: (compose.match(/awp_queue_owner/gmu) ?? []).length,
});
const failed =
  commandResults.some(({ status }) => status !== "PASS") ||
  scenarios.some(({ status }) => status !== "PASS") ||
  environment.composition !== "qa-jira-gitlab-mattermost-local" ||
  environment.externalNetworkMode !== "deny" ||
  !composeEvidence.internalNetwork ||
  !composeEvidence.queueStaticContourForwarded ||
  composeEvidence.queueServiceCount !== 0 ||
  composeEvidence.queueDatabaseOwnerCount !== 0;
const report = Object.freeze({
  schemaVersion: 1,
  feature: "006-queue-triage-capacity-sla",
  checkpoint: "SETUP_CONTOUR",
  status: failed ? "FAIL" : "PASS",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  contour: environment.composition,
  externalNetwork: environment.externalNetworkMode === "deny" ? "DENIED" : "ALLOWED",
  production: "DENIED",
  fixture: Object.freeze({
    fixtureHash: fixture.fixtureHash,
    visibleProjects: fixture.projects
      .filter(({ entitledToLead }) => entitledToLead)
      .map(({ key }) => key),
    forbiddenProjects: fixture.projects
      .filter(({ entitledToLead }) => !entitledToLead)
      .map(({ key }) => key),
    policyModes: [fixture.measureOnlyPolicy.mode, fixture.enforcedCandidate.mode],
    sessionCount: fixture.sessions.length,
    attemptCount: fixture.attempts.length,
    productionEndpoints: fixture.productionEndpoints.length,
    realProviderCredentials: fixture.realProviderCredentials.length,
  }),
  compose: composeEvidence,
  scenarios,
  commandResults,
});
mkdirSync(dirname(reportPath), { recursive: true });
const temporary = `${reportPath}.${process.pid}.tmp`;
writeFileSync(temporary, stringifyPortableJson(report, workspace), "utf8");
renameSync(temporary, reportPath);
console.log(`[verify:006:setup-contour] ${report.status}; report: ${reportPath}`);
if (failed) process.exitCode = 1;
