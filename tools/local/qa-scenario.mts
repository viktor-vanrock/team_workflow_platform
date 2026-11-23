import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { stringifyPortableJson } from "../verification/portable-json.mts";

const workspace = resolve(import.meta.dirname, "../..");
const artifactDirectory = resolve(workspace, "artifacts/verification");
const vitestEntry = resolve(workspace, "node_modules/vitest/vitest.mjs");

const scenarios = Object.freeze({
  "qa-manual-pass": Object.freeze({
    description: "Accepted request to immutable reviewed PASS evidence.",
    tests: Object.freeze(["tests/integration/002-manual-session-vertical-flow.spec.ts"]),
  }),
  "qa-manual-fail": Object.freeze({
    description: "Reviewed FAIL, linked defect, signed Verdict and operational DONE.",
    tests: Object.freeze(["tests/integration/002-manual-vertical-flow.spec.ts"]),
  }),
  "qa-high-risk": Object.freeze({
    description: "High-risk dual-signature, expiry, drift and supersession policy.",
    tests: Object.freeze([
      "tests/integration/security/acceptance/002-at-010-verdict-risk-review.spec.ts",
    ]),
  }),
  "qa-model-outage": Object.freeze({
    description: "Unset, invalid, unavailable and restricted model fallbacks.",
    tests: Object.freeze(["tests/e2e/acceptance/002-at-013-model-degraded-mode.spec.ts"]),
  }),
  "qa-cross-project-deny": Object.freeze({
    description: "Deny-before-downstream cross-Project and cross-Workspace isolation.",
    tests: Object.freeze([
      "tests/integration/security/acceptance/002-at-012-cross-project-isolation.spec.ts",
    ]),
  }),
});

type ScenarioName = keyof typeof scenarios;

function artifactPath(name: ScenarioName): string {
  return resolve(artifactDirectory, `002-scenario-${name}.json`);
}

function list(): void {
  for (const [name, scenario] of Object.entries(scenarios))
    console.log(`${name}\t${scenario.description}`);
}

function parseScenarioName(value: string | undefined): ScenarioName {
  if (!value || !(value in scenarios))
    throw new Error(
      `Unknown QA scenario: ${value ?? "<missing>"}. Run with 'list' to see the closed catalog.`,
    );
  return value as ScenarioName;
}

function run(name: ScenarioName): void {
  const scenario = scenarios[name];
  const startedAt = new Date().toISOString();
  const result = spawnSync(
    process.execPath,
    [vitestEntry, "run", ...scenario.tests, "--maxWorkers=1"],
    {
      cwd: workspace,
      env: { ...process.env, AWP_COMPOSITION: "qa-local", AWP_RUNTIME_PROFILE: "test" },
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  mkdirSync(artifactDirectory, { recursive: true });
  const status = result.status ?? 1;
  writeFileSync(
    artifactPath(name),
    stringifyPortableJson(
      {
        feature: "002",
        scenario: name,
        composition: "qa-local",
        tests: scenario.tests,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: status === 0 ? "PASS" : "FAIL",
        exitCode: status,
      },
      workspace,
    ),
    "utf8",
  );
  console.log(`scenario.report=${artifactPath(name)}`);
  if (status !== 0) process.exit(status);
}

function reset(): void {
  const unexpected = process.argv.slice(3).filter((value) => value !== "--");
  if (unexpected.length > 0)
    throw new Error(
      "QA scenario reset accepts no arguments and removes only known scenario reports.",
    );
  let removed = 0;
  for (const name of Object.keys(scenarios) as ScenarioName[]) {
    const path = artifactPath(name);
    if (existsSync(path)) {
      unlinkSync(path);
      removed += 1;
    }
  }
  console.log(
    `Removed ${removed} scoped QA scenario report(s); databases and source files were not changed.`,
  );
}

const command = process.argv[2] ?? "list";
switch (command) {
  case "list":
    list();
    break;
  case "run":
    run(parseScenarioName(process.argv[3]));
    break;
  case "reset":
    reset();
    break;
  default:
    run(parseScenarioName(command));
}
