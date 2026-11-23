import { describe, expect, it } from "vitest";

import { createQaFindingActionContribution } from "../../../packages/competency-qa/src/application/finding-action-contribution.ts";
import { createFrozenFinding } from "../../support/002-us4-fixtures.ts";

describe("ACCEPTED_RISK and FINDING waiver approval", () => {
  it.each(["ACCEPTED_RISK", "WAIVED"] as const)(
    "requires a distinct live QA Lead for %s and keeps evidence",
    async (decision) => {
      const finding = createFrozenFinding({
        classification: decision === "ACCEPTED_RISK" ? "ACCEPTED_RISK" : "PRODUCT",
        freeze: false,
      });
      const contribution = createQaFindingActionContribution({
        now: () => "2026-08-30T12:00:00.000Z",
        roleFor: async (id) => (id === "lead-1" ? "QA_LEAD" : "QA_EXECUTOR"),
        persistApproved: async () => ({
          actionRef: { id: "action-1", version: 1, contentHash: `sha256:${"c".repeat(64)}` },
        }),
      });
      const candidate = {
        scope: { workspaceId: finding.workspaceId, projectId: finding.projectId },
        findingId: finding.findingId,
        findingReviewRef: {
          id: finding.currentReview!.id,
          version: finding.currentReview!.version,
          contentHash: finding.currentReview!.contentHash,
        },
        decision,
        initiatorId: "executor-1",
        reason: "Independent human decision",
        expiresAt: "2026-08-30T13:00:00.000Z",
      } as const;
      const action = {
        id: "action-1",
        kind: "QA_FINDING_ACTION",
        candidate,
        candidateHash: `sha256:${"b".repeat(64)}`,
        initiatorId: "executor-1",
        state: "PENDING_APPROVAL" as const,
        rowVersion: 1,
      };
      await expect(
        contribution.execute(action, {
          workspaceId: finding.workspaceId,
          projectId: finding.projectId,
          approvalId: "approval-1",
          approverId: "executor-1",
          authorizationBasisHash: `sha256:${"d".repeat(64)}`,
        }),
      ).rejects.toThrow("QA_FINDING_DISTINCT_LEAD_REQUIRED");
      await expect(
        contribution.execute(action, {
          workspaceId: finding.workspaceId,
          projectId: finding.projectId,
          approvalId: "approval-1",
          approverId: "lead-1",
          authorizationBasisHash: `sha256:${"d".repeat(64)}`,
        }),
      ).resolves.toBeDefined();
      expect(finding.evidenceRefs).not.toHaveLength(0);
    },
  );
});
