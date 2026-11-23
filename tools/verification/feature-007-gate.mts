import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

type StageStatus = "PASS" | "FAIL" | "SKIPPED_GATED";
interface Stage {
  readonly id: string;
  readonly category: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}
interface StageResult extends Stage {
  readonly status: StageStatus;
  readonly exitCode?: number;
  readonly durationMs: number;
}
const workspace = resolve(import.meta.dirname, "../..");
const feature = "007-project-onboarding-evidence-security";
const reportDirectory = resolve(workspace, `reports/${feature}`);
const compatibilityPath = resolve(reportDirectory, "compatibility.json");
const preFinalPath = resolve(reportDirectory, "pre-final-gate.json");
const finalPath = resolve(reportDirectory, "final-gate.json");
const flags = new Set(process.argv.slice(2).filter((value) => value !== "--"));
const unknown = [...flags].filter((flag) => flag !== "--plan" && flag !== "--compatibility-only");
if (unknown.length > 0)
  throw new Error(`Unknown Feature 007 gate arguments: ${unknown.join(", ")}`);
const node = process.execPath;
const vitest = "node_modules/vitest/vitest.mjs";
const compatibilityStages: readonly Stage[] = Object.freeze([
  {
    id: "feature-001-006-compatibility",
    category: "compatibility",
    args: ["tools/verification/feature-007-prerequisites.mts"],
    timeoutMs: 180_000,
  },
  {
    id: "contract-registry-drift",
    category: "contract",
    args: ["tools/contracts/build-registry.mts", "--check"],
    timeoutMs: 180_000,
  },
  {
    id: "historical-schema-byte-pins",
    category: "contract",
    args: [
      vitest,
      "run",
      "tests/contract/007/historical-contract-compatibility.spec.ts",
      "--maxWorkers=1",
    ],
    timeoutMs: 180_000,
  },
  {
    id: "migration-immutability",
    category: "migration",
    args: [
      vitest,
      "run",
      "tests/integration/migrations/007-migration-registry.spec.ts",
      "tests/contract/007/prerequisite-gate.spec.ts",
      "--maxWorkers=1",
    ],
    timeoutMs: 180_000,
  },
  {
    id: "production-boundary",
    category: "security",
    args: [
      vitest,
      "run",
      "tests/integration/security/007/production-and-scope-boundary.spec.ts",
      "--maxWorkers=1",
    ],
    timeoutMs: 180_000,
  },
]);
const deliveryStages: readonly Stage[] = Object.freeze([
  {
    id: "setup",
    category: "setup",
    args: ["tools/verification/007-setup-gate.mts"],
    timeoutMs: 300_000,
  },
  {
    id: "foundation",
    category: "foundation",
    args: ["tools/verification/007-foundation-checkpoint.mts"],
    timeoutMs: 1_200_000,
  },
  ...[1, 2, 3, 4, 5].map((story): Stage => ({
    id: `us${story}`,
    category: "story",
    args: [`tools/verification/007-us${story}-checkpoint.mts`],
    timeoutMs: 3_600_000,
  })),
  {
    id: "migrations-postgres-17-18",
    category: "migration",
    args: ["tools/ci/verify-007-migrations.mts"],
    timeoutMs: 1_200_000,
  },
  {
    id: "concurrency",
    category: "concurrency",
    args: ["tools/verification/007-concurrency-checkpoint.mts"],
    timeoutMs: 600_000,
  },
  {
    id: "integration",
    category: "integration",
    args: ["tools/verification/007-integration-checkpoint.mts"],
    timeoutMs: 1_200_000,
  },
  {
    id: "security",
    category: "security",
    args: ["tools/verification/007-security-checkpoint.mts"],
    timeoutMs: 600_000,
  },
  {
    id: "recovery",
    category: "recovery",
    args: ["tools/verification/007-recovery-checkpoint.mts"],
    timeoutMs: 600_000,
  },
  {
    id: "observability",
    category: "observability",
    args: ["tools/verification/feature-007-observability.mts"],
    timeoutMs: 600_000,
  },
  {
    id: "browser",
    category: "browser",
    args: ["tools/verification/007-browser-checkpoint.mts"],
    timeoutMs: 600_000,
  },
  { id: "smoke", category: "smoke", args: ["tools/smoke/feature-007.mts"], timeoutMs: 3_600_000 },
  {
    id: "quickstart-parser",
    category: "documentation",
    args: [vitest, "run", "tests/contract/007/quickstart-commands.spec.ts", "--maxWorkers=1"],
    timeoutMs: 180_000,
  },
  {
    id: "quickstart",
    category: "documentation",
    args: ["tools/verification/007-quickstart.mts"],
    timeoutMs: 600_000,
  },
  {
    id: "trace",
    category: "trace",
    args: ["tools/verification/feature-007-trace.mts"],
    timeoutMs: 300_000,
  },
  {
    id: "typecheck",
    category: "typecheck",
    args: ["node_modules/nx/dist/bin/nx.js", "run-many", "-t", "typecheck", "--all"],
    timeoutMs: 1_200_000,
  },
  {
    id: "lint",
    category: "lint",
    args: ["node_modules/eslint/bin/eslint.js", "."],
    timeoutMs: 1_200_000,
  },
  {
    id: "build",
    category: "build",
    args: ["node_modules/nx/dist/bin/nx.js", "run-many", "-t", "build", "--all"],
    timeoutMs: 1_200_000,
  },
  {
    id: "evidence",
    category: "evidence",
    args: ["tools/verification/feature-007-evidence.mts"],
    timeoutMs: 300_000,
  },
]);
if (flags.has("--plan")) {
  console.table(
    [...compatibilityStages, ...deliveryStages].map(({ id, category, args }) => ({
      id,
      category,
      command: [node, ...args].join(" "),
    })),
  );
  process.exit(0);
}
function writeAtomic(file: string, report: Readonly<Record<string, unknown>>): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, stringifyPortableJson(report, workspace), "utf8");
  renameSync(temporary, file);
}
function execute(stage: Stage, environment: NodeJS.ProcessEnv): StageResult {
  console.log(`\n[gate:007] ${stage.id}`);
  const startedAt = Date.now();
  const result = spawnSync(node, [...stage.args], {
    cwd: workspace,
    env: environment,
    stdio: "inherit",
    timeout: stage.timeoutMs,
  });
  if (result.error) console.error(`[gate:007] ${stage.id}: ${result.error.message}`);
  const exitCode = result.status ?? 1;
  return Object.freeze({
    ...stage,
    status: result.error === undefined && exitCode === 0 ? "PASS" : "FAIL",
    exitCode,
    durationMs: Date.now() - startedAt,
  });
}
const configuredNode = readFileSync(resolve(workspace, ".node-version"), "utf8").trim();
const startedAt = new Date();
const environment = Object.freeze({
  ...process.env,
  CI: "true",
  AWP_FEATURE_007_GATE_STARTED_AT: startedAt.toISOString(),
  PATH: [dirname(node), process.env.PATH].filter(Boolean).join(delimiter),
});
const compatibilityResults =
  process.versions.node === configuredNode
    ? compatibilityStages.map((stage) => execute(stage, environment))
    : compatibilityStages.map((stage): StageResult =>
        Object.freeze({ ...stage, status: "FAIL", exitCode: 1, durationMs: 0 }),
      );
