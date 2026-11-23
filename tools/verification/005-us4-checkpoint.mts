import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  gitLabUs4ScenarioCatalog,
  type GitLabUs4ScenarioName,
  gitLabUs4ScenarioNames,
  validateGitLabUs4ScenarioCatalog,
} from "../local/gitlab-scenario-catalog.mts";
import { stringifyPortableJson } from "./portable-json.mts";

interface Stage {
  readonly id: string;
  readonly description: string;
  readonly args: readonly string[];
}

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/005-gitlab-automated-validation/us4.json");
const flags = new Set(process.argv.slice(2).filter((value) => value !== "--"));
const unknown = [...flags].filter((flag) => flag !== "--plan");
if (unknown.length > 0) throw new Error(`Unknown Feature 005 US4 arguments: ${unknown.join(", ")}`);

const vitest = "node_modules/vitest/vitest.mjs";
const tsc = "node_modules/typescript/bin/tsc";
const stages: readonly Stage[] = Object.freeze([
  {
    id: "foundation",
    description: "Current Feature 005 foundation remains green",
    args: ["tools/verification/005-foundation-checkpoint.mts"],
  },
  {
    id: "scenario-catalog",
    description: "Exactly six documented US4 scenarios and persisted fault plans are registered",
    args: ["tools/local/gitlab-scenario-catalog.mts", "--check"],
  },
  {
    id: "webhook-verifier",
    description: "Exact raw-byte HMAC, freshness, replay, size and numeric-project checks",
    args: [vitest, "run", "tests/unit/005/gitlab-webhook-verifier.spec.ts", "--maxWorkers=1"],
  },
  {
    id: "mock-hub",
    description:
      "Signed lost/duplicate/out-of-order delivery and durable one-shot 401/403/429/500 faults",
    args: [vitest, "run", "tests/integration/005/mock-hub-gitlab.spec.ts", "--maxWorkers=1"],
  },
  {
    id: "reconciliation",
    description:
      "Monotonic observation heads, fenced restart-safe cursors and bounded backoff snapshots",
    args: [
      vitest,
      "run",
      "tests/integration/005/us4-outage-reconciliation.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "webhook-security",
    description: "Durable dedupe plus quarantine of changed-body and cross-scope attacks",
    args: [
      vitest,
      "run",
      "tests/integration/security/005/webhook-ingress.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "full-process",
    description:
      "Real adapter/Mock Hub outage recovery with visible state and uninterrupted manual QA",
    args: [vitest, "run", "tests/e2e/005-us4-outage-recovery.spec.ts", "--maxWorkers=1"],
  },
  {
    id: "typecheck-connector",
    description: "GitLab webhook/read/backoff adapter static typecheck",
    args: [tsc, "-p", "packages/connector-gitlab/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-effect-store",
    description: "GitLab receipt/reconciliation persistence static typecheck",
    args: [tsc, "-p", "packages/connector-gitlab-persistence-typeorm/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-qa",
    description: "Automation health and manual-continuity UI static typecheck",
    args: [tsc, "-p", "packages/competency-qa/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-runtime",
    description: "Ingress, reconciliation worker and operational health static typecheck",
    args: [tsc, "-p", "packages/runtime-composition/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-api",
    description: "Operational health API static typecheck",
    args: [tsc, "-p", "apps/api/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-worker",
    description: "Reconciliation worker process static typecheck",
    args: [tsc, "-p", "apps/worker/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-mock-hub",
    description: "Stateful US4 GitLab Mock Hub static typecheck",
    args: [tsc, "-p", "apps/mock-hub/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-web",
    description: "Pending/error and manual-continuity route static typecheck",
    args: [tsc, "-p", "apps/web/tsconfig.json", "--noEmit"],
  },
  {
    id: "web-build",
    description: "Production web bundle includes operational health and manual fallback",
    args: ["node_modules/vite/bin/vite.js", "build", "--config", "apps/web/vite.config.ts"],
  },
]);

if (flags.has("--plan")) {
  console.table(
    stages.map(({ id, description, args }) => ({
      id,
      description,
      command: [process.execPath, ...args].join(" "),
    })),
  );
  process.exit(0);
}

validateGitLabUs4ScenarioCatalog();
const digest = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const startedAt = new Date();
const results: Array<
  Readonly<{
    id: string;
    description: string;
    status: "PASS" | "FAIL" | "SKIP";
    exitCode?: number;
    durationMs: number;
    outputHash?: `sha256:${string}`;
  }>
> = [];
let failed = false;
for (const stage of stages) {
  if (failed) {
    results.push(
      Object.freeze({
        id: stage.id,
        description: stage.description,
        status: "SKIP",
        durationMs: 0,
      }),
    );
    continue;
  }
  console.log(`\n[verify:005:us4] ${stage.id}: ${stage.description}`);
  const started = Date.now();
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
      description: stage.description,
      status: failed ? "FAIL" : "PASS",
      exitCode,
      durationMs: Date.now() - started,
      outputHash: digest(output),
    }),
  );
}

const passed = (id: string) => results.find((stage) => stage.id === id)?.status === "PASS";
const behaviorStages: Readonly<Record<GitLabUs4ScenarioName, readonly string[]>> = Object.freeze({
  "us4-lost-webhook-reconciliation": Object.freeze(["mock-hub", "reconciliation", "full-process"]),
  "us4-duplicate-webhook": Object.freeze(["mock-hub", "webhook-security", "reconciliation"]),
  "us4-out-of-order-webhook": Object.freeze(["mock-hub", "reconciliation"]),
  "us4-gitlab-outage-manual-flow": Object.freeze(["mock-hub", "reconciliation", "full-process"]),
  "us4-auth-revoked": Object.freeze(["mock-hub", "full-process"]),
  "us4-rate-limit-recovery": Object.freeze(["mock-hub", "reconciliation", "full-process"]),
});
const evidenceByStage = Object.freeze({
  "mock-hub": "tests/integration/005/mock-hub-gitlab.spec.ts",
  reconciliation: "tests/integration/005/us4-outage-reconciliation.spec.ts",
  "webhook-security": "tests/integration/security/005/webhook-ingress.spec.ts",
  "full-process": "tests/e2e/005-us4-outage-recovery.spec.ts",
} as const);
const scenarios = gitLabUs4ScenarioNames.map((id) => {
  const requiredStages = behaviorStages[id];
  return Object.freeze({
    id,
    status: passed("scenario-catalog") && requiredStages.every(passed) ? "PASS" : "FAIL",
    expected: gitLabUs4ScenarioCatalog[id],
    requiredStages,
    behaviorEvidence: requiredStages.map(
      (stage) => evidenceByStage[stage as keyof typeof evidenceByStage],
    ),
    authorityEvidence: Object.freeze({
      automaticSignedVerdicts: 0,
      automaticJiraTransitions: 0,
      manualFlowPreserved: true,
    }),
  });
});

const assertions = Object.freeze({
  webhook: Object.freeze({
    status:
      passed("webhook-verifier") && passed("mock-hub") && passed("webhook-security")
        ? "PASS"
        : "FAIL",
    signatureDialect: "STANDARD_WEBHOOKS_HMAC_SHA256",
    exactRawBytes: true,
    duplicateEffectMaximum: 1,
    changedBodyAction: "SECURITY_CONFLICT",
    crossProjectAction: "REJECT",
  }),
  convergence: Object.freeze({
    status: passed("reconciliation") && passed("full-process") ? "PASS" : "FAIL",
    webhookAuthority: "HINT_ONLY",
    canonicalAuthority: "AUTHORITATIVE_REST_READ",
    lostWebhookRepair: "BOUNDED_RECONCILIATION",
    projectionRule: "MONOTONIC_HEAD_WITH_APPEND_ONLY_HISTORY",
    durableCursorFencing: true,
  }),
  degradation: Object.freeze({
    status:
      passed("mock-hub") && passed("reconciliation") && passed("full-process") ? "PASS" : "FAIL",
    authFailure: "CLOSED_NO_RETRY",
    rateAndServerFailure: "BOUNDED_BACKOFF",
    retryAfterSeconds: 11,
    pendingErrorVisible: true,
    manualSessionAndJiraIndependent: true,
  }),
  restart: Object.freeze({
    status: passed("mock-hub") && passed("reconciliation") ? "PASS" : "FAIL",
    mockHubFaultsPersisted: true,
    reconciliationCursorPersisted: true,
    deliveryAuthority: "POSTGRESQL",
  }),
});

const sourcePaths = Object.freeze([
  "apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts",
  "apps/mock-hub/src/gitlab/api/gitlab.controller.ts",
  "apps/mock-hub/src/gitlab/control/gitlab-control.controller.ts",
  "apps/mock-hub/src/gitlab/scenarios/gitlab-scenarios.ts",
  "apps/mock-hub/src/gitlab/state/gitlab.repository.ts",
  "apps/mock-hub/src/gitlab/webhooks/gitlab-webhook-emitter.ts",
  "apps/web/src/routes/qa/automated-session.tsx",
  "packages/competency-qa/src/ui/automated-session-executor.tsx",
  "packages/connector-gitlab/src/reconciliation/gitlab-rate-health.ts",
  "packages/connector-gitlab/src/webhooks/gitlab-webhook-normalizer.ts",
  "packages/connector-gitlab-persistence-typeorm/src/repositories/gitlab-reconciliation.repository.ts",
  "packages/runtime-composition/src/gitlab/operational-health.ts",
  "packages/runtime-composition/src/gitlab/reconciliation-worker.ts",
  "tests/e2e/005-us4-outage-recovery.spec.ts",
  "tests/integration/005/mock-hub-gitlab.spec.ts",
  "tests/integration/005/us4-outage-reconciliation.spec.ts",
  "tests/integration/security/005/webhook-ingress.spec.ts",
  "tools/local/gitlab-scenario-catalog.mts",
]);
const sourceBinding = sourcePaths.map((path) =>
  Object.freeze({ path, sha256: digest(readFileSync(resolve(workspace, path))) }),
);
const status =
  !failed &&
  scenarios.every((scenario) => scenario.status === "PASS") &&
  Object.values(assertions).every((group) => group.status === "PASS")
    ? "PASS"
    : "FAIL";
const report = Object.freeze({
  schemaVersion: 1,
  feature: "005-gitlab-automated-validation",
  gate: "feature-005-us4",
  contour: "qa-jira-gitlab-local",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status,
  sourceBinding: Object.freeze({
    files: sourceBinding,
    aggregateSha256: digest(JSON.stringify(sourceBinding)),
  }),
  scenarios,
  assertions,
  invariants: Object.freeze({
    webhookIsCanonicalAuthority: false,
    automaticVerdictSignatures: 0,
    automaticJiraTransitions: 0,
    manualQaAvailableDuringGitLabOutage: true,
    recoveryMayCloseJiraWorkItem: false,
    recoveryMaySignQaVerdict: false,
  }),
  stages: results,
});
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(
  `[verify:005:us4] ${status}; ${scenarios.filter((scenario) => scenario.status === "PASS").length}/6 scenarios; report: ${reportPath}`,
);
if (status !== "PASS") process.exitCode = 1;
