import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";

import { stringifyPortableJson } from "../verification/portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/003-jira-operational-authority/setup-gate.json");
const flags = new Set(process.argv.slice(2).filter((flag) => flag !== "--"));
const known = new Set(["--plan", "--setup"]);
const unknown = [...flags].filter((flag) => !known.has(flag));
if (unknown.length > 0)
  throw new Error(`Unknown verify:003:setup arguments: ${unknown.join(", ")}`);

interface Stage {
  readonly id: string;
  readonly description: string;
  readonly executable: string;
  readonly args: readonly string[];
}

interface StageResult extends Stage {
  readonly status: "PASS" | "FAIL" | "SKIP";
  readonly exitCode?: number;
  readonly durationMs: number;
}

const node = process.execPath;
const stages: readonly Stage[] = Object.freeze([
  {
    id: "prerequisites",
    description: "Exact Feature 001/002 reports and implemented runtime surfaces",
    executable: node,
    args: ["tools/verification/feature-003-prerequisites.mts"],
  },
  {
    id: "registry",
    description: "Immutable 001/002/003 offline schema registry",
    executable: node,
    args: ["tools/contracts/build-registry.mts", "--check"],
  },
  {
    id: "design-contracts",
    description: "Feature 003 JSON/OpenAPI/AsyncAPI refs and closed action bodies",
    executable: node,
    args: ["tools/contracts/verify-003-contracts.mts"],
  },
  {
    id: "phase-1-tests",
    description: "Prerequisite, C1 and production-boundary tests",
    executable: node,
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/contract/003",
      "tests/integration/security/003",
      "--maxWorkers=1",
    ],
  },
  {
    id: "architecture",
    description: "Workspace import graph including the Jira package shells",
    executable: node,
    args: ["tools/architecture/check-import-graph.mts"],
  },
  {
    id: "phase-1-typecheck",
    description: "Feature 003 package and composition typechecks",
    executable: node,
    args: [
      "node_modules/nx/dist/bin/nx.js",
      "run-many",
      "-t",
      "typecheck",
      "-p",
      "platform-contracts",
      "connector-jira",
      "connector-jira-persistence-typeorm",
      "runtime-composition",
    ],
  },
]);

if (flags.has("--plan")) {
  console.table(
    stages.map(({ id, description, executable, args }) => ({
      id,
      description,
      command: [executable, ...args].join(" "),
    })),
  );
  process.exit(0);
}

function nonProdMetadataStatus(): Readonly<Record<string, unknown>> {
  const supplied = process.env.AWP_JIRA_NONPROD_METADATA_PACKAGE?.trim();
  if (!supplied)
    return Object.freeze({
      status: "NON_PROD_SKIPPED_GATED",
      reasonCode: "C1_METADATA_NOT_SUPPLIED",
    });
  const path = resolve(workspace, supplied);
  if (path !== workspace && !path.startsWith(`${workspace}/`))
    return Object.freeze({ status: "FAIL", reasonCode: "C1_PATH_OUTSIDE_WORKSPACE" });
  if (!existsSync(path))
    return Object.freeze({ status: "FAIL", reasonCode: "C1_METADATA_MISSING", path: supplied });
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const schema = JSON.parse(
      readFileSync(
        resolve(
          workspace,
          "specs/003-jira-operational-authority/contracts/schemas/jira/pilot-metadata-package.v1.schema.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const validate = new Ajv2020({
      allErrors: true,
      strict: false,
      validateFormats: false,
    }).compile(schema);
    if (!validate(value)) throw new Error(`schema: ${JSON.stringify(validate.errors)}`);
    if (value.environment !== "NON_PROD")
      return Object.freeze({
        status: "FAIL",
        reasonCode: "C1_ENVIRONMENT_NOT_NON_PROD",
        path: supplied,
      });
    const hashInput = structuredClone(value);
    delete hashInput.contentHash;
    const canonicalize = (candidate: unknown): string => {
      if (
        candidate === null ||
        typeof candidate === "boolean" ||
        typeof candidate === "number" ||
        typeof candidate === "string"
      )
        return JSON.stringify(candidate);
      if (Array.isArray(candidate)) return `[${candidate.map(canonicalize).join(",")}]`;
      if (typeof candidate !== "object") throw new Error("unsupported C1 value");
      const record = candidate as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
        .join(",")}}`;
    };
    const actualHash = `sha256:${createHash("sha256").update(canonicalize(hashInput)).digest("hex")}`;
    if (value.contentHash !== actualHash)
      throw new Error(`contentHash mismatch: expected ${actualHash}`);
    const auth = value.auth as Record<string, unknown>;
    const adapter = value.adapter as Record<string, unknown>;
    const webhook = value.webhook as Record<string, unknown>;
    if (auth.kind === "LOCAL_FAKE") throw new Error("LOCAL_FAKE is forbidden in NON_PROD");
    if (Number(webhook.dedupeHorizonSeconds) < Number(webhook.retryHorizonSeconds))
      throw new Error("dedupe horizon is shorter than retry horizon");
    if (/Bearer |Basic |clientSecret|accessToken|password/iu.test(JSON.stringify(value)))
      throw new Error("embedded secret material is forbidden");
    return Object.freeze({
      status: "PASS",
      packageId: value.packageId,
      version: value.version,
      contentHash: value.contentHash,
      adapterFamily: adapter.family,
    });
  } catch (error) {
    return Object.freeze({
      status: "FAIL",
      reasonCode: "C1_METADATA_INVALID",
      detail: error instanceof Error ? error.message : String(error),
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
  console.log(`\n[verify:003:setup] ${stage.id}: ${stage.description}`);
  const started = Date.now();
  const result = spawnSync(stage.executable, [...stage.args], {
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

const nonProd = nonProdMetadataStatus();
if (nonProd.status === "FAIL") failed = true;
const report = {
  schemaVersion: 1,
  feature: "003-jira-operational-authority",
  gate: "setup",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  localC1: Object.freeze({
    status: results.some(({ id, status }) => id === "phase-1-tests" && status === "PASS")
      ? "PASS"
      : "FAIL",
    path: "config/local/jira-pilot-metadata.v1.json",
  }),
  nonProdC1: nonProd,
  stages: results,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(
  `[verify:003:setup] ${report.status}; nonProd=${String(nonProd.status)}; report: ${reportPath}`,
);
if (failed) process.exitCode = 1;
