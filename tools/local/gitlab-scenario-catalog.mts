import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { gitLabScenarioCatalog as gitLabMockScenarioCatalog } from "../../apps/mock-hub/src/gitlab/scenarios/gitlab-scenarios.ts";
import { stringifyPortableJson } from "../verification/portable-json.mts";

export const gitLabFoundationScenarioCatalog = Object.freeze({
  "setup-profile-discovery-dry-run": Object.freeze({
    scenarioId: "setup-profile-discovery-dry-run",
    expectedDiscovery: "BOUNDED_READ_ONLY",
    expectedDryRun: true,
    expectedDeploySurface: false,
    expectedTriggerCalls: 0,
  }),
  "setup-profile-deploy-denied": Object.freeze({
    scenarioId: "setup-profile-deploy-denied",
    expectedDiscovery: "DENIED",
    expectedDryRun: true,
    expectedDeploySurface: true,
    expectedTriggerCalls: 0,
  }),
} as const);

export type GitLabFoundationScenarioName = keyof typeof gitLabFoundationScenarioCatalog;
export const gitLabFoundationScenarioNames = Object.freeze(
  Object.keys(gitLabFoundationScenarioCatalog) as GitLabFoundationScenarioName[],
);

export const gitLabUs1ScenarioCatalog = Object.freeze({
  "us1-automated-session": Object.freeze({
    scenarioId: "us1-automated-session",
    expectedCapabilityMode: "FULL_QA",
    expectedAutomatedSessions: 1,
    expectedLinkedSessions: 0,
    expectedDenial: null,
    manualFlowPreserved: true,
    expectedTriggerCalls: 0,
  }),
  "us1-suite-denied": Object.freeze({
    scenarioId: "us1-suite-denied",
    expectedCapabilityMode: "FULL_QA",
    expectedAutomatedSessions: 0,
    expectedLinkedSessions: 0,
    expectedDenial: "SUITE_ALLOWLIST",
    manualFlowPreserved: true,
    expectedTriggerCalls: 0,
  }),
  "us1-environment-denied": Object.freeze({
    scenarioId: "us1-environment-denied",
    expectedCapabilityMode: "FULL_QA",
    expectedAutomatedSessions: 0,
    expectedLinkedSessions: 0,
    expectedDenial: "ENVIRONMENT_ALLOWLIST",
    manualFlowPreserved: true,
    expectedTriggerCalls: 0,
  }),
  "us1-manual-only": Object.freeze({
    scenarioId: "us1-manual-only",
    expectedCapabilityMode: "MANUAL_ONLY",
    expectedAutomatedSessions: 0,
    expectedLinkedSessions: 0,
    expectedDenial: "NO_PUBLISHED_SUITE",
    manualFlowPreserved: true,
    expectedTriggerCalls: 0,
  }),
  "us1-target-change-linked-session": Object.freeze({
    scenarioId: "us1-target-change-linked-session",
    expectedCapabilityMode: "FULL_QA",
    expectedAutomatedSessions: 2,
    expectedLinkedSessions: 1,
    expectedDenial: null,
    manualFlowPreserved: true,
    expectedTriggerCalls: 0,
  }),
} as const);

export type GitLabUs1ScenarioName = keyof typeof gitLabUs1ScenarioCatalog;
export const gitLabUs1ScenarioNames = Object.freeze(
  Object.keys(gitLabUs1ScenarioCatalog) as GitLabUs1ScenarioName[],
);

export function validateGitLabUs1ScenarioCatalog(): void {
  if (gitLabUs1ScenarioNames.length !== 5 || new Set(gitLabUs1ScenarioNames).size !== 5)
    throw new Error("GITLAB_US1_SCENARIO_CATALOG_CARDINALITY_INVALID");
  for (const [name, scenario] of Object.entries(gitLabUs1ScenarioCatalog)) {
    if (
      scenario.scenarioId !== name ||
      scenario.expectedTriggerCalls !== 0 ||
      !scenario.manualFlowPreserved
    )
      throw new Error(`GITLAB_US1_SCENARIO_CATALOG_INVALID:${name}`);
  }
}

