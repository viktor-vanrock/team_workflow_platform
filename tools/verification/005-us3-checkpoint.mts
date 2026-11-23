import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  gitLabUs3ScenarioCatalog,
  type GitLabUs3ScenarioName,
  gitLabUs3ScenarioNames,
  validateGitLabUs3ScenarioCatalog,
} from "../local/gitlab-scenario-catalog.mts";
import { stringifyPortableJson } from "./portable-json.mts";

interface Stage {
  readonly id: string;
  readonly description: string;
  readonly args: readonly string[];
}

const workspace = resolve(import.meta.dirname, "../..");
const reportPath = resolve(workspace, "reports/005-gitlab-automated-validation/us3.json");
const flags = new Set(process.argv.slice(2).filter((value) => value !== "--"));
const unknown = [...flags].filter((flag) => flag !== "--plan");
if (unknown.length > 0) throw new Error(`Unknown Feature 005 US3 arguments: ${unknown.join(", ")}`);

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
    description: "Exactly ten documented US3 scenarios and fixed terminal fixtures are registered",
    args: ["tools/local/gitlab-scenario-catalog.mts", "--check"],
  },
  {
    id: "normalized-result",
    description: "Closed result reducer and real GitLab read/result/artifact conformance",
    args: [
      vitest,
      "run",
      "tests/unit/005/automation-result-reducer.spec.ts",
      "tests/contract/005/us3-gitlab-result-artifact-conformance.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "retry-policy",
    description:
      "Assertion denial, one allowlisted infra successor, explicit rerun and flaky truth table",
    args: [vitest, "run", "tests/unit/005/automation-retry-policy.spec.ts", "--maxWorkers=1"],
  },
  {
    id: "review-readiness",
    description:
      "Complete Attempt-set freeze, shared taxonomy, reviewer policy and HUMAN review race",
    args: [
      vitest,
      "run",
      "tests/unit/005/automation-review-readiness.spec.ts",
      "tests/integration/005/automation-review-readiness.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "result-retry-quarantine",
    description: "Atomic terminal evidence, retry lineage, quarantine revisions and durable outbox",
    args: [
      vitest,
      "run",
      "tests/integration/005/us3-result-retry-review.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "artifact-security",
    description:
      "Scoped checksum-verifying artifact access, expiry and append-only locator revisions",
    args: [
      vitest,
      "run",
      "tests/integration/security/005/artifact-access.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "review-surface",
    description: "Proposal-only Hermes packet and executor review evidence without adjudication",
    args: [
      vitest,
      "run",
      "tests/unit/005/automation-review-packet.spec.ts",
      "tests/unit/005/automated-session-executor-ui.spec.ts",
      "--maxWorkers=1",
    ],
  },
  {
    id: "full-process",
    description:
      "API, result worker and stateful HTTP Mock Hub prove technical execution stops at REVIEW_REQUIRED",
    args: [vitest, "run", "tests/e2e/005-us3-technical-result-review.spec.ts", "--maxWorkers=1"],
  },
  {
    id: "typecheck-connector",
    description: "GitLab result and artifact adapter static typecheck",
    args: [tsc, "-p", "packages/connector-gitlab/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-artifact-store",
    description: "GitLab artifact persistence static typecheck",
    args: [tsc, "-p", "packages/connector-gitlab-persistence-typeorm/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-qa",
    description: "QA result, retry, quarantine, review and executor UI static typecheck",
    args: [tsc, "-p", "packages/competency-qa/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-runtime",
    description: "Result consumer, artifact storage and optional Hermes path static typecheck",
    args: [tsc, "-p", "packages/runtime-composition/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-api",
    description: "Attempt, artifact and quarantine API static typecheck",
    args: [tsc, "-p", "apps/api/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-worker",
    description: "Result synchronization worker static typecheck",
    args: [tsc, "-p", "apps/worker/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-mock-hub",
    description: "Stateful US3 GitLab Mock Hub static typecheck",
    args: [tsc, "-p", "apps/mock-hub/tsconfig.json", "--noEmit"],
  },
  {
    id: "typecheck-web",
    description: "Automated Session result/review route static typecheck",
    args: [tsc, "-p", "apps/web/tsconfig.json", "--noEmit"],
  },
  {
    id: "web-build",
    description: "Production web bundle includes technical result and HUMAN review readiness",
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

validateGitLabUs3ScenarioCatalog();
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
  console.log(`\n[verify:005:us3] ${stage.id}: ${stage.description}`);
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
const behaviorStages: Readonly<Record<GitLabUs3ScenarioName, readonly string[]>> = Object.freeze({
  "us3-pass-review-required": Object.freeze([
    "normalized-result",
    "review-readiness",
    "full-process",
  ]),
  "us3-assertion-failed-no-auto-retry": Object.freeze([
    "normalized-result",
    "retry-policy",
    "full-process",
  ]),
  "us3-allowlisted-infra-retry": Object.freeze([
    "retry-policy",
    "result-retry-quarantine",
    "full-process",
  ]),
  "us3-unknown-infra-no-retry": Object.freeze(["retry-policy", "full-process"]),
  "us3-explicit-rerun-pass-flaky": Object.freeze([
    "retry-policy",
    "review-readiness",
    "full-process",
  ]),
  "us3-result-schema-drift": Object.freeze(["normalized-result", "full-process"]),
  "us3-artifact-checksum-mismatch": Object.freeze([
    "normalized-result",
    "artifact-security",
    "full-process",
  ]),
  "us3-quarantine-lifecycle": Object.freeze(["result-retry-quarantine", "review-readiness"]),
  "us3-review-packet-proposal-only": Object.freeze(["review-surface", "review-readiness"]),
  "us3-post-review-linked-session": Object.freeze(["review-readiness", "full-process"]),
});
const evidenceByStage = Object.freeze({
  "normalized-result": "tests/contract/005/us3-gitlab-result-artifact-conformance.spec.ts",
  "retry-policy": "tests/unit/005/automation-retry-policy.spec.ts",
  "review-readiness": "tests/integration/005/automation-review-readiness.spec.ts",
  "result-retry-quarantine": "tests/integration/005/us3-result-retry-review.spec.ts",
  "artifact-security": "tests/integration/security/005/artifact-access.spec.ts",
  "review-surface": "tests/unit/005/automation-review-packet.spec.ts",
  "full-process": "tests/e2e/005-us3-technical-result-review.spec.ts",
} as const);
const scenarios = gitLabUs3ScenarioNames.map((id) => {
  const expected = gitLabUs3ScenarioCatalog[id];
  const requiredStages = behaviorStages[id];
  const status = passed("scenario-catalog") && requiredStages.every(passed) ? "PASS" : "FAIL";
  return Object.freeze({
    id,
    status,
    expected,
    requiredStages,
    behaviorEvidence: requiredStages.map(
      (stage) => evidenceByStage[stage as keyof typeof evidenceByStage],
    ),
    authorityEvidence: Object.freeze({
      signedVerdicts: 0,
      jiraTransitions: 0,
      terminalBoundary: "REVIEW_REQUIRED",
    }),
  });
});

const assertionGroups = Object.freeze({
  normalizedResult: Object.freeze({
    status: passed("normalized-result") && passed("full-process") ? "PASS" : "FAIL",
    exactOutcomes: Object.freeze([
      "PASS",
      "ASSERTION_FAILED",
      "INFRA_FAILED",
      "TIMEOUT",
      "CANCELLED",
      "INCOMPLETE",
    ]),
    failClosedReasons: Object.freeze([
      "RESULT_SCHEMA_DRIFT",
      "TARGET_MISMATCH",
      "ARTIFACT_CHECKSUM_MISMATCH",
      "RESULT_ARTIFACT_MISSING",
    ]),
    logTextInferenceAllowed: false,
  }),
  retry: Object.freeze({
    status: passed("retry-policy") && passed("result-retry-quarantine") ? "PASS" : "FAIL",
    assertionAutomaticRetry: "DENIED",
    allowlistedInfrastructureSuccessors: 1,
    maximumAutomaticSuccessorsPerLineage: 1,
    successorPersistence: "ATOMIC_WITH_DECISION_COMMAND_EFFECT_OUTBOX",
  }),
  artifact: Object.freeze({
    status: passed("normalized-result") && passed("artifact-security") ? "PASS" : "FAIL",
    availability: Object.freeze(["AVAILABLE", "EXPIRED", "MISSING", "CHECKSUM_MISMATCH"]),
    streamRequiresScopeAuthorization: true,
    checksumVerifiedBeforeDelivery: true,
    rawLocatorExposed: false,
    bytesPersistedInReceipt: false,
  }),
  quarantine: Object.freeze({
    status: passed("result-retry-quarantine") && passed("review-readiness") ? "PASS" : "FAIL",
    revisions: "APPEND_ONLY",
    accountableOwnerReasonExpiry: true,
    originalFailurePreserved: true,
    reviewEffect: "WARNING_NOT_EXCLUSION",
  }),
  review: Object.freeze({
    status:
      passed("review-readiness") && passed("review-surface") && passed("full-process")
        ? "PASS"
        : "FAIL",
    completeAttemptSetCasRequired: true,
    technicalTerminalState: "REVIEW_REQUIRED",
    humanAdjudicationRequired: true,
    automaticVerdictSignatures: 0,
    automaticJiraTransitions: 0,
    hermesPacketAuthority: "PROPOSAL_ONLY",
  }),
});

const sourcePaths = Object.freeze([
  "apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts",
  "apps/api/src/extensions/gitlab-automation/qa-automation-quarantines.controller.ts",
  "apps/mock-hub/src/gitlab/scenarios/gitlab-scenarios.ts",
  "apps/mock-hub/src/gitlab/state/gitlab.repository.ts",
  "packages/competency-qa/src/application/automation-quarantine.ts",
  "packages/competency-qa/src/application/automation-retry-policy.ts",
  "packages/competency-qa/src/application/automation-review-readiness.ts",
  "packages/competency-qa/src/application/sync-automation-result.ts",
  "packages/competency-qa/src/persistence/result-evidence.uow.ts",
  "packages/competency-qa/src/skills/qa-result-review-prep.ts",
  "packages/competency-qa/src/ui/automated-session-executor.tsx",
  "packages/connector-gitlab/src/artifacts/gitlab-ci-artifacts.ts",
  "packages/connector-gitlab/src/pipeline/gitlab-pipeline-reader.ts",
  "packages/connector-gitlab/src/pipeline/gitlab-result-normalizer.ts",
  "packages/connector-gitlab-persistence-typeorm/src/repositories/gitlab-artifact.repository.ts",
  "packages/runtime-composition/src/gitlab/artifact-storage.ts",
  "packages/runtime-composition/src/gitlab/automation-attempt-query.ts",
  "packages/runtime-composition/src/gitlab/result-sync.ts",
  "packages/runtime-composition/src/hermes/qa-automation-review-packet.ts",
  "tests/e2e/005-us3-technical-result-review.spec.ts",
  "tests/integration/005/us3-result-retry-review.spec.ts",
  "tests/integration/security/005/artifact-access.spec.ts",
  "tools/local/gitlab-scenario-catalog.mts",
]);
const sourceBinding = sourcePaths.map((path) =>
  Object.freeze({ path, sha256: digest(readFileSync(resolve(workspace, path))) }),
);
const status =
  !failed &&
  scenarios.every((scenario) => scenario.status === "PASS") &&
  Object.values(assertionGroups).every((group) => group.status === "PASS")
    ? "PASS"
    : "FAIL";
const report = Object.freeze({
  schemaVersion: 1,
  feature: "005-gitlab-automated-validation",
  gate: "feature-005-us3",
  contour: "qa-jira-gitlab-local",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  status,
  sourceBinding: Object.freeze({
    files: sourceBinding,
    aggregateSha256: digest(JSON.stringify(sourceBinding)),
  }),
  scenarios,
  assertions: assertionGroups,
  invariants: Object.freeze({
    technicalEvidenceIsVerdict: false,
    terminalSessionState: "REVIEW_REQUIRED",
    automaticVerdictSignatures: 0,
    automaticJiraTransitions: 0,
    retryPolicyOwner: "QA",
    resultAuthority: "SCHEMA_VALIDATED_MACHINE_ARTIFACT",
    reviewAuthority: "HUMAN_ONLY",
  }),
  stages: results,
});
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
console.log(
  `[verify:005:us3] ${status}; ${scenarios.filter((scenario) => scenario.status === "PASS").length}/10 scenarios; report: ${reportPath}`,
);
if (status !== "PASS") process.exitCode = 1;
