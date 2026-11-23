import { describe, expect, it } from "vitest";

import {
  gitLabDeterministicTerminalFixtures,
  gitLabScenarioCatalog,
  gitLabUs3ScenarioIds,
} from "../../../apps/mock-hub/src/gitlab/gitlab.module.ts";
import {
  gitLabUs3ScenarioCatalog,
  gitLabUs3ScenarioNames,
  gitLabUs3TerminalFixtures,
  validateGitLabUs3ScenarioCatalog,
} from "../../../tools/local/gitlab-scenario-catalog.mts";

describe("Feature 005 US3 deterministic scenario catalog", () => {
  it("registers the same ten documented IDs in Mock Hub and the local runner", () => {
    expect(gitLabUs3ScenarioIds).toHaveLength(10);
    expect(gitLabUs3ScenarioNames).toEqual(gitLabUs3ScenarioIds);
    expect(() => validateGitLabUs3ScenarioCatalog()).not.toThrow();
    for (const scenarioId of gitLabUs3ScenarioIds) {
      expect(gitLabScenarioCatalog[scenarioId]).toMatchObject({
        id: scenarioId,
        capabilityMode: "FULL_QA",
      });
      expect(gitLabUs3ScenarioCatalog[scenarioId]).toMatchObject({
        scenarioId,
        expectedReviewState: "REVIEW_REQUIRED",
        expectedSignedVerdicts: 0,
        expectedJiraTransitions: 0,
      });
    }
  });

  it("pins timeout and cancellation independently of wall clock or provider text", () => {
    expect(gitLabDeterministicTerminalFixtures.timeout).toMatchObject({
      terminalKind: "TIMEOUT",
      outcome: "TIMEOUT",
      terminalAt: "2026-09-01T07:34:00.000Z",
    });
    expect(gitLabDeterministicTerminalFixtures.cancellation).toMatchObject({
      terminalKind: "CANCELLED",
      outcome: "CANCELLED",
      cancellationReasonCode: "PIPELINE_CANCELLED",
    });
    expect(gitLabUs3TerminalFixtures.timeout.expectedRetryDecision).toBe("NOT_APPLICABLE");
    expect(gitLabUs3TerminalFixtures.cancellation.expectedRetryDecision).toBe("NOT_APPLICABLE");
  });

  it("pins the bounded retry, flaky, drift, checksum, quarantine, and proposal cases", () => {
    expect(gitLabScenarioCatalog["us3-allowlisted-infra-retry"].attemptResults).toHaveLength(2);
    expect(
      gitLabUs3ScenarioCatalog["us3-allowlisted-infra-retry"].expectedAutomaticSuccessors,
    ).toBe(1);
    expect(gitLabUs3ScenarioCatalog["us3-explicit-rerun-pass-flaky"].expectedFlakySuspected).toBe(
      true,
    );
    expect(gitLabScenarioCatalog["us3-result-schema-drift"].attemptResults[0]).toMatchObject({
      resultSchema: "DRIFTED",
      outcome: "INCOMPLETE",
    });
    expect(gitLabScenarioCatalog["us3-artifact-checksum-mismatch"].attemptResults[0]).toMatchObject(
      { artifactAvailability: "CHECKSUM_MISMATCH" },
    );
    expect(gitLabUs3ScenarioCatalog["us3-quarantine-lifecycle"].expectedQuarantineRevisions).toBe(
      2,
    );
    expect(gitLabUs3ScenarioCatalog["us3-review-packet-proposal-only"].expectedHermes).toBe(
      "PROPOSAL_ONLY",
    );
    expect(gitLabUs3ScenarioCatalog["us3-post-review-linked-session"].expectedLinkedSessions).toBe(
      1,
    );
  });
});
