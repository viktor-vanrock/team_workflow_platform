import { describe, expect, it } from "vitest";

import { DefectPublicationApprovalPolicy } from "../../../../packages/competency-qa/src/application/publish-defect-draft.ts";

describe("US4 defect approval", () => {
  it("requires a different authorized human and consumes approval once", () => {
    const policy = new DefectPublicationApprovalPolicy();
    const approval = policy.request({
      approvalId: "a",
      initiatorId: "i",
      subjectHash: "h",
      expiresAt: "2026-09-01T00:00:00Z",
    });
    expect(() =>
      policy.approve(approval, {
        actorId: "i",
        role: "WORKSPACE_OWNER",
        now: "2026-08-31T00:00:00Z",
      }),
    ).toThrow();
    const approved = policy.approve(approval, {
      actorId: "owner",
      role: "WORKSPACE_OWNER",
      now: "2026-08-31T00:00:00Z",
    });
    expect(policy.consume(approved, "h").state).toBe("CONSUMED");
    expect(() => policy.consume(approved, "h")).toThrow();
  });
});
