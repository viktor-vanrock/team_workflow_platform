import { describe, expect, it } from "vitest";

import {
  acceptedPlanningValuesAreSeparate,
  deriveTriageAssessmentStaleness,
  QaTriageAssessmentAggregate,
  triageAssessmentFingerprint,
  validateQaTriageAssessmentContent,
} from "../../../packages/competency-qa/src/index.ts";
import { cloneJson, digest, triageFixture } from "../../helpers/006/triage-fixture.ts";
import { requiredFixture } from "../../support/fixture-value.ts";

describe("US3 factorized triage semantics", () => {
  it("validates all fact indexes, estimates, canonical fingerprint, and rule/skill versions", () => {
    const output = triageFixture();
    expect(triageAssessmentFingerprint(output)).toBe(output.inputFingerprint);
    const invalidIndex = cloneJson(output) as unknown as Record<string, unknown>;
    const indexDetails = invalidIndex.dimensionDetails as Record<string, Record<string, unknown>>;
    requiredFixture(indexDetails.risk).factRefs = [9];
    expect(() => validateQaTriageAssessmentContent(invalidIndex)).toThrow(
      "TRIAGE_FACT_INDEX_INVALID",
    );
    const invalidEstimate = cloneJson(output) as unknown as Record<string, unknown>;
    (invalidEstimate.dimensions as Record<string, unknown>).effortRange = {
      kind: "ESTIMATE",
      lower: 4,
      upper: 2,
      unit: "PERSON_DAYS",
    };
    expect(() => validateQaTriageAssessmentContent(invalidEstimate)).toThrow();
    const invalidFingerprint = cloneJson(output) as unknown as Record<string, unknown>;
    invalidFingerprint.inputFingerprint = digest("drift");
    expect(() => validateQaTriageAssessmentContent(invalidFingerprint)).toThrow(
      "TRIAGE_INPUT_FINGERPRINT_INVALID",
    );
    const invalidVersion = cloneJson(output) as unknown as Record<string, unknown>;
    invalidVersion.ruleVersion = "1.2.0";
    expect(() => validateQaTriageAssessmentContent(invalidVersion)).toThrow(
      "TRIAGE_RULE_VERSION_MISMATCH",
    );
  });

  it("requires BUSINESS_IMPACT_MISSING exactly when impact is UNKNOWN", () => {
    expect(triageFixture().dimensions.businessImpact).toBe("UNKNOWN");
    expect(triageFixture({ businessImpact: true }).missingInformation).toEqual([]);
    const broken = cloneJson(triageFixture()) as unknown as Record<string, unknown>;
    broken.missingInformation = [];
    expect(() => validateQaTriageAssessmentContent(broken)).toThrow(
      "TRIAGE_BUSINESS_IMPACT_MISSING_INCONSISTENT",
    );
  });

  it("derives stale reasons and keeps accepted values separate from the proposal", () => {
    const output = triageFixture();
    const aggregate = QaTriageAssessmentAggregate.create({
      id: output.assessmentId,
      workspaceId: output.workspaceId,
      projectId: output.projectId,
      subject: output.subject,
      revision: output.revision,
      content: output,
      expiresAt: new Date(output.expiresAt),
    }).snapshot();
    expect(
      deriveTriageAssessmentStaleness({
        assessment: aggregate,
        currentFingerprint: output.inputFingerprint,
        currentRuleVersion: "1.1.0",
        currentSkillVersion: "1.1.0",
        now: new Date("2026-09-03T09:00:00Z"),
      }),
    ).toEqual({ stale: false });
    expect(
      deriveTriageAssessmentStaleness({
        assessment: aggregate,
        currentFingerprint: digest("changed"),
        now: new Date("2026-09-03T09:00:00Z"),
      }),
    ).toMatchObject({ stale: true, reasonCode: "SOURCE_CHANGED" });
    const accepted = acceptedPlanningValuesAreSeparate({
      assessment: aggregate,
      acceptedValues: { risk: "HIGH", businessImpact: "MEDIUM" },
    });
    expect(accepted.assessmentHash).not.toBe(accepted.acceptedValuesHash);
  });
});
