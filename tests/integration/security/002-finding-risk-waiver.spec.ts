import { describe, expect, it } from "vitest";

import { createQaFindingActionContribution } from "../../../packages/competency-qa/src/application/finding-action-contribution.ts";
import { createFrozenFinding } from "../../support/002-us4-fixtures.ts";

describe("Finding ACCEPTED_RISK and waiver exact action boundary", () => {
  it.each(["ACCEPTED_RISK", "WAIVED"] as const)(
    "requires a distinct current QA Lead for %s",
    async (decision) => {
      const contribution = createQaFindingActionContribution({
        now: () => "2026-08-30T12:00:00.000Z",
        roleFor: async (id) => (id === "lead-1" ? "QA_LEAD" : "QA_EXECUTOR"),
        persistApproved: async () => ({
          actionRef: { id: "action-1", version: 1, contentHash: `sha256:${"c".repeat(64)}` },
        }),
      });
      const candidate = {
        scope: { workspaceId: "workspace-1", projectId: "project-1" },
        findingId: "finding-1",
        findingReviewRef: { id: "review-1", version: 1, contentHash: `sha256:${"a".repeat(64)}` },
        decision,
        initiatorId: "executor-1",
        reason: "Independent disposition",
        expiresAt: "2026-08-30T13:00:00.000Z",
      } as const;
      const action = {
        id: "action-1",
        kind: decision === "WAIVED" ? "QA_FINDING_WAIVER" : "QA_FINDING_ACCEPTED_RISK",
        candidate,
        candidateHash: `sha256:${"b".repeat(64)}`,
        initiatorId: "executor-1",
        state: "PENDING_APPROVAL" as const,
        rowVersion: 1,
      };
      await expect(
        contribution.execute(action, {
          workspaceId: "workspace-1",
          projectId: "project-1",
          approvalId: "approval-1",
          approverId: "executor-1",
          authorizationBasisHash: `sha256:${"d".repeat(64)}`,
        }),
      ).rejects.toThrow("QA_FINDING_DISTINCT_LEAD_REQUIRED");
      await expect(
        contribution.execute(action, {
          workspaceId: "workspace-1",
          projectId: "project-1",
          approvalId: "approval-1",
          approverId: "lead-1",
          authorizationBasisHash: `sha256:${"d".repeat(64)}`,
        }),
      ).resolves.toMatchObject({ actionRef: { id: "action-1" } });
    },
  );

  it("reclassification invalidates the pending action and neither action waives evidence", () => {
    const finding = createFrozenFinding({ classification: "ACCEPTED_RISK", freeze: false });
    finding.attachPendingAction("action-1");
    finding.classify({
      classification: "INFRA",
      severity: "LOW",
      summary: "Reclassified",
      reason: "New human evidence",
      policyRef: { key: "qa.finding-review", version: "1.0.0" },
      actor: finding.createdBy,
      at: "2026-08-30T10:03:00.000Z",
    });
    expect(finding.invalidatedActionIds).toEqual(["action-1"]);
    expect(finding.evidenceRefs.length).toBeGreaterThan(0);
  });
});
