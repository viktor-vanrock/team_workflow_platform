import { describe, expect, it } from "vitest";

import {
  createExactApproval,
  decideApproval,
} from "../../../../packages/platform-core/src/approval/approval.ts";
import { consumeEffectAuthorization } from "../../../../packages/platform-core/src/approval/effect-authorization.ts";
import { evaluateEffectGate } from "../../../../packages/platform-core/src/commanding/effect-gate.ts";

function approvedFixture() {
  const approval = createExactApproval({
    id: "approval-a",
    workspaceId: "workspace-a",
    projectId: "project-a",
    initiatorId: "initiator-a",
    initiator: {
      kind: "SERVICE",
      principalId: "initiator-a",
      serviceKey: "test",
    },
    action: {
      actionKind: "EXTERNAL_COMMAND",
      actionId: "command-a",
      commandType: "sample.record.publish",
      capabilityKey: "sample.record",
      capabilityVersion: "1.0.0",
      operation: "record.publish",
    },
    target: { id: "record-a" },
    targetHash: "sha256:target",
    payloadHash: "sha256:payload",
    expectedState: { mode: "MUST_NOT_EXIST" },
    bindingRef: { id: "binding-a", version: 1 },
    profileRefs: [{ id: "profile-a", version: 1 }],
    requiredPermission: "connector.effect.approve",
    separationOfDutyPolicy: "SELF_APPROVAL_FORBIDDEN",
    effectIdempotencyKey: "effect-a",
    expiresAt: new Date("2030-01-01"),
    createdAt: new Date("2026-01-01"),
  });
  return decideApproval(approval, {
    approverId: "approver-a",
    approverRole: "LOCAL_APPROVER",
    authorizationBasisHash: "sha256:basis",
  });
}

describe("AT-015 exact Approval effect gate", () => {
  it("keeps the decision but invalidates authorization on exact-subject drift", async () => {
    const result = await consumeEffectAuthorization(approvedFixture(), {
      subjectHash: "sha256:changed",
      approverAuthorized: true,
      now: new Date("2026-01-01"),
    });
    expect(result).toMatchObject({
      decisionStatus: "APPROVED",
      effectAuthorizationStatus: "INVALIDATED",
      invalidationReason: "SUBJECT_CHANGED",
    });
  });

  it("consumes concurrent claims once and blocks NOT_REQUIRED configuration drift before adapter", async () => {
    const approved = approvedFixture();
    const claims = await Promise.allSettled([
      consumeEffectAuthorization(approved, {
        subjectHash: approved.subjectHash,
        approverAuthorized: true,
        now: new Date("2026-01-01"),
      }),
      consumeEffectAuthorization(approved, {
        subjectHash: approved.subjectHash,
        approverAuthorized: true,
        now: new Date("2026-01-01"),
      }),
    ]);
    expect(claims.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);

    let calls = 0;
    expect(
      await evaluateEffectGate({
        approvalMode: "NOT_REQUIRED",
        pinnedConfigurationHash: "sha256:a",
        liveConfigurationHash: "sha256:b",
        invoke: async () => {
          calls += 1;
        },
      }),
    ).toMatchObject({ status: "FAILED", reasonCode: "CONFIGURATION_DRIFT" });
    expect(calls).toBe(0);
  });
});
