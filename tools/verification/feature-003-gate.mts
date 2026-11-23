import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";

import {
  captureFeature003HandoffSnapshot,
  FEATURE_003_AUTHORITATIVE_EVIDENCE,
  sha256File,
  verifyFeature003HandoffReport,
  writeFeature003ReportAtomic,
} from "./feature-003-evidence-lib.mts";
import { verifyFeature003NodeVersion } from "./feature-003-prerequisites.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/003-jira-operational-authority/final-gate.json");
const flags = new Set(process.argv.slice(2).filter((flag) => flag !== "--"));
const unknown = [...flags].filter((flag) => flag !== "--plan");
if (unknown.length > 0) throw new Error(`Unknown verify:003 arguments: ${unknown.join(", ")}`);
const node = process.execPath;
const invocationStartedAt = new Date();
const exactNodePath = dirname(process.execPath);
const stageEnvironment = Object.freeze({
  ...process.env,
  CI: "true",
  PATH: [exactNodePath, process.env.PATH].filter(Boolean).join(delimiter),
});

interface Stage {
  readonly id: string;
  readonly category: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}
interface StageResult extends Stage {
  readonly command: readonly string[];
  readonly status: "PASS" | "FAIL" | "SKIP";
  readonly durationMs: number;
  readonly exitCode?: number;
}

const stages: readonly Stage[] = Object.freeze([
  {
    id: "prerequisites",
    category: "prerequisites",
    args: ["tools/verification/feature-003-prerequisites.mts"],
    timeoutMs: 120_000,
  },
  {
    id: "setup-contracts",
    category: "contract",
    args: ["tools/ci/feature-003.mts", "--setup"],
    timeoutMs: 240_000,
  },
  {
    id: "foundation",
    category: "contract+integration+security",
    args: ["tools/verification/003-foundation-checkpoint.mts"],
    timeoutMs: 360_000,
  },
  {
    id: "us1",
    category: "contract+integration+security+e2e",
    args: ["tools/verification/003-us1-checkpoint.mts"],
    timeoutMs: 240_000,
  },
  {
    id: "us2",
    category: "contract+integration+security+e2e",
    args: ["tools/verification/003-us2-checkpoint.mts"],
    timeoutMs: 240_000,
  },
  {
    id: "us3",
    category: "contract+integration+security+e2e",
    args: ["tools/verification/003-us3-checkpoint.mts"],
    timeoutMs: 300_000,
  },
  {
    id: "us4",
    category: "contract+integration+security+e2e",
    args: ["tools/verification/003-us4-checkpoint.mts"],
    timeoutMs: 240_000,
  },
  {
    id: "unit-feature-001",
    category: "unit",
    args: ["node_modules/nx/dist/bin/nx.js", "run", "feature-001:test-unit"],
    timeoutMs: 180_000,
  },
  {
    id: "unit-qa",
    category: "unit",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "packages/competency-qa/src/application/readiness-evaluator.spec.ts",
      "packages/competency-qa/src/domain/test-session.spec.ts",
      "--maxWorkers=1",
    ],
    timeoutMs: 120_000,
  },
  {
    id: "openapi-registry-drift",
    category: "contract",
    args: ["tools/contracts/build-openapi-snapshots.mts", "--check"],
    timeoutMs: 120_000,
  },
  {
    id: "registry-drift",
    category: "contract",
    args: ["tools/contracts/build-registry.mts", "--check"],
    timeoutMs: 120_000,
  },
  {
    id: "hardening",
    category: "architecture+contract+integration+security",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/architecture/003-jira-boundaries.spec.ts",
      "tests/contract/003/openapi-runtime-drift.spec.ts",
      "tests/contract/003/asyncapi-events.spec.ts",
      "tests/contract/003/schema-registry-parity.spec.ts",
      "tests/integration/security/003/isolation-hardening.spec.ts",
      "tests/integration/security/003/connector-hardening.spec.ts",
      "tests/integration/003/jira-error-matrix.spec.ts",
      "tests/integration/003/jira-chaos-recovery.spec.ts",
      "tests/integration/003/jira-rate-freshness.spec.ts",
      "tests/integration/security/003/audit-lineage.spec.ts",
      "--maxWorkers=1",
    ],
    timeoutMs: 300_000,
  },
  {
    id: "migrations-postgres-17-18",
    category: "integration",
    args: ["tools/ci/verify-003-migrations.mts"],
    timeoutMs: 600_000,
  },
  { id: "smoke-e2e", category: "e2e", args: ["tools/smoke/feature-003.mts"], timeoutMs: 3_600_000 },
  {
    id: "browser-journey",
    category: "e2e",
    args: ["tools/smoke/feature-003-browser-process.mts"],
    timeoutMs: 600_000,
  },
  {
    id: "quickstart",
    category: "documentation+e2e",
    args: ["tools/verification/003-quickstart.mts"],
    timeoutMs: 3_600_000,
  },
  {
    id: "typecheck",
    category: "typecheck",
    args: ["node_modules/nx/dist/bin/nx.js", "run-many", "-t", "typecheck", "--all"],
    timeoutMs: 360_000,
  },
  {
    id: "lint",
    category: "lint",
    args: ["node_modules/eslint/bin/eslint.js", "."],
    timeoutMs: 360_000,
  },
  {
    id: "build",
    category: "build",
    args: ["node_modules/nx/dist/bin/nx.js", "run-many", "-t", "build", "--all"],
    timeoutMs: 600_000,
  },
  {
    id: "nonprod-metadata",
    category: "nonprod",
    args: ["tools/verification/feature-003-nonprod-metadata.mts"],
    timeoutMs: 120_000,
  },
  {
    id: "nonprod-conformance",
    category: "nonprod",
    args: ["tools/verification/feature-003-nonprod.mts"],
    timeoutMs: 120_000,
  },
  {
    id: "traceability",
    category: "trace",
    args: ["tools/verification/feature-003-trace.mts"],
    timeoutMs: 120_000,
  },
]);

