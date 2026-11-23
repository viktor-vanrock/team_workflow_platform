import assert from "node:assert/strict";

import { describe, expect, it, vi } from "vitest";

import {
  authorizedProjectSetHash,
  consumeApprovalSubjectV2,
  createExactApproval,
  createPlatformActionApprovalV2,
  createQueueActionPair,
  decideApprovalSubjectV2,
  parseApprovalSubject,
  projectSafeQueueAuthorizationWitness,
} from "../../../../packages/platform-core/src/index.ts";
import { ApprovalsV11Controller } from "../../../../packages/platform-runtime-nest/src/index.ts";
import { digest } from "../../../helpers/006/triage-fixture.ts";

function approval() {
  const scope = { kind: "PROJECT" as const, workspaceId: "w", projectId: "p" };
  const target = {
    kind: "WORK_ITEM" as const,
    workspaceId: "w",
    projectId: "p",
    workItemRef: {
      sourceType: "WORK_ITEM_REVISION",
      sourceId: "wi",
      sourceVersion: 1,
      semanticHash: digest("wi"),
    },
  };
  const pair = createQueueActionPair({
    candidate: {
      schemaVersion: "queue-action-candidate@1.0.0",
      actionId: "action",
      actionKind: "QUEUE_ORDER_OVERRIDE",
      scope,
      target,
      requestHash: digest("request"),
      expectedVisibleState: { kind: "QUEUE_ORDER", expectedQueueEpoch: 1 },
      requestedEffect: { kind: "MOVE", placement: "FIRST" },
      reason: "Order",
      expiresAt: "2026-09-04T08:00:00Z",
      approvalPolicy: "SELF_APPROVAL_FORBIDDEN",
    },
    witness: {
      schemaVersion: "queue-control-action@1.0.0",
      actionId: "action",
      actionKind: "QUEUE_ORDER_OVERRIDE",
      scope,
      target,
      expectedState: { kind: "QUEUE_ORDER", expectedQueueEpoch: 1 },
      requestedEffect: { kind: "MOVE", placement: "FIRST" },
      reason: "Order",
      expiresAt: "2026-09-04T08:00:00Z",
      approvalPolicy: "SELF_APPROVAL_FORBIDDEN",
      idempotencyKeyHash: digest("key"),
    },
  });
  const witness = projectSafeQueueAuthorizationWitness(
    scope,
    {
      workspaceId: "w",
      projectId: "p",
      requiredPermission: "queue.order.move",
      classificationDecision: "ALLOW",
    },
    "2026-09-03T08:00:00Z",
  );
  assert(witness.scopeKind === "PROJECT");
  return {
    pair,
    witness,
    subject: createPlatformActionApprovalV2({
      approvalId: "approval",
      workspaceId: "w",
      projectId: "p",
      initiator: {
        kind: "HUMAN",
        principalId: "initiator",
        issuer: "issuer",
        subject: "initiator",
      },
      initiatorAuthorizationScopeWitness: witness,
      action: {
        actionKind: "PLATFORM_ACTION",
        actionId: pair.actionId,
        commandType: "queue.order.override",
      },
      candidate: pair.candidate,
      requiredPermission: "queue.order.move",
      effectIdempotencyKey: "effect",
      dataClassificationKey: "INTERNAL",
      expiresAt: "2026-09-04T08:00:00Z",
      createdAt: "2026-09-03T08:00:00Z",
    }),
  };
}

