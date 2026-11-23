import { describe, expect, it, vi } from "vitest";

import { type JsonValue, sha256 } from "../../../packages/platform-contracts/src/index.ts";
import {
  pilotGuardrailKeys,
  PilotGuardrailService,
} from "../../../packages/runtime-composition/src/pilot/guardrail-service.ts";
import {
  createPilotReport,
  createPilotReviewDecision,
} from "../../../packages/runtime-composition/src/pilot/review-service.ts";

const hash = (value: unknown) => sha256(value as JsonValue);
const observedAt = "2026-09-03T12:00:00.000Z";
const observations = () =>
  pilotGuardrailKeys.map((key) => ({
    key,
    value: key.endsWith("COVERAGE") ? 1 : 0,
    sourceHash: hash(key),
    independentlyObserved: true,
    observedAt,
  }));

describe("Feature 008 pilot guardrails and review", () => {
  it("keeps missing evidence unknown and suspends immediately on a measured breach", async () => {
    const suspendAndFence = vi.fn(async () => undefined);
    const service = new PilotGuardrailService({ suspendAndFence });
    expect(
      (
        await service.evaluate(
          observations().map((value, index) =>
            index === 0 ? { ...value, value: null, sourceHash: null } : value,
          ),
          "incident:unknown",
          observedAt,
        )
      ).state,
    ).toBe("UNKNOWN");
    expect(suspendAndFence).not.toHaveBeenCalled();
    const breached = await service.evaluate(
      observations().map((value, index) => (index === 1 ? { ...value, value: 1 } : value)),
      "incident:breach",
      observedAt,
    );
    expect(breached.state).toBe("BREACH");
    expect(suspendAndFence).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentRef: "incident:breach",
        breached: ["UNAUTHORIZED_EXTERNAL_WRITES"],
      }),
    );
  });

  it("reports insufficient data until sample, guardrails and independent write counts are complete", async () => {
    const guardrails = await new PilotGuardrailService({
      suspendAndFence: async () => undefined,
    }).evaluate(observations(), "", observedAt);
    const base = {
      reportId: "report",
      cohortHash: hash("cohort"),
      deploymentHash: hash("deployment"),
      protocolHash: hash("protocol"),
      baselineHash: hash("baseline"),
      observedSampleSize: 2,
      minimumSample: 3,
      metrics: [
        {
          metricKey: "REWORK_RATE" as const,
          value: 0.1,
          numerator: 1,
          denominator: 10,
          includedCount: 10,
          excludedCount: 0,
          censoredCount: 0,
          missingCount: 0,
          sourceFactHashes: [hash("fact")],
        },
      ],
      guardrails,
      independentlyObservedExternalWrites: null,
      incidents: [],
      operatorLoadMinutes: 12,
      limitations: ["small window"],
      residualRisks: [],
      requestedRecommendation: "CONTINUE" as const,
      createdAt: observedAt,
    };
    const insufficient = createPilotReport(base);
    expect(insufficient).toMatchObject({
      measurementComplete: false,
      recommendation: "INSUFFICIENT_DATA",
    });
    const complete = createPilotReport({
      ...base,
      reportId: "complete",
      observedSampleSize: 3,
      independentlyObservedExternalWrites: 2,
    });
    expect(complete).toMatchObject({ measurementComplete: true, recommendation: "CONTINUE" });
    const decision = createPilotReviewDecision(
      {
        reviewId: "review",
        reportHash: complete.contentHash,
        decision: "CONTINUE",
        qaLead: { kind: "HUMAN", principalId: "qa", authorizationRef: "auth:qa" },
        sponsor: { kind: "HUMAN", principalId: "sponsor", authorizationRef: "auth:sponsor" },
        reason: "Measured pilot met the reviewed protocol.",
        decidedAt: "2026-09-03T13:00:00.000Z",
      },
      complete,
    );
    expect(decision.contentHash).toMatch(/^sha256:/u);
    expect(() =>
      createPilotReviewDecision(
        {
          reviewId: decision.reviewId,
          reportHash: decision.reportHash,
          decision: decision.decision,
          qaLead: decision.sponsor,
          sponsor: decision.sponsor,
          reason: decision.reason,
          decidedAt: decision.decidedAt,
        },
        complete,
      ),
    ).toThrow("PILOT_REVIEW_DECISION_INVALID");
  });
});