export const gitLabUs2ScenarioCatalog = Object.freeze({
  "us2-trigger-once": Object.freeze({
    scenarioId: "us2-trigger-once",
    expectedLaunchAccepted: true,
    expectedRequestClaims: 1,
    expectedEffects: 1,
    expectedTriggerCalls: 1,
    expectedProviderPipelines: 1,
    expectedResolution: "CONFIRMED",
  }),
  "us2-command-replay": Object.freeze({
    scenarioId: "us2-command-replay",
    expectedLaunchAccepted: true,
    expectedRequestClaims: 1,
    expectedEffects: 1,
    expectedTriggerCalls: 1,
    expectedProviderPipelines: 1,
    expectedResolution: "CONFIRMED",
  }),
  "us2-stale-confirmation": Object.freeze({
    scenarioId: "us2-stale-confirmation",
    expectedLaunchAccepted: false,
    expectedRequestClaims: 0,
    expectedEffects: 0,
    expectedTriggerCalls: 0,
    expectedProviderPipelines: 0,
    expectedResolution: "REJECTED",
  }),
  "us2-mismatched-confirmation": Object.freeze({
    scenarioId: "us2-mismatched-confirmation",
    expectedLaunchAccepted: false,
    expectedRequestClaims: 0,
    expectedEffects: 0,
    expectedTriggerCalls: 0,
    expectedProviderPipelines: 0,
    expectedResolution: "REJECTED",
  }),
  "us2-timeout-after-trigger": Object.freeze({
    scenarioId: "us2-timeout-after-trigger",
    expectedLaunchAccepted: true,
    expectedRequestClaims: 1,
    expectedEffects: 1,
    expectedTriggerCalls: 1,
    expectedProviderPipelines: 1,
    expectedResolution: "CONFIRMED_BY_LOOKUP",
  }),
  "us2-lookup-zero": Object.freeze({
    scenarioId: "us2-lookup-zero",
    expectedLaunchAccepted: true,
    expectedRequestClaims: 1,
    expectedEffects: 1,
    expectedTriggerCalls: 1,
    expectedProviderPipelines: 1,
    expectedResolution: "BOUNDED_AMBIGUITY",
  }),
  "us2-lookup-multiple": Object.freeze({
    scenarioId: "us2-lookup-multiple",
    expectedLaunchAccepted: true,
    expectedRequestClaims: 1,
    expectedEffects: 1,
    expectedTriggerCalls: 1,
    expectedProviderPipelines: 1,
    expectedResolution: "BOUNDED_AMBIGUITY",
  }),
} as const);

export type GitLabUs2ScenarioName = keyof typeof gitLabUs2ScenarioCatalog;
export const gitLabUs2ScenarioNames = Object.freeze(
  Object.keys(gitLabUs2ScenarioCatalog) as GitLabUs2ScenarioName[],
);

export function validateGitLabUs2ScenarioCatalog(): void {
  if (gitLabUs2ScenarioNames.length !== 7 || new Set(gitLabUs2ScenarioNames).size !== 7)
    throw new Error("GITLAB_US2_SCENARIO_CATALOG_CARDINALITY_INVALID");
  for (const [name, scenario] of Object.entries(gitLabUs2ScenarioCatalog)) {
    if (scenario.scenarioId !== name)
      throw new Error(`GITLAB_US2_SCENARIO_CATALOG_INVALID:${name}`);
    if (
      scenario.expectedLaunchAccepted &&
      (scenario.expectedRequestClaims !== 1 || scenario.expectedEffects !== 1)
    )
      throw new Error(`GITLAB_US2_ACCEPTED_SCENARIO_COUNTS_INVALID:${name}`);
    if (
      !scenario.expectedLaunchAccepted &&
      (scenario.expectedRequestClaims !== 0 ||
        scenario.expectedEffects !== 0 ||
        scenario.expectedTriggerCalls !== 0)
    )
      throw new Error(`GITLAB_US2_REJECTED_SCENARIO_COUNTS_INVALID:${name}`);
    if (scenario.expectedTriggerCalls > 1 || scenario.expectedProviderPipelines > 1)
      throw new Error(`GITLAB_US2_EXACTLY_ONCE_INVALID:${name}`);
  }
}

