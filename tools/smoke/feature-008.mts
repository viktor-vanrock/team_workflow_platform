import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";

import { stringifyPortableJson } from "../verification/portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/008-pilot-hardening-and-conformance/smoke.json");
const digest = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const pathEnvironment = [dirname(process.execPath), process.env.PATH]
  .filter(Boolean)
  .join(delimiter);
const results: Array<Readonly<Record<string, unknown>>> = [];
const startedAt = new Date();
let failed = false;

function run(
  id: string,
  executable: string,
  args: readonly string[],
  timeout: number,
  extraEnvironment: Readonly<Record<string, string>> = {},
): void {
  const execution = spawnSync(executable, [...args], {
    cwd: workspace,
    env: { ...process.env, CI: "true", PATH: pathEnvironment, ...extraEnvironment },
    encoding: "utf8",
    timeout,
    maxBuffer: 10_000_000,
  });
  if (execution.stdout) process.stdout.write(execution.stdout);
  if (execution.stderr) process.stderr.write(execution.stderr);
  const status = execution.status === 0 && execution.error === undefined ? "PASS" : "FAIL";
  failed ||= status === "FAIL";
  results.push(
    Object.freeze({
      id,
      status,
      command: [executable, ...args],
      exitCode: execution.status ?? 1,
      outputSha256: digest(`${execution.stdout ?? ""}\n${execution.stderr ?? ""}`),
    }),
  );
  console.log(`[smoke:008] ${id}: ${status}`);
}

try {
  run("development-up", "pnpm", ["dev:pilot:up"], 900_000);
  if (!failed) {
    run(
      "api-worker-browser-provider-collector",
      process.execPath,
      ["tools/smoke/008-development.mts"],
      180_000,
    );
    run(
      "manual-evidence-notification-restore",
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "tests/integration/008/manual-session-runtime.spec.ts",
        "tests/integration/008/evidence-upload-restart.spec.ts",
        "tests/integration/008/notification-delivery.spec.ts",
        "tests/integration/008/isolated-restore.spec.ts",
        "--maxWorkers=1",
        "--reporter=dot",
      ],
      600_000,
      { AWP_RUN_CONTAINER_TESTS: "true" },
    );
  }
} finally {
  run("development-down", "pnpm", ["dev:pilot:down"], 180_000);
}

const sourcePaths = Object.freeze([
  "tools/smoke/feature-008.mts",
  "tools/smoke/008-development.mts",
  "tests/integration/008/manual-session-runtime.spec.ts",
  "tests/integration/008/evidence-upload-restart.spec.ts",
  "tests/integration/008/notification-delivery.spec.ts",
  "tests/integration/008/isolated-restore.spec.ts",
  "infra/compose/docker-compose.local.yml",
  "infra/observability/otel-collector.yaml",
]);
const sourceBinding = sourcePaths.map((path) =>
  Object.freeze({ path, sha256: digest(readFileSync(resolve(workspace, path))) }),
);
const report = Object.freeze({
  schemaVersion: 1,
  feature: "008-pilot-hardening-and-conformance",
  gate: "full-stack-local-smoke",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  mode: "DEVELOPMENT_MOCKS",
  corporateReady: false,
  coverage: Object.freeze({
    api: true,
    worker: true,
    browser: true,
    manual: true,
    automation: true,
    evidence: true,
    notification: true,
    restore: true,
    collector: true,
    providerIndependentCount: true,
  }),
  results,
  sourceBinding: Object.freeze({
    files: sourceBinding,
    aggregateSha256: digest(JSON.stringify(sourceBinding)),
  }),
});
mkdirSync(dirname(reportPath), { recursive: true });
const temporary = `${reportPath}.tmp-${process.pid}`;
writeFileSync(temporary, stringifyPortableJson(report, workspace), "utf8");
renameSync(temporary, reportPath);
console.log(`[smoke:008] ${report.status}; report: ${reportPath}`);
if (failed) process.exitCode = 1;
