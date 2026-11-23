import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/003-jira-operational-authority/foundation.json");
const startedAt = new Date();

interface Stage {
  readonly id: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

interface StageResult extends Stage {
  readonly command: readonly string[];
  readonly status: "PASS" | "FAIL" | "SKIP";
  readonly exitCode?: number;
  readonly durationMs: number;
}

const stages: readonly Stage[] = Object.freeze([
  {
    id: "contracts-and-architecture",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/contract/003",
      "tests/architecture/003-jira-boundaries.spec.ts",
      "tests/architecture/feature-001-hard-boundaries.spec.ts",
      "--maxWorkers=1",
    ],
    timeoutMs: 180_000,
  },
  {
    id: "foundation-domain-security-and-mock",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/003/operational-binding-chain.spec.ts",
      "tests/integration/003/target-execution-lane.spec.ts",
      "tests/integration/003/external-identity-import.spec.ts",
      "tests/integration/003/projection-conflict.spec.ts",
      "tests/integration/003/jira-profile-lifecycle.spec.ts",
      "tests/integration/003/jira-effect-recovery.spec.ts",
      "tests/integration/003/jira-reconciliation.spec.ts",
      "tests/integration/security/003/webhook-ingress.spec.ts",
      "tests/integration/security/003/jira-auth-egress.spec.ts",
      "tests/integration/002-qa-foundation-composition.spec.ts",
      "--maxWorkers=1",
    ],
    timeoutMs: 180_000,
  },
  {
    id: "postgres-migrations",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/migrations/003-operational-authority.spec.ts",
      "--maxWorkers=1",
    ],
    timeoutMs: 180_000,
  },
  {
    id: "typecheck",
    args: [
      "node_modules/nx/dist/bin/nx.js",
      "run-many",
      "-t",
      "typecheck",
      "-p",
      "connector-sdk",
      "platform-core",
      "platform-persistence-typeorm",
      "connector-jira",
      "connector-jira-persistence-typeorm",
      "runtime-composition",
      "platform-runtime-nest",
      "api",
      "worker",
      "mock-hub",
    ],
    timeoutMs: 240_000,
  },
  {
    id: "eslint",
    args: [
      "node_modules/eslint/bin/eslint.js",
      "packages/connector-sdk/src",
      "packages/platform-core/src/work-management",
      "packages/platform-core/src/identity-access/external-principal-binding.ts",
      "packages/platform-core/src/events/external-entity-observation.ts",
      "packages/platform-core/src/events/webhook-ingress.ts",
      "packages/platform-core/src/commanding/target-execution-lane.ts",
      "packages/platform-persistence-typeorm/src",
      "packages/connector-jira/src",
      "packages/connector-jira-persistence-typeorm/src",
      "packages/runtime-composition/src/jira",
      "packages/platform-runtime-nest/src/http",
      "apps/mock-hub/src/jira",
      "tests/contract/003",
      "tests/architecture/003-jira-boundaries.spec.ts",
      "tests/integration/003",
      "tests/integration/security/003",
    ],
    timeoutMs: 180_000,
  },
]);

const results: StageResult[] = [];
let failed = false;
for (const stage of stages) {
  if (failed) {
    results.push({
      ...stage,
      command: [process.execPath, ...stage.args],
      status: "SKIP",
      durationMs: 0,
    });
    continue;
  }
  const started = Date.now();
  const result = spawnSync(process.execPath, [...stage.args], {
    cwd: workspace,
    env: { ...process.env, CI: "true" },
    stdio: "inherit",
    timeout: stage.timeoutMs,
  });
  const exitCode = result.status ?? 1;
  failed = result.error !== undefined || exitCode !== 0;
  results.push({
    ...stage,
    command: [process.execPath, ...stage.args],
    status: failed ? "FAIL" : "PASS",
    exitCode,
    durationMs: Date.now() - started,
  });
  if (result.error) console.error(result.error.message);
}

const evidenceFiles = Object.freeze([
  "specs/003-jira-operational-authority/spec.md",
  "specs/003-jira-operational-authority/plan.md",
  "specs/003-jira-operational-authority/tasks.md",
  "config/local/jira-pilot-metadata.v1.json",
  "packages/platform-persistence-typeorm/src/migrations/core/0090-operational-authority.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0095-external-identity-import-reconciliation.ts",
  "packages/connector-jira-persistence-typeorm/src/migrations/3030-jira-authoritative-read-outbox-lease.ts",
  "packages/connector-jira-persistence-typeorm/src/migrations/3040-jira-effect-lease-owner.ts",
]);
const hashes = Object.fromEntries(
  evidenceFiles.map((path) => [
    path,
    `sha256:${createHash("sha256")
      .update(readFileSync(resolve(workspace, path)))
      .digest("hex")}`,
  ]),
);
const report = {
  schemaVersion: 1,
  feature: "003-jira-operational-authority",
  gate: "foundation",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  invariants: {
    providerNeutralAboveConnector: true,
    exactWebhookBytesBeforeAck: true,
    orderedImmutableConfigurationPins: true,
    fencedTargetExecutionLane: true,
    schemaVersions: { featureCoreTail: 95, currentCore: 140, connector: 3040 },
  },
  hashes,
  stages: results,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.table(results.map(({ id, status, durationMs }) => ({ id, status, durationMs })));
console.log(`[foundation:003] ${report.status}; report: ${reportPath}`);
if (failed) process.exitCode = 1;