export const gitLabUs3TerminalFixtures = Object.freeze({
  timeout: Object.freeze({
    pipelineStatus: "failed",
    jobStatus: "failed",
    outcome: "TIMEOUT",
    infrastructureCode: "JOB_TIMEOUT",
    terminalAt: "2026-09-01T07:34:00.000Z",
    expectedRetryDecision: "NOT_APPLICABLE",
  }),
  cancellation: Object.freeze({
    pipelineStatus: "canceled",
    jobStatus: "canceled",
    outcome: "CANCELLED",
    cancellationReasonCode: "PIPELINE_CANCELLED",
    terminalAt: "2026-09-01T07:34:00.000Z",
    expectedRetryDecision: "NOT_APPLICABLE",
  }),
} as const);

const us3 = <T extends Readonly<Record<string, unknown>>>(scenarioId: string, value: T) =>
  Object.freeze({
    scenarioId,
    expectedReviewState: "REVIEW_REQUIRED" as const,
    expectedSignedVerdicts: 0 as const,
    expectedJiraTransitions: 0 as const,
    ...value,
  });

export const gitLabUs3ScenarioCatalog = Object.freeze({
  "us3-pass-review-required": us3("us3-pass-review-required", {
    expectedOutcomes: Object.freeze(["PASS"]),
    expectedRetryDecision: "NOT_APPLICABLE",
    expectedAutomaticSuccessors: 0,
    expectedFlakySuspected: false,
    expectedArtifactAvailability: "AVAILABLE",
    expectedQuarantineRevisions: 0,
    expectedHermes: "NOT_REQUESTED",
    expectedLinkedSessions: 0,
  }),
  "us3-assertion-failed-no-auto-retry": us3("us3-assertion-failed-no-auto-retry", {
    expectedOutcomes: Object.freeze(["ASSERTION_FAILED"]),
    expectedRetryDecision: "NOT_APPLICABLE",
    expectedAutomaticSuccessors: 0,
    expectedFlakySuspected: false,
    expectedArtifactAvailability: "AVAILABLE",
    expectedQuarantineRevisions: 0,
    expectedHermes: "NOT_REQUESTED",
    expectedLinkedSessions: 0,
  }),
  "us3-allowlisted-infra-retry": us3("us3-allowlisted-infra-retry", {
    expectedOutcomes: Object.freeze(["INFRA_FAILED", "PASS"]),
    expectedRetryDecision: "SCHEDULED",
    expectedAutomaticSuccessors: 1,
    expectedFlakySuspected: false,
    expectedArtifactAvailability: "AVAILABLE",
    expectedQuarantineRevisions: 0,
    expectedHermes: "NOT_REQUESTED",
    expectedLinkedSessions: 0,
  }),
  "us3-unknown-infra-no-retry": us3("us3-unknown-infra-no-retry", {
    expectedOutcomes: Object.freeze(["INFRA_FAILED"]),
    expectedRetryDecision: "NOT_APPLICABLE",
    expectedAutomaticSuccessors: 0,
    expectedFlakySuspected: false,
    expectedArtifactAvailability: "AVAILABLE",
    expectedQuarantineRevisions: 0,
    expectedHermes: "NOT_REQUESTED",
    expectedLinkedSessions: 0,
  }),
  "us3-explicit-rerun-pass-flaky": us3("us3-explicit-rerun-pass-flaky", {
    expectedOutcomes: Object.freeze(["ASSERTION_FAILED", "PASS"]),
    expectedRetryDecision: "NOT_APPLICABLE",
    expectedAutomaticSuccessors: 0,
    expectedFlakySuspected: true,
    expectedArtifactAvailability: "AVAILABLE",
    expectedQuarantineRevisions: 0,
    expectedHermes: "NOT_REQUESTED",
    expectedLinkedSessions: 0,
  }),
  "us3-result-schema-drift": us3("us3-result-schema-drift", {
    expectedOutcomes: Object.freeze(["INCOMPLETE"]),
    expectedRetryDecision: "NOT_APPLICABLE",
    expectedAutomaticSuccessors: 0,
    expectedFlakySuspected: false,
    expectedArtifactAvailability: "AVAILABLE",
    expectedQuarantineRevisions: 0,
    expectedHermes: "NOT_REQUESTED",
    expectedLinkedSessions: 0,
  }),
  "us3-artifact-checksum-mismatch": us3("us3-artifact-checksum-mismatch", {
    expectedOutcomes: Object.freeze(["PASS"]),
    expectedRetryDecision: "NOT_APPLICABLE",
    expectedAutomaticSuccessors: 0,
    expectedFlakySuspected: false,
    expectedArtifactAvailability: "CHECKSUM_MISMATCH",
    expectedQuarantineRevisions: 0,
    expectedHermes: "NOT_REQUESTED",
    expectedLinkedSessions: 0,
  }),
  "us3-quarantine-lifecycle": us3("us3-quarantine-lifecycle", {
    expectedOutcomes: Object.freeze(["INFRA_FAILED"]),
    expectedRetryDecision: "DENIED",
    expectedAutomaticSuccessors: 0,
    expectedFlakySuspected: false,
    expectedArtifactAvailability: "AVAILABLE",
    expectedQuarantineRevisions: 2,
    expectedHermes: "NOT_REQUESTED",
    expectedLinkedSessions: 0,
  }),
  "us3-review-packet-proposal-only": us3("us3-review-packet-proposal-only", {
    expectedOutcomes: Object.freeze(["ASSERTION_FAILED"]),
    expectedRetryDecision: "NOT_APPLICABLE",
    expectedAutomaticSuccessors: 0,
    expectedFlakySuspected: false,
    expectedArtifactAvailability: "AVAILABLE",
    expectedQuarantineRevisions: 0,
    expectedHermes: "PROPOSAL_ONLY",
    expectedLinkedSessions: 0,
  }),
  "us3-post-review-linked-session": us3("us3-post-review-linked-session", {
    expectedOutcomes: Object.freeze(["PASS", "PASS"]),
    expectedRetryDecision: "NOT_APPLICABLE",
    expectedAutomaticSuccessors: 0,
    expectedFlakySuspected: false,
    expectedArtifactAvailability: "AVAILABLE",
    expectedQuarantineRevisions: 0,
    expectedHermes: "NOT_REQUESTED",
    expectedLinkedSessions: 1,
  }),
} as const);

