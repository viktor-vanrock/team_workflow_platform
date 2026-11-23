import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { gitLabDocumentedScenarioNames } from "../local/gitlab-scenario-catalog.mts";
import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const quickstartPath = resolve(workspace, "specs/005-gitlab-automated-validation/quickstart.md");
const reportPath = resolve(workspace, "reports/005-gitlab-automated-validation/quickstart.json");
const smokeReportPath = resolve(workspace, "reports/005-gitlab-automated-validation/smoke.json");
const scenarioReportPath = resolve(
  workspace,
  "reports/005-gitlab-automated-validation/documented-scenarios.json",
);
const observabilityReportPath = resolve(
  workspace,
  "reports/005-gitlab-automated-validation/observability.json",
);
const flags = new Set(process.argv.slice(2).filter((value) => value !== "--"));
const unknown = [...flags].filter((value) => value !== "--plan");
if (unknown.length > 0)
  throw new Error(`Unknown verify:005:quickstart arguments: ${unknown.join(", ")}`);

const digest = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const markdown = readFileSync(quickstartPath, "utf8");
const packageJson = JSON.parse(readFileSync(resolve(workspace, "package.json"), "utf8")) as {
  readonly scripts: Readonly<Record<string, string>>;
};
const documentedCommands = Object.freeze([
  ...new Set(
    markdown
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("corepack pnpm "))
      .map(
        (line) =>
          `corepack pnpm ${line
            .split("corepack pnpm ")[1]!
            .replace(/\s*\\$/u, "")
            .trim()}`,
      ),
  ),
]);
const documentedScripts = Object.freeze([
  ...new Set(documentedCommands.map((command) => command.split(/\s+/u)[2]!)),
]);
const packageManagerBuiltins = new Set(["install"]);
const orphanedScripts = documentedScripts.filter(
  (script) => !packageManagerBuiltins.has(script) && !(script in packageJson.scripts),
);
const documentedScenarios = Object.freeze(
  documentedCommands.flatMap((command) => {
    const match = /^corepack pnpm gitlab:scenario -- ([^\s\\]+)/u.exec(command);
    if (!match || match[1] === "--list" || match[1] === "reset") return [];
    return [match[1]];
  }),
);
const orphanedScenarios = documentedScenarios.filter(
  (name) =>
    !gitLabDocumentedScenarioNames.includes(name as (typeof gitLabDocumentedScenarioNames)[number]),
);
const undocumentedScenarios = gitLabDocumentedScenarioNames.filter(
  (name) => !documentedScenarios.includes(name),
);

type Disposition =
  | "EXECUTED_BY_TEST_005"
  | "EXECUTED_BY_SMOKE"
  | "EXECUTED_OBSERVABILITY"
  | "PARENT_GATE"
  | "SELF_GATE"
  | "GATED_NONPROD"
  | "SEPARATE_PILOT_GATE"
  | "OPERATOR_DESTRUCTIVE"
  | "DIAGNOSTIC"
  | "PACKAGE_MANAGER_BUILTIN";
const testScripts = new Set([
  "test:contract:005",
  "test:architecture:005",
  "test:unit:005",
  "test:integration:005",
  "test:security:005",
  "test:e2e:005",
]);
const smokeScripts = new Set([
  "local:gitlab:up",
  "local:gitlab:status",
  "local:gitlab:migrate",
  "local:gitlab:seed",
  "local:gitlab:down",
  "gitlab:scenario",
  "smoke:005",
]);
const parentGates = new Set([
  "verify:003:evidence",
  "verify:005:prerequisites",
  "verify:005:governance",
  "verify:005:setup",
  "verify:005:foundation",
  "verify:005:us1",
  "verify:005:us2",
  "verify:005:us3",
  "verify:005:us4",
  "verify:005:migrations",
  "trace:005",
  "verify:005",
  "verify:005:evidence",
  "ci:005",
]);

