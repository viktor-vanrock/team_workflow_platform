import { describe, expect, it } from "vitest";

import type { QaFlakyDispositionBasis } from "../../../packages/competency-qa/src/domain/plan-item-result.ts";
import {
  evaluateQaAutomationReviewReadiness,
  qaAggregateSnapshotHash,
  type QaAutomationReviewAttemptFact,
  type QaAutomationReviewFindingFact,
} from "../../../packages/competency-qa/src/index.ts";
import { type FixtureOverrides, fixtureWithOverrides } from "../../support/fixture-value.ts";

const hash = (value: string) => qaAggregateSnapshotHash(value as never);
const actor = Object.freeze({
  kind: "HUMAN" as const,
  principalId: "reviewer-1",
  issuer: "local",
  subject: "reviewer.one",
});
const policy = Object.freeze({
  policyRef: "policy:qa-risk-review:v1",
  policyHash: hash("risk-policy"),
  highAndCriticalRequireDistinctReviewer: true,
  waiverRequiresDistinctReviewer: true,
  eligibleReviewerIds: Object.freeze([actor.principalId]),
});

function attempt(
  overrides: FixtureOverrides<QaAutomationReviewAttemptFact> = {},
): QaAutomationReviewAttemptFact {
  return fixtureWithOverrides<QaAutomationReviewAttemptFact>(
    {
      attemptId: "attempt-1",
      attemptNo: 1,
      resultId: "result-1",
      resultContentHash: hash("result-1"),
      outcome: "PASS",
      status: "TERMINAL",
      commandState: "CONFIRMED",
      retryDecision: { decision: "NOT_APPLICABLE", contentHash: hash("retry-1") },
      requiredArtifactsAvailable: true,
    },
    overrides,
  );
}

describe("QA automation HUMAN review readiness", () => {
  it("freezes one complete terminal Attempt-set and keeps quarantine as a warning", () => {
    const readiness = evaluateQaAutomationReviewReadiness({
      actor,
      attempts: [attempt()],
      findings: [],
      riskReviewerPolicy: policy,
      quarantineWarnings: [
        {
          quarantineId: "quarantine-1",
          revisionId: "revision-1",
          revisionHash: hash("quarantine-revision"),
          effectiveState: "ACTIVE",
        },
      ],
    });
    expect(readiness).toMatchObject({
      reviewable: true,
      maximumAttemptNo: 1,
      attemptCount: 1,
      blockers: [],
    });
    expect(readiness.attemptSetHash).toBe(
      hash([{ id: "attempt-1", contentHash: hash("result-1") }] as never),
    );
    expect(readiness.quarantineWarnings).toHaveLength(1);
  });

  it("blocks stale/incomplete Attempt sets, open retries, commands and evidence", () => {
    const readiness = evaluateQaAutomationReviewReadiness({
      actor,
      attempts: [
        attempt({
          status: "RUNNING",
          resultId: undefined,
          resultContentHash: undefined,
          outcome: undefined,
          commandState: "EXECUTING",
          retryDecision: undefined,
          requiredArtifactsAvailable: false,
        }),
      ],
      expectedAttemptSetHash: hash("older-attempt-set"),
      findings: [],
      riskReviewerPolicy: policy,
    });
    expect(readiness.reviewable).toBe(false);
    expect(readiness.blockers.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "QA_AUTOMATION_ATTEMPT_SET_STALE",
        "QA_AUTOMATION_ATTEMPT_NONTERMINAL",
        "QA_AUTOMATION_RESULT_MISSING",
        "QA_AUTOMATION_RETRY_UNSETTLED",
        "QA_AUTOMATION_COMMAND_UNSETTLED",
        "QA_AUTOMATION_ARTIFACT_EVIDENCE_UNAVAILABLE",
      ]),
    );
  });

  it("uses the shared Finding taxonomy and enforces distinct high/critical/waiver review", () => {
    const finding: QaAutomationReviewFindingFact = {
      findingId: "finding-1",
      classification: "PRODUCT",
      severity: "CRITICAL",
      stage: "DISPOSED",
      dispositionDecision: "WAIVED",
      classificationActorId: actor.principalId,
      dispositionActorId: "executor-1",
      waiverActionLive: false,
    };
    const readiness = evaluateQaAutomationReviewReadiness({
      actor,
      attempts: [attempt({ outcome: "INFRA_FAILED" })],
      findings: [finding],
      riskReviewerPolicy: policy,
    });
    expect(readiness.blockers.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "QA_FINDING_WAIVER_APPROVAL_REQUIRED",
        "QA_RISK_REVIEWER_REQUIRED",
        "QA_WAIVER_REVIEWER_REQUIRED",
      ]),
    );
  });

  it("requires and validates the existing QaFlakyDispositionBasis for assertion-to-PASS", () => {
    const failed = attempt({
      attemptId: "attempt-1",
      attemptNo: 1,
      resultId: "result-1",
      resultContentHash: hash("failed-result"),
      outcome: "ASSERTION_FAILED",
    });
    const passed = attempt({
      attemptId: "attempt-2",
      attemptNo: 2,
      resultId: "result-2",
      resultContentHash: hash("passed-result"),
      outcome: "PASS",
      retryDecision: { decision: "NOT_APPLICABLE", contentHash: hash("retry-2") },
    });
    const finding: QaAutomationReviewFindingFact = {
      findingId: "finding-1",
      classification: "PRODUCT",
      severity: "MEDIUM",
      stage: "DISPOSED",
      dispositionDecision: "DEFERRED",
      classificationActorId: "executor-1",
      dispositionActorId: "executor-1",
    };
    const missing = evaluateQaAutomationReviewReadiness({
      actor,
      attempts: [failed, passed],
      findings: [finding],
      riskReviewerPolicy: policy,
    });
    expect(missing.reviewFlags).toEqual(["FLAKY_SUSPECTED"]);
    expect(missing.blockers).toContainEqual({ code: "QA_FLAKY_DISPOSITION_BASIS_REQUIRED" });

    const failedAttemptRefs = Object.freeze([
      { id: failed.attemptId, contentHash: failed.resultContentHash! },
    ]);
    const flakyObservationRefs = Object.freeze([
      {
        id: "observation-1",
        attemptId: failed.attemptId,
        membershipId: "membership-1",
        contentHash: hash("observation-1"),
      },
    ]);
    const basis: QaFlakyDispositionBasis = Object.freeze({
      findingId: finding.findingId,
      findingState: "DISPOSED",
      disposedFindingReviewRef: {
        id: "finding-review-2",
        version: 2,
        contentHash: hash("finding-review"),
      },
      activeMembershipSetHash: hash("active-memberships"),
      failedAttemptRefs,
      failedAttemptSetHash: qaAggregateSnapshotHash(failedAttemptRefs as never),
      flakyObservationRefs,
      flakyObservationSetHash: qaAggregateSnapshotHash(flakyObservationRefs as never),
      policyRef: { key: "qa.flaky", version: "1.0.0", contentHash: hash("flaky-policy") },
    });
    expect(
      evaluateQaAutomationReviewReadiness({
        actor,
        attempts: [failed, passed],
        findings: [finding],
        flakyDispositionBasis: basis,
        riskReviewerPolicy: policy,
      }),
    ).toMatchObject({ reviewable: true, blockers: [] });
  });
});