export type GitLabUs3ScenarioName = keyof typeof gitLabUs3ScenarioCatalog;
export const gitLabUs3ScenarioNames = Object.freeze(
  Object.keys(gitLabUs3ScenarioCatalog) as GitLabUs3ScenarioName[],
);

export function validateGitLabUs3ScenarioCatalog(): void {
  if (gitLabUs3ScenarioNames.length !== 10 || new Set(gitLabUs3ScenarioNames).size !== 10)
    throw new Error("GITLAB_US3_SCENARIO_CATALOG_CARDINALITY_INVALID");
  if (
    gitLabUs3TerminalFixtures.timeout.outcome !== "TIMEOUT" ||
    gitLabUs3TerminalFixtures.cancellation.outcome !== "CANCELLED"
  )
    throw new Error("GITLAB_US3_TERMINAL_FIXTURES_INVALID");
  for (const [name, scenario] of Object.entries(gitLabUs3ScenarioCatalog)) {
    if (scenario.scenarioId !== name || scenario.expectedReviewState !== "REVIEW_REQUIRED")
      throw new Error(`GITLAB_US3_SCENARIO_CATALOG_INVALID:${name}`);
    if (scenario.expectedSignedVerdicts !== 0 || scenario.expectedJiraTransitions !== 0)
      throw new Error(`GITLAB_US3_HUMAN_AUTHORITY_INVALID:${name}`);
    if (scenario.expectedAutomaticSuccessors > 1)
      throw new Error(`GITLAB_US3_RETRY_BUDGET_INVALID:${name}`);
  }
  if (gitLabUs3ScenarioCatalog["us3-allowlisted-infra-retry"].expectedAutomaticSuccessors !== 1)
    throw new Error("GITLAB_US3_ALLOWLISTED_RETRY_INVALID");
  if (!gitLabUs3ScenarioCatalog["us3-explicit-rerun-pass-flaky"].expectedFlakySuspected)
    throw new Error("GITLAB_US3_FLAKY_SCENARIO_INVALID");
  if (
    gitLabUs3ScenarioCatalog["us3-review-packet-proposal-only"].expectedHermes !== "PROPOSAL_ONLY"
  )
    throw new Error("GITLAB_US3_HERMES_SCENARIO_INVALID");
}

