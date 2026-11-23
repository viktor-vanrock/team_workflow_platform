import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const reportPath = resolve(workspace, "reports/004-mattermost-hermes-intake/setup-gate.json");
const flags = new Set(process.argv.slice(2).filter((value) => value !== "--"));
const unknown = [...flags].filter((flag) => flag !== "--plan");
if (unknown.length > 0)
  throw new Error(`Unknown Feature 004 setup arguments: ${unknown.join(", ")}`);

const stages: readonly Stage[] = Object.freeze([
  {
    id: "prerequisites",
    description: "Exact Feature 003 final evidence and consumed contracts",
    args: ["tools/verification/feature-004-prerequisites.mts"],
  },
  {
    id: "governance",
    description: "Accepted ADR-0008, ADR-0005 partial supersession and Constitution 2.0.0",
    args: ["tools/verification/feature-004-governance.mts"],
  },
  {
    id: "registry",
    description: "Immutable order-100/200/300/400 offline schema registry",
    args: ["tools/contracts/build-registry.mts", "--check"],
  },
  {
    id: "design-contracts",
    description: "Feature 004 JSON Schema, OpenAPI, AsyncAPI and AEAD vector",
    args: ["tools/contracts/verify-004-contracts.mts"],
  },
  {
    id: "phase-1-tests",
    description: "Prerequisite, governance and pilot metadata contracts",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/contract/004/prerequisite-gate.spec.ts",
      "tests/contract/004/governance-gate.spec.ts",
      "tests/contract/004/pilot-metadata.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "architecture",
    description: "Workspace import graph including the Mattermost package shell",
    args: ["tools/architecture/check-import-graph.mts"],
  },
  {
    id: "phase-1-typecheck",
    description: "Feature 004 contracts, connector and composition package typechecks",
    args: [
      "node_modules/nx/dist/bin/nx.js",
      "run-many",
      "-t",
      "typecheck",
      "-p",
      "platform-contracts",
      "connector-mattermost",
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

function optionalNonProdEvidence(): unknown {
  const path = resolve(workspace, "reports/004-mattermost-hermes-intake/prerequisites.json");
  if (!existsSync(path))
    return Object.freeze({
      metadata: "UNAVAILABLE",
      conformance: "UNAVAILABLE",
      livePassRequiredForLocalRelease: false,
    });
  try {
    const document = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return (
      document.optionalNonProdEvidence ??
      Object.freeze({
        metadata: "UNAVAILABLE",
        conformance: "UNAVAILABLE",
        livePassRequiredForLocalRelease: false,
      })
    );
  } catch {
    return Object.freeze({
      metadata: "UNAVAILABLE",
      conformance: "UNAVAILABLE",
      livePassRequiredForLocalRelease: false,
    });
  }
}

const startedAt = new Date();
const results: StageResult[] = [];
let failed = false;
for (const stage of stages) {
  if (failed) {
    results.push({ ...stage, status: "SKIP", durationMs: 0 });
    continue;
  }
  console.log(`\n[verify:004:setup] ${stage.id}: ${stage.description}`);
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
  feature: "004-mattermost-hermes-intake",
  gate: "feature-004-setup",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  mandatoryEntryGates: Object.freeze({
    prerequisites: results.find(({ id }) => id === "prerequisites")?.status ?? "FAIL",
    governance: results.find(({ id }) => id === "governance")?.status ?? "FAIL",
  }),
  optionalNonProdEvidence: optionalNonProdEvidence(),
  localPilotMetadata: Object.freeze({
    status: results.find(({ id }) => id === "phase-1-tests")?.status === "PASS" ? "PASS" : "FAIL",
    path: "config/local/mattermost-pilot-metadata.v1.json",
  }),
  stages: results,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(
  `[verify:004:setup] ${report.status}; optionalJira=${String((report.optionalNonProdEvidence as Record<string, unknown>).conformance)}; report: ${reportPath}`,
);
if (failed) process.exitCode = 1;
