import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";

import { validateCommandCatalog008 } from "./feature-008-command-catalog.mts";
import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(
  workspace,
  "reports/008-pilot-hardening-and-conformance/quickstart.json",
);
const quickstartPath = "specs/008-pilot-hardening-and-conformance/quickstart.md";
const digest = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const pathEnvironment = [dirname(process.execPath), process.env.PATH]
  .filter(Boolean)
  .join(delimiter);
const results: Array<Readonly<Record<string, unknown>>> = [];
const startedAt = new Date();
let failed = false;

function record(id: string, status: "PASS" | "FAIL", detail: Record<string, unknown>): void {
  failed ||= status === "FAIL";
  results.push(Object.freeze({ id, status, ...detail }));
  console.log(`[verify:008:quickstart] ${id}: ${status}`);
}

function run(id: string, executable: string, args: readonly string[], timeout: number): void {
  const execution = spawnSync(executable, [...args], {
    cwd: workspace,
    env: { ...process.env, CI: "true", PATH: pathEnvironment },
    encoding: "utf8",
    timeout,
    maxBuffer: 10_000_000,
  });
  if (execution.stdout) process.stdout.write(execution.stdout);
  if (execution.stderr) process.stderr.write(execution.stderr);
  record(id, execution.status === 0 && execution.error === undefined ? "PASS" : "FAIL", {
    command: [executable, ...args],
    exitCode: execution.status ?? 1,
    outputSha256: digest(`${execution.stdout ?? ""}\n${execution.stderr ?? ""}`),
  });
}

const catalogErrors = validateCommandCatalog008(workspace);
const quickstart = readFileSync(resolve(workspace, quickstartPath), "utf8");
const packageScripts = (
  JSON.parse(readFileSync(resolve(workspace, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;
const documentedPnpmCommands = [...quickstart.matchAll(/^pnpm\s+([^\s]+).*$/gmu)].map(
  (match) => match[1]!,
);
const documentedNodePaths = [...quickstart.matchAll(/^node\s+(tools\/[^\s]+).*$/gmu)].map(
  (match) => match[1]!,
);
const documentationErrors = [
  ...documentedPnpmCommands
    .filter((name) => packageScripts[name] === undefined)
    .map((name) => `UNKNOWN_PACKAGE_SCRIPT:${name}`),
  ...documentedNodePaths
    .filter((path) => !existsSync(resolve(workspace, path)))
    .map((path) => `MISSING_TOOL:${path}`),
];
record(
  "command-catalog",
  catalogErrors.length === 0 && documentationErrors.length === 0 ? "PASS" : "FAIL",
  { catalogErrors, documentationErrors, documentedPnpmCommands, documentedNodePaths },
);

try {
  run("development-up", "pnpm", ["dev:pilot:up"], 900_000);
  if (!failed) {
    run("development-status", "pnpm", ["dev:pilot:status"], 120_000);
    run("development-guide-smoke", process.execPath, ["tools/smoke/008-development.mts"], 180_000);
  }
} finally {
  run("development-down", "pnpm", ["dev:pilot:down"], 180_000);
}

const sourcePaths = Object.freeze([
  quickstartPath,
  "tools/verification/feature-008-command-catalog.mts",
  "tools/local/pilot-cli.mts",
  "tools/smoke/008-development.mts",
  "package.json",
]);
const sourceBinding = sourcePaths.map((path) =>
  Object.freeze({ path, sha256: digest(readFileSync(resolve(workspace, path))) }),
);
const report = Object.freeze({
  schemaVersion: 1,
  feature: "008-pilot-hardening-and-conformance",
  gate: "quickstart",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  mode: "DEVELOPMENT_MOCKS",
  corporateReady: false,
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
console.log(`[verify:008:quickstart] ${report.status}; report: ${reportPath}`);
if (failed) process.exitCode = 1;
