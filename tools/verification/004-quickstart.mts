import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { documentedMattermostScenarioNames } from "../local/mattermost-scenario-catalog.mts";
import {
  requiredFeature004SuccessCriteria,
  summarizeFeature004ExecutionCoverage,
} from "../smoke/feature-004-process-contract.mts";
import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const quickstartPath = resolve(workspace, "specs/004-mattermost-hermes-intake/quickstart.md");
const reportPath = resolve(workspace, "reports/004-mattermost-hermes-intake/quickstart.json");
const smokeReportPath = resolve(workspace, "reports/004-mattermost-hermes-intake/smoke.json");
const scenarioReportPath = resolve(
  workspace,
  "reports/004-mattermost-hermes-intake/documented-scenarios.json",
);
const planOnly = process.argv.includes("--plan");
const unexpected = process.argv
  .slice(2)
  .filter((argument) => argument !== "--plan" && argument !== "--");
if (unexpected.length > 0)
  throw new Error(`Unknown verify:004:quickstart arguments: ${unexpected.join(" ")}`);

const markdown = readFileSync(quickstartPath, "utf8");
const packageJson = JSON.parse(readFileSync(resolve(workspace, "package.json"), "utf8")) as {
  readonly scripts: Readonly<Record<string, string>>;
};
const commandLines = markdown.split("\n").map((line) => line.trim());
const documentedCommands = [
  ...new Set(
    commandLines
      .filter((line) => /^(?:[A-Z][A-Z0-9_]*=[^\s]+\s+)?corepack pnpm\s+/u.test(line))
      .map((line) => line.replace(/^[A-Z][A-Z0-9_]*=[^\s]+\s+/u, "")),
  ),
];
const documentedScripts = documentedCommands.map((line) => line.split(/\s+/u)[2]!);
const packageManagerBuiltins = new Set(["install"]);
const orphanedScripts = [
  ...new Set(
    documentedScripts.filter(
      (script) => !packageManagerBuiltins.has(script) && !(script in packageJson.scripts),
    ),
  ),
];
const documentedScenarios = documentedCommands
  .filter((line) => line.startsWith("corepack pnpm mattermost:scenario -- "))
  .map((line) => line.split(/\s+/u)[4]!);
const orphanedScenarios = documentedScenarios.filter(
  (name) =>
    !documentedMattermostScenarioNames.includes(
      name as (typeof documentedMattermostScenarioNames)[number],
    ),
);
const undocumentedScenarios = documentedMattermostScenarioNames.filter(
  (name) => !documentedScenarios.includes(name),
);

type Disposition =
  | "EXECUTED"
  | "EXECUTED_BY_SMOKE"
  | "PARENT_GATE"
  | "GATED_NONPROD"
  | "OPERATOR_DESTRUCTIVE"
  | "PACKAGE_MANAGER_BUILTIN";
const directlyExecuted = new Set([
  "test:contract:004",
  "test:architecture:004",
  "test:integration:004",
  "test:security:004",
  "test:e2e:004",
  "smoke:004",
]);
const smokeLifecycle = new Set([
  "local:mattermost:up",
  "local:mattermost:status",
  "local:mattermost:migrate",
  "local:mattermost:seed",
  "local:mattermost:down",
  "mattermost:scenario",
]);
const parentGates = new Set([
  "verify:003:evidence",
  "verify:004:governance",
  "verify:004:checkpoint",
  "verify:004:migrations",
  "trace:004",
  "verify:004",
]);

function disposition(command: string): Disposition | "UNCLASSIFIED" {
  const script = command.split(/\s+/u)[2]!;
  if (directlyExecuted.has(script)) return "EXECUTED";
  if (smokeLifecycle.has(script)) return "EXECUTED_BY_SMOKE";
  if (parentGates.has(script)) return "PARENT_GATE";
  if (script === "verify:004:nonprod") return "GATED_NONPROD";
  if (script === "local:mattermost:reset") return "OPERATOR_DESTRUCTIVE";
  if (packageManagerBuiltins.has(script)) return "PACKAGE_MANAGER_BUILTIN";
  return "UNCLASSIFIED";
}

const commandCoverage = documentedCommands.map((command) => ({
  command,
  disposition: disposition(command),
}));
const unclassifiedCommands = commandCoverage
  .filter((item) => item.disposition === "UNCLASSIFIED")
  .map(({ command }) => command);
