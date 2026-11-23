import type { GitLabMockFault, GitLabMockOperation } from "../state/gitlab.repository.ts";

export const gitLabFoundationScenarioIds = Object.freeze([
  "setup-profile-discovery-dry-run",
  "setup-profile-deploy-denied",
] as const);

export type GitLabFoundationScenarioId = (typeof gitLabFoundationScenarioIds)[number];

export const gitLabUs1ScenarioIds = Object.freeze([
  "us1-automated-session",
  "us1-suite-denied",
  "us1-environment-denied",
  "us1-manual-only",
  "us1-target-change-linked-session",
] as const);

export type GitLabUs1ScenarioId = (typeof gitLabUs1ScenarioIds)[number];

export const gitLabUs2ScenarioIds = Object.freeze([
  "us2-trigger-once",
  "us2-command-replay",
  "us2-stale-confirmation",
  "us2-mismatched-confirmation",
  "us2-timeout-after-trigger",
  "us2-lookup-zero",
  "us2-lookup-multiple",
] as const);

export type GitLabUs2ScenarioId = (typeof gitLabUs2ScenarioIds)[number];

export const gitLabUs3ScenarioIds = Object.freeze([
  "us3-pass-review-required",
  "us3-assertion-failed-no-auto-retry",
  "us3-allowlisted-infra-retry",
  "us3-unknown-infra-no-retry",
  "us3-explicit-rerun-pass-flaky",
  "us3-result-schema-drift",
  "us3-artifact-checksum-mismatch",
  "us3-quarantine-lifecycle",
  "us3-review-packet-proposal-only",
  "us3-post-review-linked-session",
] as const);

export type GitLabUs3ScenarioId = (typeof gitLabUs3ScenarioIds)[number];

export const gitLabUs4ScenarioIds = Object.freeze([
  "us4-lost-webhook-reconciliation",
  "us4-duplicate-webhook",
  "us4-out-of-order-webhook",
  "us4-gitlab-outage-manual-flow",
  "us4-auth-revoked",
  "us4-rate-limit-recovery",
] as const);

export type GitLabUs4ScenarioId = (typeof gitLabUs4ScenarioIds)[number];
export type GitLabScenarioId =
  | GitLabFoundationScenarioId
  | GitLabUs1ScenarioId
  | GitLabUs2ScenarioId
  | GitLabUs3ScenarioId
  | GitLabUs4ScenarioId;

const headSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const changedHeadSha = "cccccccccccccccccccccccccccccccccccccccc";
const parentSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

export interface GitLabTerminalResultFixture {
  readonly terminalKind: "COMPLETED" | "TIMEOUT" | "CANCELLED";
  readonly pipelineStatus: "success" | "failed" | "canceled";
  readonly jobStatus: "success" | "failed" | "canceled";
  readonly outcome:
    "PASS" | "ASSERTION_FAILED" | "INFRA_FAILED" | "TIMEOUT" | "CANCELLED" | "INCOMPLETE";
  readonly terminalAt: string;
  readonly infrastructureCode?: string;
  readonly cancellationReasonCode?: string;
  readonly syntheticReasonCode?: "RESULT_SCHEMA_DRIFT" | "ARTIFACT_CHECKSUM_MISMATCH";
}

export interface GitLabAttemptResultFixture extends GitLabTerminalResultFixture {
  readonly attemptNo: number;
  readonly launchReason: "INITIAL" | "AUTO_INFRA_RETRY" | "HUMAN_RERUN" | "LINKED_SESSION_INITIAL";
  readonly resultSchema: "VALID" | "DRIFTED";
  readonly artifactAvailability: "AVAILABLE" | "CHECKSUM_MISMATCH";
}

