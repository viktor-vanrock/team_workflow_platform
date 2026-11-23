import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";

import { currentFingerprints008 } from "../verification/feature-008-reports.mts";

const root = resolve(import.meta.dirname, "../..");
const output = resolve(root, "reports/project");
mkdirSync(output, { recursive: true });
const startedAt = new Date().toISOString();
const fingerprints = currentFingerprints008(root);
const env = {
  ...process.env,
  PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter),
  CI: "true",
  NX_DAEMON: "false",
  NX_ISOLATE_PLUGINS: "false",
  AWP_RUN_CONTAINER_TESTS: "true",
};
const stages: {
  id: string;
  status: "PASS" | "FAIL";
  exitCode: number;
  logPath: string;
  logSha256: string;
}[] = [];
const hash = (bytes: string | Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function run(id: string, args: string[], timeout = 600_000) {
  process.stdout.write(`[ci:project] ${id}\n`);
  const child = spawnSync("pnpm", args, {
    cwd: root,
    env,
    encoding: "utf8",
    timeout,
    maxBuffer: 100_000_000,
  });
  const log = `${child.stdout ?? ""}\n${child.stderr ?? ""}\n${child.error?.message ?? ""}`;
  const logPath = `reports/project/${id}.log`;
  writeFileSync(resolve(root, logPath), log);
  stages.push({
    id,
    status: child.status === 0 && !child.error ? "PASS" : "FAIL",
    exitCode: child.status ?? 1,
    logPath,
    logSha256: hash(log),
  });
  process.stdout.write(`[ci:project] ${id}: ${stages.at(-1)!.status}\n`);
}

run("format", ["format:check"]);
run("lint", ["lint"], 1_800_000);
run("typecheck", ["typecheck"]);
run("build", ["build"]);
run("architecture", ["architecture"]);
run("contracts", ["exec", "node", "tools/contracts/build-registry.mts", "--check"]);
run("openapi", ["exec", "node", "tools/contracts/build-openapi-snapshots.mts", "--check"]);
run("dependency-audit", ["audit", "--json"]);
run(
  "tests",
  [
    "exec",
    "vitest",
    "run",
    "--maxWorkers=2",
    "--reporter=json",
    "--outputFile=reports/project/vitest.json",
  ],
  3_600_000,
);
let tests:
  { total: number; passed: number; failed: number; skipped: number; todo: number } | undefined;
try {
  const report = JSON.parse(readFileSync(resolve(output, "vitest.json"), "utf8")) as {
    success: boolean;
    numTotalTests: number;
    numPassedTests: number;
    numFailedTests: number;
    numPendingTests: number;
    numTodoTests: number;
    startTime: number;
  };
  tests = {
    total: report.numTotalTests,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    skipped: report.numPendingTests,
    todo: report.numTodoTests ?? 0,
  };
  if (
    !report.success ||
    !Number.isInteger(tests.total) ||
    tests.total < 1 ||
    tests.passed !== tests.total ||
    tests.failed ||
    tests.skipped ||
    tests.todo ||
    report.startTime < Date.parse(startedAt)
  )
    throw new Error("TEST_REPORT_INCOMPLETE");
} catch {
  stages.push({
    id: "complete-test-discovery",
    status: "FAIL",
    exitCode: 1,
    logPath: "reports/project/vitest.json",
    logSha256: "unavailable",
  });
}
const unchanged = JSON.stringify(fingerprints) === JSON.stringify(currentFingerprints008(root));
const status = stages.every((stage) => stage.status === "PASS") && unchanged ? "PASS" : "FAIL";
writeFileSync(
  resolve(output, "local.json"),
  `${JSON.stringify({ schemaVersion: 1, gate: "project-regression", status, startedAt, finishedAt: new Date().toISOString(), fingerprints, unchangedSource: unchanged, tests, stages, corporateReady: false }, null, 2)}\n`,
);
process.stdout.write(`[ci:project] ${status}; reports/project/local.json\n`);
if (status !== "PASS") process.exitCode = 1;
