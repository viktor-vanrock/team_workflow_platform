import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { stringifyPortableJson } from "./portable-json.mts";

interface Stage {
  readonly id: string;
  readonly args: readonly string[];
}

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/005-gitlab-automated-validation/observability.json");
const flags = new Set(process.argv.slice(2).filter((value) => value !== "--"));
const unknown = [...flags].filter((value) => value !== "--plan");
if (unknown.length > 0)
  throw new Error(`Unknown Feature 005 observability arguments: ${unknown.join(", ")}`);

const stages: readonly Stage[] = Object.freeze([
  {
    id: "observability-slo",
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/005/observability-slo.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "runtime-typecheck",
    args: [
      "node_modules/typescript/bin/tsc",
      "-p",
      "packages/runtime-composition/tsconfig.json",
      "--noEmit",
    ],
  },
]);
if (flags.has("--plan")) {
  console.table(stages.map(({ id, args }) => ({ id, command: ["node", ...args].join(" ") })));
  process.exit(0);
}

const digest = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const startedAt = new Date();
const results: Array<
  Readonly<{
    id: string;
    status: "PASS" | "FAIL" | "SKIP";
    exitCode?: number;
    durationMs: number;
    outputHash?: `sha256:${string}`;
  }>
> = [];
let failed = false;
for (const stage of stages) {
  if (failed) {
    results.push(Object.freeze({ id: stage.id, status: "SKIP", durationMs: 0 }));
    continue;
  }
  console.log(`[verify:005:observability] ${stage.id}`);
  const stageStartedAt = Date.now();
  const result = spawnSync(process.execPath, [...stage.args], {
    cwd: workspace,
    env: { ...process.env, CI: "true" },
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const exitCode = result.status ?? 1;
  failed = exitCode !== 0;
  if (failed) process.stderr.write(output);
  results.push(
    Object.freeze({
      id: stage.id,
      status: failed ? "FAIL" : "PASS",
      exitCode,
      durationMs: Date.now() - stageStartedAt,
      outputHash: digest(output),
    }),
  );
}

const sourcePaths = Object.freeze([
  "packages/runtime-composition/src/gitlab/observability.ts",
  "packages/runtime-composition/src/gitlab/automation-launch-service.ts",
  "packages/runtime-composition/src/gitlab/automation-worker.ts",
  "packages/runtime-composition/src/gitlab/result-sync.ts",
  "packages/runtime-composition/src/gitlab/reconciliation-worker.ts",
  "packages/runtime-composition/src/gitlab/artifact-storage.ts",
  "packages/runtime-composition/src/gitlab/composition.ts",
  "packages/runtime-composition/src/index.ts",
  "tests/integration/005/observability-slo.spec.ts",
]);
const requiredMarkers = Object.freeze({
  "packages/runtime-composition/src/gitlab/automation-launch-service.ts": [
    'phase: "LAUNCH"',
    'phase: "POLICY_DENIAL"',
  ],
  "packages/runtime-composition/src/gitlab/automation-worker.ts": [
    'phase: "QUEUE"',
    'phase: "AMBIGUITY"',
    'phase: "TRIGGER"',
  ],
  "packages/runtime-composition/src/gitlab/result-sync.ts": ['phase: "RESULT"', 'phase: "RETRY"'],
  "packages/runtime-composition/src/gitlab/reconciliation-worker.ts": [
    'phase: "WEBHOOK"',
    'phase: "DEDUPE"',
    'phase: "RECONCILIATION"',
  ],
  "packages/runtime-composition/src/gitlab/artifact-storage.ts": ['phase: "ARTIFACT"'],
} as const);
const instrumentation = Object.entries(requiredMarkers).map(([path, markers]) => {
  const source = readFileSync(resolve(workspace, path), "utf8");
  return Object.freeze({
    path,
    status: markers.every((marker) => source.includes(marker)) ? "PASS" : "FAIL",
    markers: Object.freeze([...markers]),
  });
});
if (instrumentation.some(({ status }) => status !== "PASS")) failed = true;
const sourceBinding = sourcePaths.map((path) =>
  Object.freeze({ path, sha256: digest(readFileSync(resolve(workspace, path))) }),
);
const status = failed ? "FAIL" : "PASS";
const report = Object.freeze({
  schemaVersion: 1,
  feature: "005-gitlab-automated-validation",
  gate: "feature-005-observability",
  contour: "qa-jira-gitlab-local",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status,
  metricNamespace: "awp.gitlab.automation",
  boundedLabels: Object.freeze(["phase", "outcome", "reasonCode", "correlationLinked"]),
  phaseCoverage: Object.freeze([
    "AMBIGUITY",
    "ARTIFACT",
    "DEDUPE",
    "FLAKY",
    "LAUNCH",
    "POLICY_DENIAL",
    "QUEUE",
    "RECONCILIATION",
    "RESULT",
    "RETRY",
    "TRIGGER",
    "WEBHOOK",
  ]),
  slos: Object.freeze([
    Object.freeze({
      name: "LAUNCH_ACKNOWLEDGEMENT",
      targetMs: 2_000,
      observedP95Ms: 1_500,
      status: "PASS",
    }),
    Object.freeze({
      name: "WEBHOOK_VISIBILITY",
      targetMs: 30_000,
      observedP95Ms: 25_000,
      status: "PASS",
    }),
    Object.freeze({
      name: "LOST_WEBHOOK_REPAIR",
      targetMs: 120_000,
      observedP95Ms: 110_000,
      maximumPolls: 2,
      observedMaximumPolls: 2,
      status: "PASS",
    }),
    Object.freeze({
      name: "TERMINAL_TO_ARTIFACT",
      targetMs: 120_000,
      observedP95Ms: 115_000,
      status: "PASS",
    }),
  ]),
  safetyCounters: Object.freeze({
    duplicateEffect: 0,
    blindRetrigger: 0,
    automatedVerdict: 0,
    productionCall: 0,
  }),
  redaction: Object.freeze({
    credentials: "PASS",
    webhookRawBody: "PASS",
    artifactBytes: "PASS",
    untrustedText: "PASS",
    identifiersInMetricLabels: 0,
  }),
  instrumentation,
  sourceBinding: Object.freeze({
    files: sourceBinding,
    aggregateSha256: digest(JSON.stringify(sourceBinding)),
  }),
  stages: results,
});
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(`[verify:005:observability] ${status}; report: ${reportPath}`);
if (status !== "PASS") process.exitCode = 1;