const us4 = <T extends Readonly<Record<string, unknown>>>(scenarioId: string, value: T) =>
  Object.freeze({
    scenarioId,
    expectedSignedVerdicts: 0 as const,
    expectedJiraTransitions: 0 as const,
    manualFlowPreserved: true as const,
    ...value,
  });

export const gitLabUs4ScenarioCatalog = Object.freeze({
  "us4-lost-webhook-reconciliation": us4("us4-lost-webhook-reconciliation", {
    expectedWebhookFault: "WEBHOOK_DROP",
    expectedDeliveryAttempts: 0,
    expectedAuthoritativeRecovery: "BOUNDED_RECONCILIATION",
    expectedReadFault: "NORMAL",
    expectedConnectionHealth: "HEALTHY",
  }),
  "us4-duplicate-webhook": us4("us4-duplicate-webhook", {
    expectedWebhookFault: "WEBHOOK_DUPLICATE",
    expectedDeliveryAttempts: 2,
    expectedAuthoritativeRecovery: "ONE_EFFECT",
    expectedReadFault: "NORMAL",
    expectedConnectionHealth: "HEALTHY",
  }),
  "us4-out-of-order-webhook": us4("us4-out-of-order-webhook", {
    expectedWebhookFault: "WEBHOOK_OUT_OF_ORDER",
    expectedDeliveryAttempts: 2,
    expectedAuthoritativeRecovery: "MONOTONIC_HEAD",
    expectedReadFault: "NORMAL",
    expectedConnectionHealth: "HEALTHY",
  }),
  "us4-gitlab-outage-manual-flow": us4("us4-gitlab-outage-manual-flow", {
    expectedWebhookFault: "NORMAL",
    expectedDeliveryAttempts: 1,
    expectedAuthoritativeRecovery: "BOUNDED_RECONCILIATION",
    expectedReadFault: "SERVER_500",
    expectedConnectionHealth: "BACKOFF",
  }),
  "us4-auth-revoked": us4("us4-auth-revoked", {
    expectedWebhookFault: "NORMAL",
    expectedDeliveryAttempts: 1,
    expectedAuthoritativeRecovery: "RETRY_STOPPED",
    expectedReadFault: "AUTHENTICATION_401",
    expectedConnectionHealth: "AUTH_DEGRADED",
  }),
  "us4-rate-limit-recovery": us4("us4-rate-limit-recovery", {
    expectedWebhookFault: "NORMAL",
    expectedDeliveryAttempts: 1,
    expectedAuthoritativeRecovery: "RETRY_AFTER_11_SECONDS",
    expectedReadFault: "RATE_LIMIT_429",
    expectedConnectionHealth: "BACKOFF",
  }),
} as const);