const compatibilityStatus = compatibilityResults.every(({ status }) => status === "PASS")
  ? "PASS"
  : "FAIL";
const compatibilityReport = Object.freeze({
  schemaVersion: 1,
  feature,
  gate: "feature-007-compatibility",
  status: compatibilityStatus,
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  configuredNode,
  activeNode: process.versions.node,
  contour: "qa-jira-gitlab-mattermost-local",
  production: "DENIED",
  externalNetwork: "DENIED",
  stages: compatibilityResults,
});
writeAtomic(compatibilityPath, compatibilityReport);
console.log(`[gate:007:compatibility] ${compatibilityStatus}; report: ${compatibilityPath}`);
if (flags.has("--compatibility-only")) {
  if (compatibilityStatus !== "PASS") process.exitCode = 1;
  process.exit();
}
if (compatibilityStatus !== "PASS") {
  writeAtomic(
    preFinalPath,
    Object.freeze({
      schemaVersion: 1,
      feature,
      gate: "feature-007-pre-final",
      status: "FAIL",
      reasonCode: "T182_COMPATIBILITY_FAILED",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      compatibilityReport: Object.freeze({
        path: relativePath(compatibilityPath),
        sha256: fileDigest(compatibilityPath),
      }),
      stages: deliveryStages.map((stage) =>
        Object.freeze({ ...stage, status: "SKIPPED_GATED", durationMs: 0 }),
      ),
      finalGateWritten: false,
    }),
  );
  console.error(
    `[gate:007] T182 compatibility failed; final gate was not executed; report: ${preFinalPath}`,
  );
  process.exit(1);
}
const deliveryResults: StageResult[] = [];
let failed = false;
for (const stage of deliveryStages) {
  if (failed) {
    deliveryResults.push(Object.freeze({ ...stage, status: "SKIPPED_GATED", durationMs: 0 }));
    continue;
  }
  const result = execute(stage, environment);
  deliveryResults.push(result);
  failed = result.status !== "PASS";
}
const evidencePath = resolve(reportDirectory, "evidence.json");
const evidence = existsSync(evidencePath)
  ? (JSON.parse(readFileSync(evidencePath, "utf8")) as Record<string, unknown>)
  : undefined;
const pending =
  evidence && typeof evidence.snapshots === "object" && evidence.snapshots !== null
    ? (((
        (evidence.snapshots as Record<string, unknown>).tasks as Record<string, unknown> | undefined
      )?.pendingTaskIds as unknown[] | undefined) ?? [])
    : ["UNKNOWN"];
const status = !failed && evidence?.status === "PASS" && pending.length === 0 ? "PASS" : "FAIL";
const finalReport = Object.freeze({
  schemaVersion: 1,
  feature,
  gate: "feature-007-final",
  status,
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  contour: "qa-jira-gitlab-mattermost-local",
  production: "DENIED",
  deploymentApproval: "LOCAL_CONFORMANCE_ONLY",
  corporateRuntimeOwner: "FEATURE_008",
  autonomousPriority: false,
  liveProviderAuthority: false,
  compatibility: Object.freeze({
    path: relativePath(compatibilityPath),
    sha256: fileDigest(compatibilityPath),
    status: compatibilityStatus,
  }),
  evidence: existsSync(evidencePath)
    ? Object.freeze({
        path: relativePath(evidencePath),
        sha256: fileDigest(evidencePath),
        status: evidence?.status ?? "INVALID",
      })
    : Object.freeze({ path: relativePath(evidencePath), status: "MISSING" }),
  stages: [...compatibilityResults, ...deliveryResults],
  pendingTaskIds: pending,
});
writeAtomic(finalPath, finalReport);
console.log(`[gate:007] ${status}; report: ${finalPath}`);
if (status !== "PASS") process.exitCode = 1;
function relativePath(file: string): string {
  return file.slice(`${workspace}/`.length);
}
function fileDigest(file: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
}