describe("US3 Approval v1/v2 security", () => {
  it("keeps v1 readable and authorizes a v2 Project subject with safe current witnesses", () => {
    const legacy = createExactApproval({
      id: "v1",
      workspaceId: "w",
      projectId: "p",
      initiatorId: "i",
      initiator: { kind: "HUMAN", principalId: "i", issuer: "issuer", subject: "i" },
      action: {
        actionKind: "EXTERNAL_COMMAND",
        actionId: "c",
        commandType: "jira",
        capabilityKey: "jira.work-item",
        capabilityVersion: "1.0.0",
        operation: "set-priority",
      },
      target: { id: "wi" },
      targetHash: digest("target"),
      payloadHash: digest("payload"),
      expectedState: { version: 1 },
      bindingRef: { id: "b", version: 1 },
      profileRefs: [{ id: "p", version: 1 }],
      requiredPermission: "command.execute",
      separationOfDutyPolicy: "SELF_APPROVAL_FORBIDDEN",
      effectIdempotencyKey: "effect",
      expiresAt: new Date("2026-09-04T08:00:00Z"),
      createdAt: new Date("2026-09-03T08:00:00Z"),
    });
    expect(parseApprovalSubject(JSON.stringify(legacy))).toMatchObject({ id: "v1" });
    const { subject, witness } = approval();
    assert(witness.scopeKind === "PROJECT");
    const decided = decideApprovalSubjectV2({
      subject,
      decision: "APPROVE",
      approver: { kind: "HUMAN", principalId: "lead", issuer: "issuer", subject: "lead" },
      approverRole: "qa-lead",
      authorizationScopeWitness: { ...witness, evaluatedAt: "2026-09-03T09:00:00Z" },
      now: "2026-09-03T09:00:00Z",
    });
    const consumed = consumeApprovalSubjectV2({
      subject: decided,
      currentSubjectHash: decided.subjectHash,
      currentAuthorizationScopeWitness: { ...witness, evaluatedAt: "2026-09-03T09:01:00Z" },
      now: "2026-09-03T09:01:00Z",
    });
    expect(consumed.effectAuthorizationStatus).toBe("CONSUMED");
    expect(JSON.stringify(consumed)).not.toMatch(
      /membershipRef|entitlementRefs|roleAssignmentRefs/u,
    );
  });

  it("rejects self/SERVICE approval and revoked/mismatched current scope", () => {
    const { subject, witness } = approval();
    assert(witness.scopeKind === "PROJECT");
    expect(() =>
      decideApprovalSubjectV2({
        subject,
        decision: "APPROVE",
        approver: {
          kind: "HUMAN",
          principalId: "initiator",
          issuer: "issuer",
          subject: "initiator",
        },
        approverRole: "qa-lead",
        authorizationScopeWitness: witness,
        now: "2026-09-03T09:00:00Z",
      }),
    ).toThrow("SELF_APPROVAL_FORBIDDEN");
    expect(() =>
      decideApprovalSubjectV2({
        subject,
        decision: "APPROVE",
        approver: { kind: "SERVICE", principalId: "hermes", serviceKey: "hermes" } as never,
        approverRole: "service",
        authorizationScopeWitness: witness,
        now: "2026-09-03T09:00:00Z",
      }),
    ).toThrow("APPROVAL_V2_HUMAN_APPROVER_REQUIRED");
    const decided = decideApprovalSubjectV2({
      subject,
      decision: "APPROVE",
      approver: { kind: "HUMAN", principalId: "lead", issuer: "issuer", subject: "lead" },
      approverRole: "qa-lead",
      authorizationScopeWitness: witness,
      now: "2026-09-03T09:00:00Z",
    });
    expect(() =>
      consumeApprovalSubjectV2({
        subject: decided,
        currentSubjectHash: decided.subjectHash,
        currentAuthorizationScopeWitness: { ...witness, projectId: "other" },
        now: "2026-09-03T09:01:00Z",
      }),
    ).toThrow("APPROVAL_V2_SCOPE_REVOKED");
  });

  it("authorizes an exact portfolio subject without publishing authorization-record IDs", () => {
    const authorizedSetHash = authorizedProjectSetHash(["p", "q"]);
    const scope = {
      kind: "AUTHORIZED_PORTFOLIO" as const,
      workspaceId: "w",
      authorizedProjectSetHash: authorizedSetHash,
    };
    const target = {
      kind: "WORK_ITEM" as const,
      workspaceId: "w",
      projectId: "p",
      workItemRef: {
        sourceType: "WORK_ITEM_REVISION",
        sourceId: "wi",
        sourceVersion: 1,
        semanticHash: digest("wi"),
      },
    };
    const pair = createQueueActionPair({
      candidate: {
        schemaVersion: "queue-action-candidate@1.0.0",
        actionId: "portfolio-action",
        actionKind: "QUEUE_ORDER_OVERRIDE",
        scope,
        target,
        requestHash: digest("portfolio-request"),
        expectedVisibleState: { kind: "ORDER", expectedQueueEpoch: 1 },
        requestedEffect: { kind: "MOVE", placement: "FIRST" },
        reason: "Portfolio order",
        expiresAt: "2026-09-04T08:00:00Z",
        approvalPolicy: "SELF_APPROVAL_FORBIDDEN",
      },
      witness: {
        schemaVersion: "queue-control-action@1.0.0",
        actionId: "portfolio-action",
        actionKind: "QUEUE_ORDER_OVERRIDE",
        scope,
        target,
        expectedState: { kind: "ORDER", expectedQueueEpoch: 1 },
        requestedEffect: { kind: "MOVE", placement: "FIRST" },
        reason: "Portfolio order",
        expiresAt: "2026-09-04T08:00:00Z",
        approvalPolicy: "SELF_APPROVAL_FORBIDDEN",
        idempotencyKeyHash: digest("portfolio-key"),
      },
    });
    const witness = projectSafeQueueAuthorizationWitness(
      scope,
      {
        workspaceId: "w",
        projectId: "p",
        requiredPermission: "queue.order.move",
        classificationDecision: "ALLOW",
        authorizedProjectSetHash: authorizedSetHash,
      },
      "2026-09-03T08:00:00Z",
    );
    assert(witness.scopeKind === "AUTHORIZED_PORTFOLIO");
    const subject = createPlatformActionApprovalV2({
      approvalId: "portfolio-approval",
      workspaceId: "w",
      projectId: "p",
      initiator: {
        kind: "HUMAN",
        principalId: "initiator",
        issuer: "issuer",
        subject: "initiator",
      },
      initiatorAuthorizationScopeWitness: witness,
      action: {
        actionKind: "PLATFORM_ACTION",
        actionId: pair.actionId,
        commandType: "queue.order.override",
      },
      candidate: pair.candidate,
      requiredPermission: "queue.order.move",
      effectIdempotencyKey: "portfolio-effect",
      dataClassificationKey: "INTERNAL",
      expiresAt: "2026-09-04T08:00:00Z",
      createdAt: "2026-09-03T08:00:00Z",
    });
    const decided = decideApprovalSubjectV2({
      subject,
      decision: "APPROVE",
      approver: { kind: "HUMAN", principalId: "lead", issuer: "issuer", subject: "lead" },
      approverRole: "qa-lead",
      authorizationScopeWitness: { ...witness, evaluatedAt: "2026-09-03T09:00:00Z" },
      now: "2026-09-03T09:00:00Z",
    });
    expect(() =>
      consumeApprovalSubjectV2({
        subject: decided,
        currentSubjectHash: decided.subjectHash,
        currentAuthorizationScopeWitness: {
          ...witness,
          authorizedProjectSetHash: authorizedProjectSetHash(["p", "other"]),
          evaluatedAt: "2026-09-03T09:01:00Z",
        },
        now: "2026-09-03T09:01:00Z",
      }),
    ).toThrow("APPROVAL_V2_SCOPE_REVOKED");
    const consumed = consumeApprovalSubjectV2({
      subject: decided,
      currentSubjectHash: decided.subjectHash,
      currentAuthorizationScopeWitness: { ...witness, evaluatedAt: "2026-09-03T09:01:00Z" },
      now: "2026-09-03T09:01:00Z",
    });
    expect(consumed.effectAuthorizationStatus).toBe("CONSUMED");
    expect(JSON.stringify(consumed)).not.toMatch(
      /membershipRef|entitlementRefs|roleAssignmentRefs/u,
    );
  });

  it("returns the same not-found surface for missing and inaccessible approvals", async () => {
    const api = {
      get: vi.fn().mockResolvedValue(undefined),
      decide: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new ApprovalsV11Controller(api);
    await expect(
      controller.get("w", "p", "missing", { localPersonaKey: "lead" }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      controller.get("w", "p", "secret", { localPersonaKey: "outsider" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