export const gitLabDeterministicTerminalFixtures = Object.freeze({
  timeout: Object.freeze({
    terminalKind: "TIMEOUT",
    pipelineStatus: "failed",
    jobStatus: "failed",
    outcome: "TIMEOUT",
    terminalAt: "2026-09-01T07:34:00.000Z",
    infrastructureCode: "JOB_TIMEOUT",
  } satisfies GitLabTerminalResultFixture),
  cancellation: Object.freeze({
    terminalKind: "CANCELLED",
    pipelineStatus: "canceled",
    jobStatus: "canceled",
    outcome: "CANCELLED",
    terminalAt: "2026-09-01T07:34:00.000Z",
    cancellationReasonCode: "PIPELINE_CANCELLED",
  } satisfies GitLabTerminalResultFixture),
});

const attempt = (
  attemptNo: number,
  launchReason: GitLabAttemptResultFixture["launchReason"],
  outcome: GitLabAttemptResultFixture["outcome"],
  overrides: Partial<
    Pick<
      GitLabAttemptResultFixture,
      | "terminalKind"
      | "pipelineStatus"
      | "jobStatus"
      | "infrastructureCode"
      | "cancellationReasonCode"
      | "syntheticReasonCode"
      | "resultSchema"
      | "artifactAvailability"
    >
  > = {},
): GitLabAttemptResultFixture =>
  Object.freeze({
    attemptNo,
    launchReason,
    terminalKind: overrides.terminalKind ?? "COMPLETED",
    pipelineStatus: overrides.pipelineStatus ?? (outcome === "PASS" ? "success" : "failed"),
    jobStatus: overrides.jobStatus ?? (outcome === "PASS" ? "success" : "failed"),
    outcome,
    terminalAt: `2026-09-01T07:${String(32 + attemptNo * 2).padStart(2, "0")}:00.000Z`,
    resultSchema: overrides.resultSchema ?? "VALID",
    artifactAvailability: overrides.artifactAvailability ?? "AVAILABLE",
    ...(overrides.infrastructureCode === undefined
      ? {}
      : { infrastructureCode: overrides.infrastructureCode }),
    ...(overrides.cancellationReasonCode === undefined
      ? {}
      : { cancellationReasonCode: overrides.cancellationReasonCode }),
    ...(overrides.syntheticReasonCode === undefined
      ? {}
      : { syntheticReasonCode: overrides.syntheticReasonCode }),
  });

export interface GitLabDeterministicScenario {
  readonly id: GitLabScenarioId;
  readonly discovery: Readonly<{
    numericProjectId: 5001;
    projectPath: "local/qa-smoke";
    exactRef: "refs/heads/qa/smoke";
    exactVersion: "18.1.0-mock.1";
  }>;
  readonly mergeRequest: Readonly<{ iid: 17; headCommitSha: string; targetRef: "refs/heads/main" }>;
  readonly commit: Readonly<{ sha: string; parentSha: string }>;
  readonly build: Readonly<{
    pipelineId: 101;
    jobId: 1001;
    resultJobKey: string;
    environmentName: string;
  }>;
  readonly ciLint: Readonly<{
    dryRun: true;
    includeJobs: true;
    valid: boolean;
    deploySurface: boolean;
  }>;
  readonly suiteAccess: "ALLOWED" | "DENIED";
  readonly environmentAccess: "ALLOWED" | "DENIED";
  readonly capabilityMode: "FULL_QA" | "MANUAL_ONLY";
  readonly targetChange: "NONE" | "POST_START_LINKED_SESSION";
  readonly triggerFault: Extract<
    GitLabMockFault,
    "NORMAL" | "TIMEOUT_BEFORE_INVOCATION" | "TIMEOUT_AFTER_POSSIBLE_EFFECT"
  >;
  readonly lookupFault: Extract<GitLabMockFault, "NORMAL" | "LOOKUP_ZERO" | "LOOKUP_MULTIPLE">;
  readonly webhookFault: Extract<
    GitLabMockFault,
    "NORMAL" | "WEBHOOK_DROP" | "WEBHOOK_DUPLICATE" | "WEBHOOK_OUT_OF_ORDER"
  >;
  readonly readFault: Extract<
    GitLabMockFault,
    "NORMAL" | "AUTHENTICATION_401" | "PERMISSION_403" | "RATE_LIMIT_429" | "SERVER_500"
  >;
  readonly readFaultRemaining: number;
  readonly expectedTriggerCalls: number;
  readonly attemptResults: readonly GitLabAttemptResultFixture[];
  readonly terminalFixtures: typeof gitLabDeterministicTerminalFixtures;
}