const evidenceStageByName: Readonly<Record<string, string>> = Object.freeze({
  "prerequisites.json": "prerequisites",
  "setup-gate.json": "setup-contracts",
  "foundation.json": "foundation",
  "us1.json": "us1",
  "us2.json": "us2",
  "us3.json": "us3",
  "us4.json": "us4",
  "migrations.json": "migrations-postgres-17-18",
  "smoke.json": "smoke-e2e",
  "quickstart.json": "quickstart",
  "traceability.json": "traceability",
  "nonprod-metadata.json": "nonprod-metadata",
  "nonprod.json": "nonprod-conformance",
});

const packageManifest = JSON.parse(readFileSync(resolve(workspace, "package.json"), "utf8")) as {
  readonly engines?: Readonly<Record<string, string>>;
  readonly packageManager?: string;
};
const nodeRuntime = verifyFeature003NodeVersion({
  active: process.versions.node,
  configured: readFileSync(resolve(workspace, ".node-version"), "utf8").trim(),
  engine: packageManifest.engines?.node ?? "MISSING",
});
if (nodeRuntime.status !== "PASS") {
  if (!flags.has("--plan")) {
    writeFeature003ReportAtomic(workspace, reportPath, {
      schemaVersion: 2,
      feature: "003-jira-operational-authority",
      gate: "feature-003-final",
      startedAt: invocationStartedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      status: "FAIL",
      reasonCode: "NODE_VERSION_MISMATCH",
      detail: nodeRuntime.detail,
      stages: [],
      evidence: [],
      handoff: { status: "NOT_ATTESTED", generatedAfterAllProcessGates: false },
    });
  }
  console.error(`[gate:003] NODE_VERSION_MISMATCH: ${nodeRuntime.detail}`);
  process.exit(1);
}

if (flags.has("--plan")) {
  console.table(
    stages.map(({ id, category, args }) => ({ id, category, command: [node, ...args].join(" ") })),
  );
  process.exit(0);
}

const startedAt = invocationStartedAt;
writeFeature003ReportAtomic(workspace, reportPath, {
  schemaVersion: 2,
  feature: "003-jira-operational-authority",
  gate: "feature-003-final",
  startedAt: startedAt.toISOString(),
  status: "RUNNING",
  stages: [],
  evidence: [],
  handoff: { status: "NOT_ATTESTED", generatedAfterAllProcessGates: false },
});
const results: StageResult[] = [];
let failed = false;
for (const stage of stages) {
  if (failed) {
    results.push({ ...stage, command: [node, ...stage.args], status: "SKIP", durationMs: 0 });
    continue;
  }
  console.log(`\n[gate:003] ${stage.id}`);
  const started = Date.now();
  const run = spawnSync(node, [...stage.args], {
    cwd: workspace,
    env: stageEnvironment,
    stdio: "inherit",
    timeout: stage.timeoutMs,
  });
  const exitCode = run.status ?? 1;
  failed = run.error !== undefined || exitCode !== 0;
  results.push({
    ...stage,
    command: [node, ...stage.args],
    status: failed ? "FAIL" : "PASS",
    durationMs: Date.now() - started,
    exitCode,
  });
  if (run.error) console.error(run.error.message);
}

function readReport(name: string): Readonly<Record<string, unknown>> | undefined {
  const path = resolve(workspace, "reports/003-jira-operational-authority", name);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Readonly<Record<string, unknown>>;
  } catch {
    return undefined;
  }
}

