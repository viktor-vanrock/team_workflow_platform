import { describe, expect, it } from "vitest";

import { QaTriageAssessmentAggregate } from "../../../packages/competency-qa/src/index.ts";

const input = () => ({
  id: "triage",
  workspaceId: "w",
  projectId: "p",
  subject: { kind: "WORK_ITEM" as const, id: "wi", version: 1, contentHash: "sha256:wi" },
  revision: 1,
  content: {
    facts: [
      { sourceRef: "jira:1", sourceVersion: "1", contentHash: "sha256:f", polarity: "SUPPORTS" },
    ],
    dimensions: { effortRange: { kind: "ESTIMATE", lower: 1, upper: 3 } },
    recommendations: { priority: { factRefs: [0] } },
  },
  expiresAt: new Date("2026-09-02T00:00:00Z"),
});

describe("TriageAssessment", () => {
  it("validates recommendation fact indexes and effort ranges", () => {
    expect(QaTriageAssessmentAggregate.create(input()).snapshot().state).toBe("CURRENT");
    expect(() =>
      QaTriageAssessmentAggregate.create({
        ...input(),
        content: { ...input().content, recommendations: { priority: { factRefs: [1] } } },
      }),
    ).toThrow("TRIAGE_FACT_INDEX_INVALID");
    expect(() =>
      QaTriageAssessmentAggregate.create({
        ...input(),
        content: {
          ...input().content,
          dimensions: { effortRange: { kind: "ESTIMATE", lower: 4, upper: 2 } },
        },
      }),
    ).toThrow("TRIAGE_EFFORT_RANGE_INVALID");
  });

  it("restores hashes and refuses stale or expired use", () => {
    const snapshot = QaTriageAssessmentAggregate.create(input()).snapshot();
    expect(
      QaTriageAssessmentAggregate.restore(snapshot).assertUsable(
        snapshot.sourceFactSetHash,
        new Date("2026-09-01"),
      ),
    ).toMatchObject({ state: "CURRENT" });
    expect(() =>
      QaTriageAssessmentAggregate.restore(snapshot).assertUsable(
        "sha256:drift",
        new Date("2026-09-01"),
      ),
    ).toThrow("TRIAGE_ASSESSMENT_STALE");
    expect(
      QaTriageAssessmentAggregate.restore(snapshot).stale(new Date("2026-09-01"), "SOURCE_CHANGED"),
    ).toMatchObject({ state: "STALE", staleReasonCode: "SOURCE_CHANGED" });
  });
});