function scenario(
  id: GitLabScenarioId,
  overrides: Partial<
    Pick<
      GitLabDeterministicScenario,
      | "suiteAccess"
      | "environmentAccess"
      | "capabilityMode"
      | "targetChange"
      | "triggerFault"
      | "lookupFault"
      | "webhookFault"
      | "readFault"
      | "readFaultRemaining"
      | "expectedTriggerCalls"
      | "attemptResults"
    >
  > &
    Readonly<{
      headCommitSha?: string;
      resultJobKey?: string;
      environmentName?: string;
      ciLintValid?: boolean;
      deploySurface?: boolean;
    }> = {},
): GitLabDeterministicScenario {
  const selectedHead = overrides.headCommitSha ?? headSha;
  return Object.freeze({
    id,
    discovery: Object.freeze({
      numericProjectId: 5001,
      projectPath: "local/qa-smoke",
      exactRef: "refs/heads/qa/smoke",
      exactVersion: "18.1.0-mock.1",
    }),
    mergeRequest: Object.freeze({
      iid: 17,
      headCommitSha: selectedHead,
      targetRef: "refs/heads/main",
    }),
    commit: Object.freeze({ sha: selectedHead, parentSha }),
    build: Object.freeze({
      pipelineId: 101,
      jobId: 1001,
      resultJobKey: overrides.resultJobKey ?? "awp:result",
      environmentName: overrides.environmentName ?? "qa-1",
    }),
    ciLint: Object.freeze({
      dryRun: true,
      includeJobs: true,
      valid: overrides.ciLintValid ?? true,
      deploySurface: overrides.deploySurface ?? false,
    }),
    suiteAccess: overrides.suiteAccess ?? "ALLOWED",
    environmentAccess: overrides.environmentAccess ?? "ALLOWED",
    capabilityMode: overrides.capabilityMode ?? "FULL_QA",
    targetChange: overrides.targetChange ?? "NONE",
    triggerFault: overrides.triggerFault ?? "NORMAL",
    lookupFault: overrides.lookupFault ?? "NORMAL",
    webhookFault: overrides.webhookFault ?? "NORMAL",
    readFault: overrides.readFault ?? "NORMAL",
    readFaultRemaining: overrides.readFaultRemaining ?? 0,
    expectedTriggerCalls: overrides.expectedTriggerCalls ?? 0,
    attemptResults: Object.freeze([
      ...(overrides.attemptResults ?? [attempt(1, "INITIAL", "PASS")]),
    ]),
    terminalFixtures: gitLabDeterministicTerminalFixtures,
  });
}

export const gitLabScenarioCatalog: Readonly<
  Record<GitLabScenarioId, GitLabDeterministicScenario>