const processGateCompletedAt = new Date();
const evidenceSources = Object.freeze(
  FEATURE_003_AUTHORITATIVE_EVIDENCE.map((name) => ({
    name,
    stageId: evidenceStageByName[name]!,
    path: resolve(workspace, "reports/003-jira-operational-authority", name),
    report: readReport(name),
  })),
);
const nonprodMetadata = readReport("nonprod-metadata.json");
const nonprod = readReport("nonprod.json");
const releaseReadinessPath = "specs/003-jira-operational-authority/release-readiness.md";
const releaseReadiness = existsSync(resolve(workspace, releaseReadinessPath))
  ? readFileSync(resolve(workspace, releaseReadinessPath), "utf8")
  : "";
const evidenceFailed = evidenceSources.some(({ name, report }) => {
  const evidenceStatus = String(report?.status ?? "MISSING");
  return name === "nonprod-metadata.json" || name === "nonprod.json"
    ? !["PASS", "SKIPPED_GATED"].includes(evidenceStatus)
    : evidenceStatus !== "PASS";
});
const nonprodStatusAccepted =
  ["PASS", "SKIPPED_GATED"].includes(String(nonprodMetadata?.status)) &&
  ["PASS", "SKIPPED_GATED"].includes(String(nonprod?.status));
const constitutionDecisionPresent = releaseReadiness.includes(
  "no constitution amendment and no exception are required",
);
const processGatesPassed =
  !failed &&
  results.length === stages.length &&
  results.every(({ status: stageStatus }) => stageStatus === "PASS");
const canAttest =
  processGatesPassed && !evidenceFailed && nonprodStatusAccepted && constitutionDecisionPresent;
const evidence = evidenceSources.map(({ name, stageId, path, report }) => ({
  name,
  stageId,
  status: report?.status ?? "MISSING",
  ...(canAttest ? { sha256: sha256File(path) } : {}),
}));
const baseReport = {
  schemaVersion: 2,
  feature: "003-jira-operational-authority",
  gate: "feature-003-final",
  startedAt: startedAt.toISOString(),
  processGateCompletedAt: processGateCompletedAt.toISOString(),
  stages: results,
  categories: Object.fromEntries(
    [...new Set(stages.map(({ category }) => category))].map((category) => [
      category,
      results
        .filter((result) => result.category === category)
        .every(({ status: stageStatus }) => stageStatus === "PASS")
        ? "PASS"
        : "FAIL",
    ]),
  ),
  evidence,
  nonprod: {
    metadata: nonprodMetadata?.status ?? "MISSING",
    conformance: nonprod?.status ?? "MISSING",
    livePassRequiredForLocalRelease: false,
  },
  constitution: {
    postDesignDecision: constitutionDecisionPresent ? "PASS" : "FAIL",
    constitutionalExceptions: 0,
    amendmentRequired: false,
    decisionDocument: releaseReadinessPath,
  },
  productionWritesSupported: false,
};
let report: Readonly<Record<string, unknown>>;
if (canAttest) {
  const handoffSnapshot = captureFeature003HandoffSnapshot(workspace);
  const handoff = {
    status: "BOUND",
    generatedAfterAllProcessGates: true,
    generatedAt: new Date().toISOString(),
    verificationCommand: "pnpm verify:003:evidence",
    toolchain: {
      node: process.versions.node,
      packageManager: packageManifest.packageManager ?? "MISSING",
    },
    ...handoffSnapshot,
  };
  const candidate = {
    ...baseReport,
    finishedAt: new Date().toISOString(),
    status: "PASS",
    handoff,
  };
  const handoffVerification = verifyFeature003HandoffReport({ workspace, report: candidate });
  report =
    handoffVerification.status === "PASS"
      ? candidate
      : {
          ...candidate,
          status: "FAIL",
          handoff: { ...handoff, status: "INVALIDATED" },
          invalidation: {
            invalidatedAt: new Date().toISOString(),
            previousStatus: "PASS",
            reasonCodes: handoffVerification.failures.map(({ code }) => code),
            failures: handoffVerification.failures,
          },
        };
} else {
  report = {
    ...baseReport,
    finishedAt: new Date().toISOString(),
    status: "FAIL",
    handoff: {
      status: "NOT_ATTESTED",
      generatedAfterAllProcessGates: false,
      reasonCode: processGatesPassed ? "EVIDENCE_OR_POLICY_FAILED" : "PROCESS_GATE_FAILED",
    },
  };
}
writeFeature003ReportAtomic(workspace, reportPath, report);
console.table(
  results.map(({ id, category, status: stageStatus, durationMs }) => ({
    id,
    category,
    status: stageStatus,
    durationMs,
  })),
);
console.log(`[gate:003] ${String(report.status)}; report: ${reportPath}`);
if (report.status !== "PASS") process.exitCode = 1;
