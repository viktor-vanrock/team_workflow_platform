import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

interface Stage {
  readonly id: string;
  readonly description: string;
  readonly args: readonly string[];
}

interface StageResult extends Stage {
  readonly status: "PASS" | "FAIL" | "SKIP";
  readonly exitCode?: number;
  readonly durationMs: number;
}

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/005-gitlab-automated-validation/setup-gate.json");
const flags = new Set(process.argv.slice(2).filter((value) => value !== "--"));
const unknown = [...flags].filter((flag) => flag !== "--plan");
if (unknown.length > 0)
  throw new Error(`Unknown Feature 005 setup arguments: ${unknown.join(", ")}`);

const stages: readonly Stage[] = Object.freeze([
  {
    id: "prerequisites",
    description:
      "Fresh exact Feature 003 evidence, immutable upstream contracts and Feature 002 MANUAL V1",
    args: ["tools/verification/feature-005-prerequisites.mts"],
  },
  {
    id: "governance",
    description: "Constitution 2.0, human-only verdict and deployment-purpose contours",
    args: ["tools/verification/feature-005-governance.mts"],
  },
  {
    id: "registry",
    description: "Immutable order-500 offline schema registry",
    args: ["tools/contracts/build-registry.mts", "--check"],
  },
  {
    id: "openapi",
    description: "Generated API and Mock Hub snapshots include Feature 005 roots",
    args: ["tools/contracts/build-openapi-snapshots.mts", "--check"],
  },
  {
    id: "design-contracts",
    description:
      "All Feature 005 JSON Schema, examples, OpenAPI, AsyncAPI, refs, digests and detached bytes",
    args: ["tools/contracts/verify-005-contracts.mts"],
  },
  {
    id: "phase-1-tests",
    description: "Prerequisite, governance and pilot metadata contracts",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/contract/005/prerequisite-gate.spec.ts",
      "tests/contract/005/governance-gate.spec.ts",
      "tests/contract/005/pilot-metadata.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "architecture",
    description: "Workspace import graph including pure GitLab and TypeORM persistence shells",
    args: ["tools/architecture/check-import-graph.mts"],
  },
  {
    id: "phase-1-typecheck",
    description: "Feature 005 contracts, connector shells and composition package typechecks",
    args: [
      "node_modules/nx/dist/bin/nx.js",
      "run-many",
      "-t",
      "typecheck",
      "-p",
      "platform-contracts",
      "connector-gitlab",
      "connector-gitlab-persistence-typeorm",
      "runtime-composition",
    ],
  },
]);

if (flags.has("--plan")) {
  console.table(
    stages.map(({ id, description, args }) => ({
      id,
      description,
      command: [process.execPath, ...args].join(" "),
    })),
  );
  process.exit(0);
}

const startedAt = new Date();
const results: StageResult[] = [];
let failed = false;
for (const stage of stages) {
  if (failed) {
    results.push({ ...stage, status: "SKIP", durationMs: 0 });
    continue;
  }
  console.log(`\n[verify:005:setup] ${stage.id}: ${stage.description}`);
  const started = Date.now();
  const result = spawnSync(process.execPath, [...stage.args], {
    cwd: workspace,
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
  });
  if (result.error) throw result.error;
  const exitCode = result.status ?? 1;
  failed = exitCode !== 0;
  results.push({
    ...stage,
    status: failed ? "FAIL" : "PASS",
    exitCode,
    durationMs: Date.now() - started,
  });
}

const report = {
  schemaVersion: 1,
  feature: "005-gitlab-automated-validation",
  gate: "feature-005-setup",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  contour: "qa-jira-gitlab-local",
  mandatoryEntryGates: Object.freeze({
    prerequisites: results.find(({ id }) => id === "prerequisites")?.status ?? "FAIL",
    governance: results.find(({ id }) => id === "governance")?.status ?? "FAIL",
  }),
  localPilotMetadata: Object.freeze({
    status: results.find(({ id }) => id === "phase-1-tests")?.status === "PASS" ? "PASS" : "FAIL",
    path: "config/local/gitlab-pilot-metadata.v1.json",
  }),
  feature004: "NOT_REQUIRED_STANDALONE",
  deploymentApproval: "LOCAL_CONFORMANCE_ONLY",
  production: "DENIED",
  technicalResultMaySignVerdict: false,
  stages: results,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(
  `[verify:005:setup] ${report.status}; feature004=NOT_REQUIRED_STANDALONE; production=DENIED; report: ${reportPath}`,
);
if (failed) process.exitCode = 1;
