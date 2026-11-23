import { describe, expect, it } from "vitest";

import {
  buildCleanEvidenceManifest,
  correctEvidenceManifest,
} from "../../../packages/competency-qa/src/application/evidence-manifest-builder.ts";

describe("AT-006 canonical evidence manifest", () => {
  it("is deterministic, pins exact evidence membership and creates linked corrections", () => {
    const input = {
      workspaceId: "w",
      projectId: "p",
      workItemId: "wi",
      sessionId: "s",
      targetSnapshotHash: "sha256:target",
      scopeSnapshotHash: "sha256:scope",
      resultRevisions: [
        {
          resultRevisionId: "r",
          planItemId: "pi",
          result: "PASS" as const,
          attemptIds: ["a"],
          observationIds: ["o"],
          evidenceLinkIds: [],
        },
      ],
      attempts: [
        {
          attemptId: "a",
          planItemId: "pi",
          attemptNo: 1,
          result: "PASS" as const,
          actorId: "executor",
          startedAt: "2026-08-30T10:00:00.000Z",
          endedAt: "2026-08-30T10:01:00.000Z",
        },
      ],
      observations: [
        {
          observationId: "o",
          planItemId: "pi",
          attemptId: "a",
          kind: "POSITIVE" as const,
          expectedOutcome: "ok",
          actualOutcome: "ok",
        },
      ],
      artifactLinks: [],
      sessionOutcome: "PASSED" as const,
      outcomeSummary: "Clean pass",
      profileRefs: [{ id: "profile", version: 1 }],
      policyRefs: [{ key: "qa.evidence", version: "1" }],
      reviewerId: "executor",
      reviewedAt: "2026-08-30T10:02:00.000Z",
    };
    const first = buildCleanEvidenceManifest(input);
    expect(buildCleanEvidenceManifest(input).contentHash).toBe(first.contentHash);
    expect(first.frozenFindingReviews).toEqual([]);
    const corrected = correctEvidenceManifest(first, {
      reason: "Clarify summary",
      outcomeSummary: "Clean pass, manually verified",
      reviewerId: "executor",
      reviewedAt: "2026-08-30T10:03:00.000Z",
    });
    expect(corrected.version).toBe(2);
    expect(corrected.previousRevisionRef).toMatchObject({
      id: first.manifestRevisionId,
      contentHash: first.contentHash,
    });
    expect(corrected.contentHash).not.toBe(first.contentHash);
  });
});
