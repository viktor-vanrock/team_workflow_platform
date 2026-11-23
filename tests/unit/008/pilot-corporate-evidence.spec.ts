import { describe, expect, it } from "vitest";

import { validateObservedPilotReview008 } from "../../../tools/verification/feature-008-review.mts";
import { validateCorporateShadowEvidence008 } from "../../../tools/verification/feature-008-shadow.mts";

describe("Feature 008 corporate pilot evidence gates", () => {
  it("keeps missing or development shadow evidence blocked", () => {
    expect(validateCorporateShadowEvidence008(null)).toContain("SHADOW_EVIDENCE_MISSING");
    expect(
      validateCorporateShadowEvidence008({ schemaVersion: 1, kind: "DEVELOPMENT_SHADOW" }),
    ).toContain("SHADOW_SCHEMA_INVALID");
  });

  it("rejects simulated elapsed pilot time and incomplete human review", () => {
    const value = {
      schemaVersion: 1,
      kind: "OBSERVED_CORPORATE_LIMITED_PILOT",
      sourceMode: "CORPORATE_OBSERVATION",
      workspaceId: "workspace",
      projectId: "project",
      runId: "run",
      sampleSize: 10,
      minimumSample: 10,
      windowEndAt: "2026-09-10T00:00:00.000Z",
      sourceEvidenceHashes: [`sha256:${"a".repeat(64)}`],
      guardrails: [],
      externalEffects: { source: "INDEPENDENT", writes: 2, duplicates: 0 },
      metrics: [{ value: 1, denominator: 10 }],
      reviews: [],
      operatorLoadMinutes: 1,
      limitations: [],
      residualRisks: [],
    };
    const reasons = validateObservedPilotReview008(value, Date.parse("2026-09-05T00:00:00.000Z"));
    expect(reasons).toContain("LIMITED_PILOT_WINDOW_NOT_ELAPSED");
    expect(reasons).toContain("LIMITED_PILOT_GUARDRAILS_INCOMPLETE");
    expect(reasons).toContain("LIMITED_PILOT_HUMAN_REVIEW_INVALID");
  });
});
