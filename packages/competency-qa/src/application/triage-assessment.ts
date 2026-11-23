import { type JsonValue, sha256 } from "@awp/platform-contracts";

import {
  QaTriageAssessmentAggregate,
  type QaTriageAssessmentSnapshot,
  type QaTriageStaleReason,
  triageAssessmentFingerprint,
} from "../domain/triage-assessment.ts";

export function createTriageAssessment(
  input: Parameters<typeof QaTriageAssessmentAggregate.create>[0],
): QaTriageAssessmentSnapshot {
  return QaTriageAssessmentAggregate.create(input).snapshot();
}

export function requireCurrentTriageAssessment(
  value: QaTriageAssessmentSnapshot,
  currentFingerprint: string,
  now: Date,
): QaTriageAssessmentSnapshot {
  return QaTriageAssessmentAggregate.restore(value).assertUsable(currentFingerprint, now);
}

export function deriveTriageAssessmentStaleness(
  input: Readonly<{
    assessment: QaTriageAssessmentSnapshot;
    currentFingerprint: string;
    currentRuleVersion?: string;
    currentSkillVersion?: string;
    sourceAuthorized?: boolean;
    sourceAvailable?: boolean;
    now: Date;
  }>,
): Readonly<{ stale: boolean; reasonCode?: QaTriageStaleReason }> {
  if (input.assessment.state !== "CURRENT")
    return Object.freeze({
      stale: true,
      ...(input.assessment.staleReasonCode ? { reasonCode: input.assessment.staleReasonCode } : {}),
    });
  if (input.now >= input.assessment.expiresAt)
    return Object.freeze({ stale: true, reasonCode: "EXPIRED" });
  if (input.sourceAuthorized === false)
    return Object.freeze({ stale: true, reasonCode: "SOURCE_REVOKED" });
  if (input.sourceAvailable === false)
    return Object.freeze({ stale: true, reasonCode: "SOURCE_CHANGED" });
  const content = input.assessment.content;
  if (input.currentRuleVersion !== undefined && content.ruleVersion !== input.currentRuleVersion) {
    return Object.freeze({ stale: true, reasonCode: "PROFILE_CHANGED" });
  }
  if (
    input.currentSkillVersion !== undefined &&
    content.skillVersion !== input.currentSkillVersion
  ) {
    return Object.freeze({ stale: true, reasonCode: "BINDING_CHANGED" });
  }
  return input.currentFingerprint === triageAssessmentFingerprint(content)
    ? Object.freeze({ stale: false })
    : Object.freeze({ stale: true, reasonCode: "SOURCE_CHANGED" });
}

export function acceptedPlanningValuesAreSeparate(
  input: Readonly<{
    assessment: QaTriageAssessmentSnapshot;
    acceptedValues: Readonly<Record<string, JsonValue>>;
  }>,
): Readonly<{ assessmentHash: string; acceptedValuesHash: string }> {
  return Object.freeze({
    assessmentHash: input.assessment.contentHash,
    acceptedValuesHash: sha256(input.acceptedValues as JsonValue),
  });
}
