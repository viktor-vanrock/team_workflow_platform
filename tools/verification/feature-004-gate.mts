import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";

import {
  captureFeature004HandoffSnapshot,
  FEATURE_004_AUTHORITATIVE_EVIDENCE,
  readSafeJsonReport,
  sha256File,
  verifyFeature004FinalReport,
  writeFeature004ReportAtomic,
} from "./feature-004-evidence-lib.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportsDirectory = resolve(workspace, "reports/004-mattermost-hermes-intake");
const reportPath = resolve(reportsDirectory, "final-gate.json");
const plan = process.argv.includes("--plan");
const unexpected = process.argv.slice(2).filter((value) => value !== "--plan" && value !== "--");
if (unexpected.length > 0) throw new Error(`Unknown verify:004 arguments: ${unexpected.join(" ")}`);
const node = process.execPath;
const exactNodePath = dirname(node);
const environment = Object.freeze({
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
    args: ["tools/verification/feature-004-prerequisites.mts"],
    timeoutMs: 120_000,
  },
  {
    id: "governance",
    category: "governance",
    args: ["tools/verification/feature-004-governance.mts"],
    timeoutMs: 120_000,
  },
  {
    id: "setup-contracts",
    category: "contract",
    args: ["tools/ci/feature-004.mts", "--setup"],
    timeoutMs: 300_000,
  },
  {
    id: "foundation",
    category: "contract+integration+security",
    args: ["tools/verification/004-foundation-checkpoint.mts"],
    timeoutMs: 600_000,
  },
  {
    id: "us1",
    category: "contract+integration+security+e2e",
    args: ["tools/verification/004-us1-checkpoint.mts"],
    timeoutMs: 600_000,
  },
  {
    id: "us2",
    category: "contract+integration+security+e2e",
    args: ["tools/verification/004-us2-checkpoint.mts"],
    timeoutMs: 600_000,
  },
  {
    id: "us3",
    category: "contract+integration+security+e2e",
    args: ["tools/verification/004-us3-checkpoint.mts"],
    timeoutMs: 600_000,
  },
  {
    id: "us4",
    category: "contract+integration+security+e2e",
    args: ["tools/verification/004-us4-checkpoint.mts"],
    timeoutMs: 600_000,
  },
  {
    id: "openapi-drift",
    category: "contract",
    args: ["tools/contracts/build-openapi-snapshots.mts", "--check"],
    timeoutMs: 180_000,
  },
  {
    id: "registry-drift",
    category: "contract",
    args: ["tools/contracts/build-registry.mts", "--check"],
    timeoutMs: 180_000,
  },
  {
    id: "feature-tests",
    category: "architecture+contract+integration+security+e2e",
    args: ["tools/ci/feature-004-tests.mts"],
    timeoutMs: 900_000,
  },
  {
    id: "migrations-postgres-17-18",
    category: "integration",
    args: ["tools/ci/verify-004-migrations.mts"],
    timeoutMs: 900_000,
  },
  {
    id: "smoke",
    category: "process+e2e",
    args: ["tools/smoke/feature-004.mts"],
    timeoutMs: 3_600_000,
  },
  {
    id: "quickstart",
    category: "documentation+e2e",
    args: ["tools/verification/004-quickstart.mts"],
    timeoutMs: 3_600_000,
  },
  {
    id: "typecheck",
    category: "typecheck",
    args: ["node_modules/nx/dist/bin/nx.js", "run-many", "-t", "typecheck", "--all"],
    timeoutMs: 900_000,
  },
  {
    id: "lint",
    category: "lint",
    args: ["node_modules/eslint/bin/eslint.js", "."],
    timeoutMs: 900_000,
  },
  {
    id: "build",
    category: "build",
    args: ["node_modules/nx/dist/bin/nx.js", "run-many", "-t", "build", "--all"],
    timeoutMs: 1_200_000,
  },
  {
    id: "nonprod-metadata",
    category: "nonprod",
    args: ["tools/verification/feature-004-nonprod-metadata.mts"],
    timeoutMs: 120_000,
  },
  {
    id: "nonprod",
    category: "nonprod",
    args: ["tools/verification/feature-004-nonprod.mts"],
    timeoutMs: 120_000,
  },
  {
    id: "traceability",
    category: "trace",
    args: ["tools/verification/feature-004-trace.mts"],
    timeoutMs: 180_000,
  },
  {
    id: "evidence-aggregation",
    category: "evidence",
    args: ["tools/verification/feature-004-evidence.mts", "--collect"],
    timeoutMs: 180_000,
  },
]);

if (plan) {
  console.table(
    stages.map(({ id, category, args }) => ({ id, category, command: [node, ...args].join(" ") })),
  );
  process.exit(0);
}

const configuredNode = readFileSync(resolve(workspace, ".node-version"), "utf8").trim();
if (process.versions.node !== configuredNode) {
  writeFeature004ReportAtomic(workspace, reportPath, {
    schemaVersion: 1,
    feature: "004-mattermost-hermes-intake",
    gate: "feature-004-final",
    status: "FAIL",
    reasonCode: "NODE_VERSION_MISMATCH",
    activeNode: process.versions.node,
    configuredNode,
    stages: [],
    evidence: [],
    handoff: { status: "NOT_ATTESTED" },
  });
  console.error(
    `[gate:004] NODE_VERSION_MISMATCH active=${process.versions.node} configured=${configuredNode}`,
  );
  process.exit(1);
}