function disposition(command: string): Disposition | "UNCLASSIFIED" {
  const script = command.split(/\s+/u)[2]!;
  if (testScripts.has(script)) return "EXECUTED_BY_TEST_005";
  if (smokeScripts.has(script)) return "EXECUTED_BY_SMOKE";
  if (script === "verify:005:observability") return "EXECUTED_OBSERVABILITY";
  if (parentGates.has(script)) return "PARENT_GATE";
  if (script === "verify:005:quickstart") return "SELF_GATE";
  if (script === "verify:005:nonprod") return "GATED_NONPROD";
  if (script === "verify:005:pilot-rehearsal" || script === "verify:005:pilot-release")
    return "SEPARATE_PILOT_GATE";
  if (script === "local:gitlab:reset") return "OPERATOR_DESTRUCTIVE";
  if (script === "local:logs") return "DIAGNOSTIC";
  if (packageManagerBuiltins.has(script)) return "PACKAGE_MANAGER_BUILTIN";
  return "UNCLASSIFIED";
}

const commandCoverage = Object.freeze(
  documentedCommands.map((command) =>
    Object.freeze({ command, disposition: disposition(command) }),
  ),
);
const unclassifiedCommands = commandCoverage
  .filter(({ disposition: value }) => value === "UNCLASSIFIED")
  .map(({ command }) => command);
const stages = Object.freeze([
  Object.freeze({ id: "test:005", path: "tools/ci/feature-005-tests.mts", timeoutMs: 1_200_000 }),
  Object.freeze({
    id: "verify:005:observability",
    path: "tools/verification/feature-005-observability.mts",
    timeoutMs: 600_000,
  }),
  Object.freeze({ id: "smoke:005", path: "tools/smoke/feature-005.mts", timeoutMs: 3_600_000 }),
]);

if (flags.has("--plan")) {
  console.table(commandCoverage);
  console.table(stages.map(({ id, path }) => ({ id, command: `node ${path}` })));
  console.log(
    `documented GitLab scenarios: ${documentedScenarios.length}/${gitLabDocumentedScenarioNames.length}`,
  );
  const invalid =
    orphanedScripts.length > 0 ||
    orphanedScenarios.length > 0 ||
    undocumentedScenarios.length > 0 ||
    unclassifiedCommands.length > 0 ||
    documentedScenarios.length !== 30;
  if (invalid) {
    console.error(
      JSON.stringify({
        orphanedScripts,
        orphanedScenarios,
        undocumentedScenarios,
        unclassifiedCommands,
      }),
    );
    process.exitCode = 1;
  }
  process.exit(0);
}

const startedAt = new Date();
const results: Array<Readonly<Record<string, unknown>>> = [];
let failed =
  orphanedScripts.length > 0 ||
  orphanedScenarios.length > 0 ||
  undocumentedScenarios.length > 0 ||
  unclassifiedCommands.length > 0 ||
  documentedScenarios.length !== 30;
for (const stage of stages) {
  if (failed) {
    results.push(Object.freeze({ id: stage.id, status: "SKIP", durationMs: 0 }));
    continue;
  }
  console.log(`[verify:005:quickstart] ${stage.id}`);
  const stageStarted = Date.now();
  const run = spawnSync(process.execPath, [stage.path], {
    cwd: workspace,
    env: { ...process.env, CI: "true" },
    stdio: "inherit",
    timeout: stage.timeoutMs,
  });
  const status = run.status === 0 && run.error === undefined ? "PASS" : "FAIL";
  failed ||= status === "FAIL";
  if (run.error) console.error(run.error.message);
  results.push(
    Object.freeze({
      id: stage.id,
      status,
      durationMs: Date.now() - stageStarted,
      exitCode: run.status ?? 1,
    }),
  );
}

