import { describe, expect, it } from "vitest";

import { buildCleanEvidenceManifest } from "../../../packages/competency-qa/src/application/evidence-manifest-builder.ts";

describe("Feature 010 metadata-only manual evidence", () => {
  it("builds a reviewable PASS manifest with no binary artifact members", () => {
    const manifest = buildCleanEvidenceManifest({
      workspaceId: "workspace",
      projectId: "project",
      workItemId: "work-item",
      sessionId: "session",
      targetSnapshotHash: "sha256:target",
      scopeSnapshotHash: "sha256:scope",
      attempts: [
        {
          attemptId: "attempt",
          planItemId: "plan",
          attemptNo: 1,
          result: "PASS",
          actorId: "executor",
          startedAt: "2026-09-07T10:00:00Z",
          endedAt: "2026-09-07T10:01:00Z",
        },
      ],
      observations: [
        {
          observationId: "observation",
          planItemId: "plan",
          attemptId: "attempt",
          kind: "POSITIVE",
          expectedOutcome: "works",
          actualOutcome: "works",
        },
      ],
      resultRevisions: [
        {
          resultRevisionId: "result",
          planItemId: "plan",
          result: "PASS",
          attemptIds: ["attempt"],
          observationIds: ["observation"],
          evidenceLinkIds: [],
        },
      ],
      artifactLinks: [],
      sessionOutcome: "PASSED",
      outcomeSummary: "Manual check passed without a binary attachment.",
      profileRefs: [],
      policyRefs: [{ key: "qa.evidence", version: "1.0.0" }],
      reviewerId: "reviewer",
      reviewedAt: "2026-09-07T10:02:00Z",
    });
    expect(manifest.artifactMembers).toEqual([]);
    expect(manifest.sessionOutcome).toBe("PASSED");
    expect(manifest.contentHash).toMatch(/^sha256:/u);
  });
});
