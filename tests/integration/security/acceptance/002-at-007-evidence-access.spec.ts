import { describe, expect, it } from "vitest";

import { createQaEvidenceAuthorizationContribution } from "../../../../packages/competency-qa/src/application/evidence-authorization-contribution.ts";

describe("AT-007 evidence authorization", () => {
  it("denies scope, role, classification and revocation before storage", async () => {
    let storageCalls = 0;
    const policy = createQaEvidenceAuthorizationContribution({
      liveAuthorization: async (request) => ({
        allowed:
          request.workspaceId === "w" &&
          request.projectId === "p" &&
          request.actorId === "executor" &&
          request.classificationRank <= 2 &&
          !request.revoked,
      }),
      onAuthorizedStorageAccess: () => {
        storageCalls += 1;
      },
    });
    for (const request of [
      {
        workspaceId: "other",
        projectId: "p",
        actorId: "executor",
        classificationRank: 1,
        revoked: false,
      },
      {
        workspaceId: "w",
        projectId: "other",
        actorId: "executor",
        classificationRank: 1,
        revoked: false,
      },
      {
        workspaceId: "w",
        projectId: "p",
        actorId: "requester",
        classificationRank: 1,
        revoked: false,
      },
      {
        workspaceId: "w",
        projectId: "p",
        actorId: "executor",
        classificationRank: 3,
        revoked: false,
      },
      {
        workspaceId: "w",
        projectId: "p",
        actorId: "executor",
        classificationRank: 1,
        revoked: true,
      },
    ])
      expect(await policy.authorize(request)).toEqual({
        allowed: false,
        reason: "QA_EVIDENCE_ACCESS_DENIED",
      });
    expect(storageCalls).toBe(0);
    expect(
      await policy.authorize({
        workspaceId: "w",
        projectId: "p",
        actorId: "executor",
        classificationRank: 2,
        revoked: false,
      }),
    ).toEqual({ allowed: true });
    expect(storageCalls).toBe(1);
  });
});