const startedAt = new Date();
writeFeature004ReportAtomic(workspace, reportPath, {
  schemaVersion: 1,
  feature: "004-mattermost-hermes-intake",
  gate: "feature-004-final",
  startedAt: startedAt.toISOString(),
  status: "RUNNING",
  stages: [],
  evidence: [],
  handoff: { status: "NOT_ATTESTED" },
});
const results: StageResult[] = [];
let failed = false;
for (const stage of stages) {
  if (failed) {
    results.push({ ...stage, command: [node, ...stage.args], status: "SKIP", durationMs: 0 });
    continue;
  }
  console.log(`\n[gate:004] ${stage.id}`);
  const stageStarted = Date.now();
  const run = spawnSync(node, [...stage.args], {
    cwd: workspace,
    env: environment,
    stdio: "inherit",
    timeout: stage.timeoutMs,
  });
  const exitCode = run.status ?? 1;
  failed = run.error !== undefined || exitCode !== 0;
  if (run.error) console.error(run.error.message);
  results.push({
    ...stage,
    command: [node, ...stage.args],
    status: failed ? "FAIL" : "PASS",
    durationMs: Date.now() - stageStarted,
    exitCode,
  });
}

const evidenceNames = [...FEATURE_004_AUTHORITATIVE_EVIDENCE, "evidence.json"] as const;
const evidence = evidenceNames.map((name) => {
  const path = resolve(reportsDirectory, name);
  if (!existsSync(path)) return { name, status: "MISSING" };
  try {
    const report = readSafeJsonReport(path);
    return { name, status: report.status ?? "MISSING", sha256: sha256File(path) };
  } catch {
    return { name, status: "INVALID" };
  }
});
const nonprodMetadata = evidence.find(({ name }) => name === "nonprod-metadata.json");
const nonprod = existsSync(resolve(reportsDirectory, "nonprod.json"))
  ? readSafeJsonReport(resolve(reportsDirectory, "nonprod.json"))
  : undefined;
const readinessPath = "specs/004-mattermost-hermes-intake/release-readiness.md";
const readiness = existsSync(resolve(workspace, readinessPath))
  ? readFileSync(resolve(workspace, readinessPath), "utf8")
  : "";
const processPassed =
  !failed && results.length === stages.length && results.every(({ status }) => status === "PASS");
const evidenceAccepted = evidence.every(({ status, name }) =>
  name === "nonprod-metadata.json" || name === "nonprod.json"
    ? status === "PASS" || status === "SKIPPED_GATED"
    : status === "PASS",
);
const readinessAccepted =
  readiness.includes("Release decision: READY when final-gate status is PASS") &&
  readiness.includes("Production: DENIED");
const taskSnapshot = captureFeature004HandoffSnapshot(workspace).taskSnapshot;
const tasksComplete = taskSnapshot.taskCount === 215 && taskSnapshot.pendingTaskIds.length === 0;
const canAttest = processPassed && evidenceAccepted && readinessAccepted && tasksComplete;
const baseReport = {
  schemaVersion: 1,
  feature: "004-mattermost-hermes-intake",
  gate: "feature-004-final",
  contour: "qa-jira-mattermost-local",
  startedAt: startedAt.toISOString(),
  processGateCompletedAt: new Date().toISOString(),
  stages: results,
  categories: Object.fromEntries(
    [...new Set(stages.map(({ category }) => category))].map((category) => [
      category,
      results
        .filter((result) => result.category === category)
        .every(({ status }) => status === "PASS")
        ? "PASS"
        : "FAIL",
    ]),
  ),
  evidence,
  local: processPassed ? "PASS" : "FAIL",
  liveMattermost:
    nonprod?.liveMattermost ?? (nonprod?.status === "SKIPPED_GATED" ? "SKIPPED_GATED" : "NOT_RUN"),
  liveModel:
    nonprod?.liveModel ?? (nonprod?.status === "SKIPPED_GATED" ? "SKIPPED_GATED" : "NOT_RUN"),
  optionalMetadata: nonprodMetadata?.status ?? "MISSING",
  production: "DENIED",
  productionWritesSupported: false,
  releaseReadiness: { path: readinessPath, status: readinessAccepted ? "PASS" : "FAIL" },
};
let finalReport: Readonly<Record<string, unknown>>;
if (canAttest) {
  const snapshot = captureFeature004HandoffSnapshot(workspace);
  const candidate = {
    ...baseReport,
    finishedAt: new Date().toISOString(),
    status: "PASS",
    handoff: {
      status: "BOUND",
      generatedAfterAllProcessGates: true,
      generatedAt: new Date().toISOString(),
      verificationCommand: "pnpm verify:004:evidence",
      toolchain: {
        node: process.versions.node,
        packageManager:
          (
            JSON.parse(readFileSync(resolve(workspace, "package.json"), "utf8")) as {
              packageManager?: string;
            }
          ).packageManager ?? "MISSING",
      },
      ...snapshot,
    },
  };
  const verification = verifyFeature004FinalReport(workspace, candidate);
  finalReport =
    verification.status === "PASS"
      ? candidate
      : {
          ...candidate,
          status: "FAIL",
          handoff: { ...candidate.handoff, status: "INVALIDATED" },
          invalidation: { failures: verification.failures },
        };
} else {
  finalReport = {
    ...baseReport,
    finishedAt: new Date().toISOString(),
    status: "FAIL",
    handoff: {
      status: "NOT_ATTESTED",
      generatedAfterAllProcessGates: false,
      reasonCode: processPassed ? "EVIDENCE_POLICY_OR_TASKS_FAILED" : "PROCESS_GATE_FAILED",
    },
  };
}
writeFeature004ReportAtomic(workspace, reportPath, finalReport);
console.table(
  results.map(({ id, category, status, durationMs }) => ({ id, category, status, durationMs })),
);
console.log(`[gate:004] ${String(finalReport.status)}; report: ${reportPath}`);
if (finalReport.status !== "PASS") process.exitCode = 1;