export type GitLabUs4ScenarioName = keyof typeof gitLabUs4ScenarioCatalog;
export const gitLabUs4ScenarioNames = Object.freeze(
  Object.keys(gitLabUs4ScenarioCatalog) as GitLabUs4ScenarioName[],
);

export function validateGitLabUs4ScenarioCatalog(): void {
  if (gitLabUs4ScenarioNames.length !== 6 || new Set(gitLabUs4ScenarioNames).size !== 6)
    throw new Error("GITLAB_US4_SCENARIO_CATALOG_CARDINALITY_INVALID");
  for (const [name, scenario] of Object.entries(gitLabUs4ScenarioCatalog)) {
    if (scenario.scenarioId !== name || !scenario.manualFlowPreserved)
      throw new Error(`GITLAB_US4_SCENARIO_CATALOG_INVALID:${name}`);
    if (scenario.expectedSignedVerdicts !== 0 || scenario.expectedJiraTransitions !== 0)
      throw new Error(`GITLAB_US4_HUMAN_AUTHORITY_INVALID:${name}`);
  }
  if (gitLabUs4ScenarioCatalog["us4-lost-webhook-reconciliation"].expectedDeliveryAttempts !== 0)
    throw new Error("GITLAB_US4_LOST_WEBHOOK_INVALID");
  if (gitLabUs4ScenarioCatalog["us4-duplicate-webhook"].expectedDeliveryAttempts !== 2)
    throw new Error("GITLAB_US4_DUPLICATE_WEBHOOK_INVALID");
  if (gitLabUs4ScenarioCatalog["us4-auth-revoked"].expectedConnectionHealth !== "AUTH_DEGRADED")
    throw new Error("GITLAB_US4_AUTH_HEALTH_INVALID");
}

export const gitLabDocumentedScenarioCatalog = Object.freeze({
  ...gitLabFoundationScenarioCatalog,
  ...gitLabUs1ScenarioCatalog,
  ...gitLabUs2ScenarioCatalog,
  ...gitLabUs3ScenarioCatalog,
  ...gitLabUs4ScenarioCatalog,
});
export type GitLabDocumentedScenarioName = keyof typeof gitLabDocumentedScenarioCatalog;
export const gitLabDocumentedScenarioNames = Object.freeze(
  Object.keys(gitLabDocumentedScenarioCatalog).sort() as GitLabDocumentedScenarioName[],
);