function readReport(path: string): Readonly<Record<string, unknown>> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Readonly<Record<string, unknown>>;
  } catch {
    return undefined;
  }
}
function reportFresh(
  report: Readonly<Record<string, unknown>> | undefined,
  key: "startedAt" | "generatedAt",
): boolean {
  return typeof report?.[key] === "string" && Date.parse(report[key]) >= startedAt.getTime();
}

const smoke = readReport(smokeReportPath);
const scenarios = readReport(scenarioReportPath);
const observability = readReport(observabilityReportPath);
const smokeScenarioSummary =
  smoke?.scenarios !== null &&
  typeof smoke?.scenarios === "object" &&
  !Array.isArray(smoke.scenarios)
    ? (smoke.scenarios as Readonly<Record<string, unknown>>)
    : undefined;
const smokeStages = Array.isArray(smoke?.stages)
  ? smoke.stages.filter(
      (row): row is Readonly<Record<string, unknown>> =>
        row !== null && typeof row === "object" && !Array.isArray(row),
    )
  : [];
const scenarioRows = Array.isArray(scenarios?.scenarios)
  ? scenarios.scenarios.filter(
      (row): row is Readonly<Record<string, unknown>> =>
        row !== null && typeof row === "object" && !Array.isArray(row),
    )
  : [];
const executedScenarioNames = scenarioRows
  .filter(({ status }) => status === "PASS")
  .map(({ id }) => String(id));
const unexecutedInvariants = Object.freeze([
  ...gitLabDocumentedScenarioNames
    .filter((name) => !executedScenarioNames.includes(name))
    .map((name) => `scenario:${name}`),
  ...smokeStages
    .filter(({ status }) => status !== "PASS")
    .map(({ id }) => `smoke-stage:${String(id)}`),
]);
const reportFreshness = Object.freeze({
  smoke: reportFresh(smoke, "startedAt"),
  documentedScenarios: reportFresh(scenarios, "generatedAt"),
  observability: reportFresh(observability, "startedAt"),
});
failed ||=
  Object.values(reportFreshness).some((fresh) => !fresh) ||
  smoke?.status !== "PASS" ||
  scenarios?.status !== "PASS" ||
  observability?.status !== "PASS" ||
  smokeScenarioSummary?.executed !== 30 ||
  (Array.isArray(smokeScenarioSummary?.unexecuted) && smokeScenarioSummary.unexecuted.length > 0) ||
  unexecutedInvariants.length > 0;

const sourcePaths = Object.freeze([
  "specs/005-gitlab-automated-validation/quickstart.md",
  "package.json",
  "tools/verification/005-quickstart.mts",
  "tools/local/gitlab-scenario-catalog.mts",
  "tools/smoke/feature-005.mts",
]);
const childReports = [smokeReportPath, scenarioReportPath, observabilityReportPath]
  .filter(existsSync)
  .map((path) =>
    Object.freeze({ path: path.slice(workspace.length + 1), sha256: digest(readFileSync(path)) }),
  );
const sources = sourcePaths.map((path) =>
  Object.freeze({ path, sha256: digest(readFileSync(resolve(workspace, path))) }),
);
const report = Object.freeze({
  schemaVersion: 1,
  feature: "005-gitlab-automated-validation",
  gate: "quickstart",
  contour: "qa-jira-gitlab-local",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  documentedCommands: documentedCommands.length,
  documentedScripts: documentedScripts.length,
  documentedScenarios: documentedScenarios.length,
  orphanedScripts,
  orphanedScenarios,
  undocumentedScenarios,
  unclassifiedCommands,
  commandCoverage,
  results,
  reportFreshness,
  executedScenarioNames,
  unexecutedInvariants,
  sourceBinding: Object.freeze({
    files: sources,
    childReports,
    aggregateSha256: digest(JSON.stringify({ sources, childReports })),
  }),
});
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(
  `[verify:005:quickstart] ${report.status}; commands=${documentedCommands.length}; scenarios=${documentedScenarios.length}; report: ${reportPath}`,
);
if (failed) process.exitCode = 1;