> = Object.freeze({
  "setup-profile-discovery-dry-run": scenario("setup-profile-discovery-dry-run"),
  "setup-profile-deploy-denied": scenario("setup-profile-deploy-denied", {
    resultJobKey: "deploy:production",
    environmentName: "production",
    ciLintValid: false,
    deploySurface: true,
    suiteAccess: "DENIED",
    environmentAccess: "DENIED",
    capabilityMode: "MANUAL_ONLY",
  }),
  "us1-automated-session": scenario("us1-automated-session"),
  "us1-suite-denied": scenario("us1-suite-denied", {
    resultJobKey: "foreign:result",
    suiteAccess: "DENIED",
  }),
  "us1-environment-denied": scenario("us1-environment-denied", {
    environmentName: "qa-foreign",
    environmentAccess: "DENIED",
  }),
  "us1-manual-only": scenario("us1-manual-only", { capabilityMode: "MANUAL_ONLY" }),
  "us1-target-change-linked-session": scenario("us1-target-change-linked-session", {
    headCommitSha: changedHeadSha,
    targetChange: "POST_START_LINKED_SESSION",
  }),
  "us2-trigger-once": scenario("us2-trigger-once", { expectedTriggerCalls: 1 }),
  "us2-command-replay": scenario("us2-command-replay", { expectedTriggerCalls: 1 }),
  "us2-stale-confirmation": scenario("us2-stale-confirmation"),
  "us2-mismatched-confirmation": scenario("us2-mismatched-confirmation"),
  "us2-timeout-after-trigger": scenario("us2-timeout-after-trigger", {
    triggerFault: "TIMEOUT_AFTER_POSSIBLE_EFFECT",
    expectedTriggerCalls: 1,
  }),
  "us2-lookup-zero": scenario("us2-lookup-zero", {
    lookupFault: "LOOKUP_ZERO",
    expectedTriggerCalls: 1,
  }),
  "us2-lookup-multiple": scenario("us2-lookup-multiple", {
    lookupFault: "LOOKUP_MULTIPLE",
    expectedTriggerCalls: 1,
  }),
  "us3-pass-review-required": scenario("us3-pass-review-required", {
    expectedTriggerCalls: 1,
    attemptResults: [attempt(1, "INITIAL", "PASS")],
  }),
  "us3-assertion-failed-no-auto-retry": scenario("us3-assertion-failed-no-auto-retry", {
    expectedTriggerCalls: 1,
    attemptResults: [attempt(1, "INITIAL", "ASSERTION_FAILED")],
  }),
  "us3-allowlisted-infra-retry": scenario("us3-allowlisted-infra-retry", {
    expectedTriggerCalls: 2,
    attemptResults: [
      attempt(1, "INITIAL", "INFRA_FAILED", { infrastructureCode: "RUNNER_LOST" }),
      attempt(2, "AUTO_INFRA_RETRY", "PASS"),
    ],
  }),
  "us3-unknown-infra-no-retry": scenario("us3-unknown-infra-no-retry", {
    expectedTriggerCalls: 1,
    attemptResults: [
      attempt(1, "INITIAL", "INFRA_FAILED", {
        infrastructureCode: "UNCLASSIFIED_PROVIDER_FAILURE",
      }),
    ],
  }),
  "us3-explicit-rerun-pass-flaky": scenario("us3-explicit-rerun-pass-flaky", {
    expectedTriggerCalls: 2,
    attemptResults: [attempt(1, "INITIAL", "ASSERTION_FAILED"), attempt(2, "HUMAN_RERUN", "PASS")],
  }),
  "us3-result-schema-drift": scenario("us3-result-schema-drift", {
    expectedTriggerCalls: 1,
    attemptResults: [
      attempt(1, "INITIAL", "INCOMPLETE", {
        resultSchema: "DRIFTED",
        syntheticReasonCode: "RESULT_SCHEMA_DRIFT",
      }),
    ],
  }),
  "us3-artifact-checksum-mismatch": scenario("us3-artifact-checksum-mismatch", {
    expectedTriggerCalls: 1,
    attemptResults: [
      attempt(1, "INITIAL", "PASS", {
        artifactAvailability: "CHECKSUM_MISMATCH",
        syntheticReasonCode: "ARTIFACT_CHECKSUM_MISMATCH",
      }),
    ],
  }),
  "us3-quarantine-lifecycle": scenario("us3-quarantine-lifecycle", {
    expectedTriggerCalls: 1,
    attemptResults: [
      attempt(1, "INITIAL", "INFRA_FAILED", { infrastructureCode: "RUNNER_CAPACITY" }),
    ],
  }),
  "us3-review-packet-proposal-only": scenario("us3-review-packet-proposal-only", {
    expectedTriggerCalls: 1,
    attemptResults: [attempt(1, "INITIAL", "ASSERTION_FAILED")],
  }),
  "us3-post-review-linked-session": scenario("us3-post-review-linked-session", {
    expectedTriggerCalls: 2,
    targetChange: "POST_START_LINKED_SESSION",
    attemptResults: [attempt(1, "INITIAL", "PASS"), attempt(1, "LINKED_SESSION_INITIAL", "PASS")],
  }),
  "us4-lost-webhook-reconciliation": scenario("us4-lost-webhook-reconciliation", {
    webhookFault: "WEBHOOK_DROP",
  }),
  "us4-duplicate-webhook": scenario("us4-duplicate-webhook", { webhookFault: "WEBHOOK_DUPLICATE" }),
  "us4-out-of-order-webhook": scenario("us4-out-of-order-webhook", {
    webhookFault: "WEBHOOK_OUT_OF_ORDER",
  }),
  "us4-gitlab-outage-manual-flow": scenario("us4-gitlab-outage-manual-flow", {
    readFault: "SERVER_500",
    readFaultRemaining: 1,
  }),
  "us4-auth-revoked": scenario("us4-auth-revoked", {
    readFault: "AUTHENTICATION_401",
    readFaultRemaining: 1,
  }),
  "us4-rate-limit-recovery": scenario("us4-rate-limit-recovery", {
    readFault: "RATE_LIMIT_429",
    readFaultRemaining: 1,
  }),
});

