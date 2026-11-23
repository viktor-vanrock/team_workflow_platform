import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { FEATURE_006_GOVERNANCE_MANIFEST } from "./feature-006-governance.mts";
import { stringifyPortableJson } from "./portable-json.mts";

type StageStatus = "PASS" | "FAIL" | "SKIPPED_GATED";

interface Stage {
  readonly id: string;
  readonly description: string;
  readonly args?: readonly string[];
  readonly check?: () => readonly string[];
  readonly entryGate?: boolean;
}

interface StageResult extends Stage {
  readonly status: StageStatus;
  readonly exitCode?: number;
  readonly durationMs: number;
  readonly errors?: readonly string[];
}

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/006-queue-triage-capacity-sla/setup-gate.json");
const flags = new Set(process.argv.slice(2).filter((value) => value !== "--"));
const unknown = [...flags].filter((flag) => flag !== "--plan");
if (unknown.length > 0)
  throw new Error(`Unknown Feature 006 setup arguments: ${unknown.join(", ")}`);

const requiredScripts = Object.freeze([
  "test:contract:006",
  "test:architecture:006",
  "test:unit:006",
  "test:concurrency:006",
  "test:integration:006",
  "test:security:006",
  "test:e2e:006",
  "test:browser:006",
  "test:006",
  "verify:006:prerequisites",
  "verify:006:governance",
  "verify:006:setup",
  "verify:006:foundation",
  "verify:006:us1",
  "verify:006:us2",
  "verify:006:us3",
  "verify:006:us4",
  "verify:006:us5",
  "verify:006:concurrency",
  "verify:006:integration",
  "verify:006:security",
  "verify:006:rebuild",
  "verify:006:migrations",
  "verify:006:browser",
  "verify:006:observability",
  "verify:006:quickstart",
  "verify:006:evidence",
  "verify:006",
  "local:queue",
  "local:queue:up",
  "local:queue:status",
  "local:queue:migrate",
  "local:queue:seed",
  "local:queue:down",
  "local:queue:reset",
  "queue:scenario",
  "queue:scenario:catalog",
  "smoke:006",
  "trace:006",
  "ci:006",
]);

function checkContour(): readonly string[] {
  const errors: string[] = [];
  if (FEATURE_006_GOVERNANCE_MANIFEST.acceptedContour !== "qa-jira-gitlab-mattermost-local") {
    errors.push(`unexpected contour ${FEATURE_006_GOVERNANCE_MANIFEST.acceptedContour}`);
  }
  if (FEATURE_006_GOVERNANCE_MANIFEST.production !== "DENIED") {
    errors.push(`unexpected production authority ${FEATURE_006_GOVERNANCE_MANIFEST.production}`);
  }
  return errors;
}

function checkPackageEntrypoints(): readonly string[] {
  const packageJson = JSON.parse(readFileSync(resolve(workspace, "package.json"), "utf8")) as {
    scripts?: Record<string, unknown>;
  };
  const scripts = packageJson.scripts ?? {};
  return requiredScripts.flatMap((name) =>
    typeof scripts[name] === "string" && scripts[name].length > 0
      ? []
      : [`missing package script ${name}`],
  );
}

const stages: readonly Stage[] = Object.freeze([
  {
    id: "prerequisites",
    description: "Fresh source/task/runtime-bound Feature 003-005 evidence",
    args: ["tools/verification/feature-006-prerequisites.mts"],
    entryGate: true,
  },
  {
    id: "governance",
    description:
      "Constitution 2.0, Jira authority, authorization-before-aggregation and local-only boundary",
    args: ["tools/verification/feature-006-governance.mts"],
    entryGate: true,
  },
  {
    id: "contour",
    description: "Exact qa-jira-gitlab-mattermost-local contour with production denied",
    check: checkContour,
  },
  {
    id: "design-contracts",
    description: "Strict offline schemas, examples, refs, JCS, OpenAPI and AsyncAPI",
    args: ["tools/contracts/verify-006-contracts.mts"],
  },
  {
    id: "scenario-catalog",
    description: "Closed duplicate-free documented scenario catalog",
    args: ["tools/local/queue-scenario-catalog.mts", "--check"],
  },
  {
    id: "package-entrypoints",
    description: "All planned Feature 006 package entrypoints are wired",
    check: checkPackageEntrypoints,
  },
  {
    id: "phase-1-contract-tests",
    description: "Prerequisite and governance fail-closed vectors",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/contract/006/prerequisite-gate.spec.ts",
      "tests/contract/006/governance-gate.spec.ts",
      "--maxWorkers=1",
    ],
  },
]);

if (flags.has("--plan")) {
  console.table(
    stages.map(({ id, description, args, entryGate }) => ({
      id,
      entryGate: entryGate === true,
      description,
      command: args ? [process.execPath, ...args].join(" ") : "in-process exact check",
    })),
  );
  process.exit(0);
}

function execute(stage: Stage): StageResult {
  const started = Date.now();
  console.log(`\n[verify:006:setup] ${stage.id}: ${stage.description}`);
  if (stage.check) {
    const errors = stage.check();
    for (const error of errors) console.error(`- ${error}`);
    return {
      ...stage,
      status: errors.length === 0 ? "PASS" : "FAIL",
      exitCode: errors.length === 0 ? 0 : 1,
      durationMs: Date.now() - started,
      errors,
    };
  }
  const result = spawnSync(process.execPath, [...(stage.args ?? [])], {
    cwd: workspace,
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
  });
  if (result.error) throw result.error;
  const exitCode = result.status ?? 1;
  return {
    ...stage,
    status: exitCode === 0 ? "PASS" : "FAIL",
    exitCode,
    durationMs: Date.now() - started,
  };
}

const startedAt = new Date();
const results: StageResult[] = [];
for (const stage of stages.filter(({ entryGate }) => entryGate === true))
  results.push(execute(stage));
const entryGateFailed = results.some(({ status }) => status === "FAIL");
for (const stage of stages.filter(({ entryGate }) => entryGate !== true)) {
  if (entryGateFailed) results.push({ ...stage, status: "SKIPPED_GATED", durationMs: 0 });
  else results.push(execute(stage));
}

const failed = results.some(({ status }) => status !== "PASS");
const report = Object.freeze({
  schemaVersion: 1,
  feature: "006-queue-triage-capacity-sla",
  gate: "feature-006-setup",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  contour: FEATURE_006_GOVERNANCE_MANIFEST.acceptedContour,
  externalNetwork: "DENIED",
  production: FEATURE_006_GOVERNANCE_MANIFEST.production,
  deploymentApproval: "LOCAL_CONFORMANCE_ONLY",
  autonomousPriority: false,
  liveProviderAuthority: false,
  mandatoryEntryGates: Object.freeze({
    prerequisites: results.find(({ id }) => id === "prerequisites")?.status ?? "FAIL",
    governance: results.find(({ id }) => id === "governance")?.status ?? "FAIL",
  }),
  stages: results,
});
mkdirSync(dirname(reportPath), { recursive: true });
const temporary = `${reportPath}.${process.pid}.tmp`;
writeFileSync(temporary, stringifyPortableJson(report, workspace), "utf8");
renameSync(temporary, reportPath);
console.log(
  `[verify:006:setup] ${report.status}; contour=${report.contour}; production=${report.production}; report: ${reportPath}`,
);
if (failed) process.exitCode = 1;
