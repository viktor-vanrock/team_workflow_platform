import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/004-mattermost-hermes-intake/foundation.json");
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
    id: "contracts-unit-architecture",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/unit/004",
      "tests/contract/004",
      "tests/architecture/004-mattermost-boundaries.spec.ts",
      "tests/architecture/004-mattermost-runtime-wiring.spec.ts",
      "--maxWorkers=1",
    ],
    timeoutMs: 180_000,
  },
  {
    id: "foundation-integration-security",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/004",
      "tests/integration/security/004",
      "--maxWorkers=1",
    ],
    timeoutMs: 180_000,
  },
  {
    id: "postgres-migrations",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/migrations/004-mattermost-hermes-intake.spec.ts",
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
      "competency-qa",
      "connector-mattermost",
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
      "packages/platform-core/src",
      "packages/platform-persistence-typeorm/src",
      "packages/competency-qa/src",
      "packages/connector-mattermost/src",
      "packages/runtime-composition/src",
      "packages/platform-runtime-nest/src",
      "apps/api/src",
      "apps/worker/src",
      "apps/mock-hub/src/mattermost",
      "tests/unit/004",
      "tests/contract/004",
      "tests/integration/004",
      "tests/integration/security/004",
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
  "specs/004-mattermost-hermes-intake/spec.md",
  "specs/004-mattermost-hermes-intake/plan.md",
  "specs/004-mattermost-hermes-intake/tasks.md",
  "config/local/mattermost-pilot-metadata.v1.json",
  "packages/platform-persistence-typeorm/src/migrations/core/0100-action-candidate-draft.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0105-interaction-intents.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0110-agent-runtime.ts",
  "packages/platform-persistence-typeorm/src/migrations/core/0120-notification-intents.ts",
  "packages/competency-qa/src/persistence/migrations/2040-hermes-proposals.ts",
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
  feature: "004-mattermost-hermes-intake",
  gate: "foundation",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  invariants: {
    capabilityOwnedWorkerClaims: true,
    markedMattermostWritesLookupOnly: true,
    callbackRawBodyNotPersisted: true,
    providerNeutralCore: true,
    schemaVersions: { core: 120, packQa: 2040, mock: 52 },
  },
  hashes,
  stages: results,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.table(results.map(({ id, status, durationMs }) => ({ id, status, durationMs })));
console.log(`[foundation:004] ${report.status}; report: ${reportPath}`);
if (failed) process.exitCode = 1;