const commands = Object.freeze([
  {
    script: "test:contract:004",
    args: ["node_modules/vitest/vitest.mjs", "run", "tests/contract/004", "--maxWorkers=1"],
  },
  {
    script: "test:architecture:004",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/architecture/004-mattermost-boundaries.spec.ts",
      "tests/architecture/004-mattermost-runtime-wiring.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    script: "test:integration:004",
    args: ["node_modules/vitest/vitest.mjs", "run", "tests/integration/004", "--maxWorkers=1"],
  },
  {
    script: "test:security:004",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/security/004",
      "--maxWorkers=1",
    ],
  },
  {
    script: "test:e2e:004",
    args: ["node_modules/vitest/vitest.mjs", "run", "tests/e2e/004-", "--maxWorkers=1"],
  },
  { script: "smoke:004", args: ["tools/smoke/feature-004.mts"] },
] as const);

if (planOnly) {
  console.table(commandCoverage);
  for (const { args } of commands) console.log([process.execPath, ...args].join(" "));
  console.log(
    `documented scenarios executed by smoke:004: ${documentedMattermostScenarioNames.length}`,
  );
  process.exit(0);
}

const startedAt = new Date();
const results: Array<Readonly<Record<string, unknown>>> = [];
let failed =
  orphanedScripts.length > 0 ||
  orphanedScenarios.length > 0 ||
  undocumentedScenarios.length > 0 ||
  unclassifiedCommands.length > 0;
for (const { script, args } of commands) {
  if (failed) {
    results.push({ script, command: [process.execPath, ...args], status: "SKIP", durationMs: 0 });
    continue;
  }
  const commandStarted = Date.now();
  const run = spawnSync(process.execPath, args, {
    cwd: workspace,
    env: { ...process.env, CI: "true" },
    stdio: "inherit",
    timeout: script === "smoke:004" ? 3_600_000 : 600_000,
  });
  const exitCode = run.status ?? 1;
  failed = run.error !== undefined || exitCode !== 0;
  if (run.error) console.error(run.error.message);
  results.push({
    script,
    command: [process.execPath, ...args],
    status: failed ? "FAIL" : "PASS",
    durationMs: Date.now() - commandStarted,
    exitCode,
  });
}

function readReport(path: string): Readonly<Record<string, unknown>> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Readonly<Record<string, unknown>>;
  } catch {
    return undefined;
  }
}

const smoke = readReport(smokeReportPath);
const scenarios = readReport(scenarioReportPath);
const smokeFresh =
  typeof smoke?.startedAt === "string" && Date.parse(smoke.startedAt) >= startedAt.getTime();
const scenariosFresh =
  typeof scenarios?.startedAt === "string" &&
  Date.parse(scenarios.startedAt) >= startedAt.getTime();
const stageRows = Array.isArray(smoke?.stages)
  ? smoke.stages.filter(
      (value): value is Readonly<Record<string, unknown>> =>
        value !== null && typeof value === "object" && !Array.isArray(value),
    )
  : [];
const coverage = summarizeFeature004ExecutionCoverage(
  stageRows.map((row) => ({ id: String(row.id), status: String(row.status) })),
);
const scenarioRows = Array.isArray(scenarios?.results)
  ? scenarios.results.filter(
      (value): value is Readonly<Record<string, unknown>> =>
        value !== null && typeof value === "object" && !Array.isArray(value),
    )
  : [];
const executedScenarioNames = scenariosFresh
  ? scenarioRows.filter(({ status }) => status === "PASS").map(({ name }) => String(name))
  : [];
const unexecutedScenarios = documentedScenarios.filter(
  (name) => !executedScenarioNames.includes(name),
);
const unexecutedInvariants = [
  ...coverage.unexecutedStages.map((id) => `stage:${id}`),
  ...coverage.unexecutedSuccessCriteria.map((id) => `success-criterion:${id}`),
  ...unexecutedScenarios.map((name) => `scenario:${name}`),
];
failed ||=
  !smokeFresh ||
  smoke?.status !== "PASS" ||
  !scenariosFresh ||
  scenarios?.status !== "PASS" ||
  unexecutedInvariants.length > 0;

const report = {
  schemaVersion: 1,
  feature: "004-mattermost-hermes-intake",
  gate: "quickstart",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  documentedCommands: documentedCommands.length,
  documentedScenarios: documentedScenarios.length,
  requiredSuccessCriteria: requiredFeature004SuccessCriteria,
  orphanedScripts,
  orphanedScenarios,
  undocumentedScenarios,
  unclassifiedCommands,
  commandCoverage,
  results,
  executedScenarioNames,
  unexecutedInvariants,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(
  `[quickstart:004] ${report.status}; commands=${documentedCommands.length}; scenarios=${documentedScenarios.length}; report: ${reportPath}`,
);
if (failed) process.exitCode = 1;