export function validateGitLabDocumentedScenarioCatalog(): void {
  validateGitLabUs1ScenarioCatalog();
  validateGitLabUs2ScenarioCatalog();
  validateGitLabUs3ScenarioCatalog();
  validateGitLabUs4ScenarioCatalog();
  if (gitLabFoundationScenarioNames.length !== 2 || gitLabDocumentedScenarioNames.length !== 30)
    throw new Error("GITLAB_DOCUMENTED_SCENARIO_CARDINALITY_INVALID");
  const runtimeNames = Object.keys(gitLabMockScenarioCatalog).sort();
  if (JSON.stringify(runtimeNames) !== JSON.stringify(gitLabDocumentedScenarioNames))
    throw new Error("GITLAB_DOCUMENTED_SCENARIO_RUNTIME_PARITY_INVALID");
  for (const name of gitLabDocumentedScenarioNames) {
    const documented = gitLabDocumentedScenarioCatalog[name];
    const runtime = gitLabMockScenarioCatalog[name];
    if (documented.scenarioId !== name || runtime.id !== name)
      throw new Error(`GITLAB_DOCUMENTED_SCENARIO_ID_INVALID:${name}`);
    if (
      runtime.discovery.numericProjectId !== 5001 ||
      runtime.terminalFixtures.timeout.outcome !== "TIMEOUT" ||
      runtime.terminalFixtures.cancellation.outcome !== "CANCELLED"
    ) {
      throw new Error(`GITLAB_DOCUMENTED_SCENARIO_STATE_INVALID:${name}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  if (args.some((value) => value !== "--check" && value !== "--list"))
    throw new Error(`GITLAB_SCENARIO_CATALOG_ARGUMENT_INVALID:${args.join(",")}`);
  validateGitLabDocumentedScenarioCatalog();
  if (args.includes("--list")) {
    console.log(gitLabDocumentedScenarioNames.join("\n"));
  } else {
    const workspace = resolve(import.meta.dirname, "../..");
    const quickstartPath = resolve(
      workspace,
      "specs/005-gitlab-automated-validation/quickstart.md",
    );
    const quickstart = readFileSync(quickstartPath, "utf8");
    const quickstartNames = [...quickstart.matchAll(/gitlab:scenario -- ([a-z0-9-]+)/gu)]
      .map((match) => match[1]!)
      .filter((name) => name !== "reset" && !name.startsWith("--"))
      .sort();
    if (JSON.stringify(quickstartNames) !== JSON.stringify(gitLabDocumentedScenarioNames))
      throw new Error("GITLAB_DOCUMENTED_SCENARIO_QUICKSTART_PARITY_INVALID");
    const digest = (value: string | Buffer): `sha256:${string}` =>
      `sha256:${createHash("sha256").update(value).digest("hex")}`;
    const sourcePaths = Object.freeze([
      "tools/local/gitlab-scenario-catalog.mts",
      "tools/local/gitlab-scenario.mts",
      "apps/mock-hub/src/gitlab/scenarios/gitlab-scenarios.ts",
      "apps/mock-hub/src/gitlab/state/gitlab.repository.ts",
      "specs/005-gitlab-automated-validation/quickstart.md",
    ]);
    const files = sourcePaths.map((path) =>
      Object.freeze({ path, sha256: digest(readFileSync(resolve(workspace, path))) }),
    );
    const scenarios = gitLabDocumentedScenarioNames.map((id) => {
      const runtime = gitLabMockScenarioCatalog[id];
      return Object.freeze({
        id,
        status: "PASS",
        documented: gitLabDocumentedScenarioCatalog[id],
        statefulFixtureHash: digest(JSON.stringify(runtime)),
        persistedControls: Object.freeze({
          triggerFault: runtime.triggerFault,
          lookupFault: runtime.lookupFault,
          webhookFault: runtime.webhookFault,
          readFault: runtime.readFault,
          readFaultRemaining: runtime.readFaultRemaining,
        }),
      });
    });
    const report = Object.freeze({
      schemaVersion: 1,
      feature: "005-gitlab-automated-validation",
      gate: "documented-scenarios",
      contour: "qa-jira-gitlab-local",
      generatedAt: new Date().toISOString(),
      status: "PASS",
      cardinality: Object.freeze({ foundation: 2, us1: 5, us2: 7, us3: 10, us4: 6, total: 30 }),
      undocumentedRuntimeIds: Object.freeze([]),
      missingRuntimeIds: Object.freeze([]),
      missingQuickstartIds: Object.freeze([]),
      scenarios,
      sourceBinding: Object.freeze({ files, aggregateSha256: digest(JSON.stringify(files)) }),
    });
    const reportPath = resolve(
      workspace,
      "reports/005-gitlab-automated-validation/documented-scenarios.json",
    );
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, stringifyPortableJson(report, workspace), "utf8");
    console.log(
      `[gitlab-scenario-catalog] PASS foundation ${gitLabFoundationScenarioNames.length}/2 · US1 ${gitLabUs1ScenarioNames.length}/5 · US2 ${gitLabUs2ScenarioNames.length}/7 · US3 ${gitLabUs3ScenarioNames.length}/10 · US4 ${gitLabUs4ScenarioNames.length}/6; report: ${reportPath}`,
    );
  }
}
