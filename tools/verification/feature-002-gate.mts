import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "artifacts/verification/feature-002-gate.json");
const flags = new Set(process.argv.slice(2));
const known = new Set(["--plan", "--skip-runtime", "--skip-install"]);
const unknown = [...flags].filter((value) => !known.has(value));
if (unknown.length > 0) throw new Error(`Unknown verify:002 arguments: ${unknown.join(" ")}`);
const node = process.execPath;
const cleanProjectName = "awp-local-f002-gate";
interface Stage {
  readonly id: string;
  readonly command: readonly string[];
  readonly runtime?: boolean;
}
interface Result extends Stage {
  readonly status: "PASS" | "FAIL" | "SKIP";
  readonly durationMs: number;
  readonly exitCode?: number;
}
const stages: readonly Stage[] = Object.freeze([
  {
    id: "combined-regression",
    command: [node, "tools/verification/feature-002-regression-gate.mts", "--clean-smoke"],
    runtime: true,
  },
  {
    id: "provider-neutral-ci",
    command: [
      node,
      "tools/ci/feature-002.mts",
      ...(flags.has("--skip-install") ? ["--skip-install"] : []),
      "--skip-runtime",
    ],
  },
  {
    id: "foundation-down",
    command: [node, "tools/local/cli.mts", "foundation", "down"],
    runtime: true,
  },
  { id: "qa-clean", command: [node, "tools/local/cli.mts", "qa", "reset", "--yes"], runtime: true },
  { id: "qa-up", command: [node, "tools/local/cli.mts", "qa", "up"], runtime: true },
  { id: "qa-seed", command: [node, "tools/local/cli.mts", "qa", "seed"], runtime: true },
  {
    id: "qa-playwright",
    command: [
      node,
      "node_modules/@playwright/test/cli.js",
      "test",
      "tests/e2e/acceptance/002-at-014-manual-walking-skeleton.spec.ts",
    ],
    runtime: true,
  },
  { id: "trace", command: [node, "tools/verification/feature-002-trace.mts"] },
  { id: "success-report", command: [node, "tools/verification/feature-002-success-report.mts"] },
]);
const selected = stages.filter((stage) => !(flags.has("--skip-runtime") && stage.runtime));
if (flags.has("--plan")) {
  console.table(selected.map(({ id, command }) => ({ id, command: command.join(" ") })));
  process.exit(0);
}

const results: Result[] = [];
let failed = false;
const startedAt = new Date();
for (const stage of selected) {
  if (failed) {
    results.push({ ...stage, status: "SKIP", durationMs: 0 });
    continue;
  }
  console.log(`\n[gate:002] ${stage.id}`);
  const started = Date.now();
  const result = spawnSync(stage.command[0]!, [...stage.command.slice(1)], {
    cwd: workspace,
    stdio: "inherit",
    env: { ...process.env, CI: "true", AWP_LOCAL_PROJECT_NAME: cleanProjectName },
  });
  if (result.error) throw result.error;
  const exitCode = result.status ?? 1;
  results.push({
    ...stage,
    status: exitCode === 0 ? "PASS" : "FAIL",
    durationMs: Date.now() - started,
    exitCode,
  });
  failed = exitCode !== 0;
}
function readReport(name: string): Readonly<Record<string, unknown>> | undefined {
  const path = resolve(workspace, `artifacts/verification/${name}`);
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as Readonly<Record<string, unknown>>)
    : undefined;
}
const trace = readReport("feature-002-trace.json");
const smoke = readReport("feature-002-smoke.json");
const traceEntries = (trace?.entries ?? []) as readonly Readonly<{
  id: string;
  kind: string;
  status: string;
}>[];
const acceptance = traceEntries.filter(({ kind }) => kind === "acceptance");
const requirements = traceEntries.filter(({ kind }) => kind === "requirement");
const successCriteria = traceEntries.filter(({ kind }) => kind === "success-criterion");
const status =
  !failed &&
  trace?.status === "PASS" &&
  smoke?.status === "PASS" &&
  acceptance.length === 15 &&
  acceptance.every(({ status }) => status === "PASS")
    ? "PASS"
    : "FAIL";
const report = {
  schemaVersion: 1,
  feature: "002-qa-manual-walking-skeleton",
  gate: "feature-002-final",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status,
  composition: flags.has("--skip-runtime") ? "not-started" : "qa-local",
  composeProject: flags.has("--skip-runtime") ? null : cleanProjectName,
  stages: results,
  acceptance,
  requirements: {
    total: requirements.length,
    passed: requirements.filter(({ status }) => status === "PASS").length,
  },
  successCriteria: {
    total: successCriteria.length,
    passed: successCriteria.filter(({ status }) => status === "PASS").length,
  },
  effects: smoke?.effectAssertions ?? null,
  audit: {
    status: results.some(({ id, status }) => id === "provider-neutral-ci" && status === "PASS")
      ? "PASS"
      : "FAIL",
    redactionTest: "tests/integration/security/002-secret-redaction-scan.spec.ts",
    constitutionalExceptions: 0,
  },
};
mkdirSync(resolve(reportPath, ".."), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(
  `[gate:002] ${status}; AT=${acceptance.filter(({ status }) => status === "PASS").length}/15; FR=${report.requirements.passed}/${report.requirements.total}; SC=${report.successCriteria.passed}/${report.successCriteria.total}; report: ${reportPath}`,
);
if (status !== "PASS") process.exitCode = 1;