export function parseGitLabFoundationScenarioId(value: unknown): GitLabFoundationScenarioId {
  if (
    typeof value !== "string" ||
    !(gitLabFoundationScenarioIds as readonly string[]).includes(value)
  ) {
    throw new Error("GITLAB_MOCK_SCENARIO_UNKNOWN");
  }
  return value as GitLabFoundationScenarioId;
}

export function parseGitLabScenarioId(value: unknown): GitLabScenarioId {
  if (typeof value !== "string" || !(value in gitLabScenarioCatalog))
    throw new Error("GITLAB_MOCK_SCENARIO_UNKNOWN");
  return value as GitLabScenarioId;
}

export function resolveGitLabScenario(value: unknown): GitLabDeterministicScenario {
  return gitLabScenarioCatalog[parseGitLabScenarioId(value)];
}

const operations = new Set<GitLabMockOperation>([
  "PROJECT_READ",
  "MERGE_REQUEST_READ",
  "COMMIT_READ",
  "BRANCH_READ",
  "CI_LINT",
  "PIPELINE_READ",
  "JOBS_READ",
  "ARTIFACT_READ",
  "PIPELINE_TRIGGER",
  "WEBHOOK_DELIVERY",
]);
const faults = new Set<GitLabMockFault>([
  "NORMAL",
  "TIMEOUT_BEFORE_INVOCATION",
  "TIMEOUT_AFTER_POSSIBLE_EFFECT",
  "AUTHENTICATION_401",
  "PERMISSION_403",
  "RATE_LIMIT_429",
  "SERVER_500",
  "NETWORK_LOSS",
  "LOOKUP_ZERO",
  "LOOKUP_MULTIPLE",
  "WEBHOOK_DROP",
  "WEBHOOK_DUPLICATE",
  "WEBHOOK_OUT_OF_ORDER",
]);

export function parseGitLabMockOperation(value: unknown): GitLabMockOperation {
  if (typeof value !== "string" || !operations.has(value as GitLabMockOperation))
    throw new Error("GITLAB_MOCK_OPERATION_UNKNOWN");
  return value as GitLabMockOperation;
}

export function parseGitLabMockFault(value: unknown): GitLabMockFault {
  if (typeof value !== "string" || !faults.has(value as GitLabMockFault))
    throw new Error("GITLAB_MOCK_FAULT_UNKNOWN");
  return value as GitLabMockFault;
}
