import { describe, expect, it } from "vitest";

import { designContractRegistry } from "../../../packages/platform-contracts/src/index.ts";
import {
  assertQueueActionConsumedResult,
  createPlatformActionApprovalV2,
  prepareQueueControlAction,
  projectSafeQueueAuthorizationWitness,
  queueControlDefaultState,
  validateApprovalSubjectV2,
} from "../../../packages/platform-core/src/index.ts";
import { digest } from "../../helpers/006/triage-fixture.ts";

const queueEntry = {
  queueEntryId: "q1",
  revision: 1,
  semanticHash: digest("q"),
  inputFingerprint: digest("qi"),
} as const;
const operational = {
  sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
  sourceId: "jira",
  sourceVersion: 1,
  semanticHash: digest("jira"),
  confirmedAt: "2026-09-03T08:00:00Z",
} as const;
const policyRef = { id: "policy", version: 1, semanticHash: digest("policy") } as const;

function pair() {
  const current = queueControlDefaultState({
    controlId: "control",
    workspaceId: "w",
    projectId: "p",
    workItemId: "wi",
    operationalProjectionRef: operational,
    qaSourceSetHash: digest("qa"),
    policyRef,
  });
  return prepareQueueControlAction({
    actionId: "action-1",
    requestKey: "request-1",
    workspaceId: "w",
    projectId: "p",
    workItemId: "wi",
    workItemRef: {
      sourceType: "WORK_ITEM_REVISION",
      sourceId: "wi",
      sourceVersion: 1,
      semanticHash: digest("wi"),
    },
    current,
    currentQueueEntry: queueEntry,
    expectedState: {
      kind: "WORK_ITEM_CONTROL",
      policyRef,
      expectedControlVersion: 0,
      expectedQueueEntry: queueEntry,
      operationalProjectionRef: operational,
      qaSourceSetHash: digest("qa"),
    },
    effect: {
      kind: "ACCEPT_PLANNING_VALUES",
      after: {
        risk: "HIGH",
        businessImpact: "MEDIUM",
        dependencyReadiness: "READY",
        effortRange: { kind: "UNKNOWN" },
      },
    },
    reason: "Accept",
  });
}

describe("US3 exact platform actions", () => {
  it("keeps the public candidate equal to the visible effect and a distinct same-ID private witness", () => {
    const value = pair();
    expect(value.candidate.actionId).toBe(value.witness.actionId);
    expect(value.candidate.requestedEffect).toEqual(value.witness.requestedEffect);
    expect(value.publicIntentHash).not.toBe(value.actionHash);
    expect(JSON.stringify(value.candidate)).not.toContain("idempotencyKeyHash");
    expect(
      designContractRegistry.validateById(
        "urn:awp:schemas:006:queue-action-candidate:v1",
        value.candidate,
      ),
    ).toBe(value.candidate);
    expect(
      designContractRegistry.validateById(
        "urn:awp:schemas:006:queue-control-action:v1",
        value.witness,
      ),
    ).toBe(value.witness);
  });

  it("rejects approval policy/binding and result-family mismatches", () => {
    const value = pair();
    const witness = projectSafeQueueAuthorizationWitness(
      value.candidate.scope,
      {
        workspaceId: "w",
        projectId: "p",
        requiredPermission: "queue.control.request",
        classificationDecision: "ALLOW",
      },
      "2026-09-03T08:00:00Z",
    );
    expect(() =>
      createPlatformActionApprovalV2({
        approvalId: "approval",
        workspaceId: "w",
        projectId: "p",
        initiator: { kind: "HUMAN", principalId: "human", issuer: "issuer", subject: "human" },
        initiatorAuthorizationScopeWitness: witness,
        action: {
          actionKind: "PLATFORM_ACTION",
          actionId: value.actionId,
          commandType: "queue.control.accept",
        },
        candidate: value.candidate,
        requiredPermission: "queue.control.request",
        effectIdempotencyKey: "effect",
        dataClassificationKey: "INTERNAL",
        expiresAt: "2026-09-04T08:00:00Z",
        createdAt: "2026-09-03T08:00:00Z",
      }),
    ).toThrow("APPROVAL_V2_CANDIDATE_SCOPE_MISMATCH");
    expect(() =>
      assertQueueActionConsumedResult(value, {
        resultRef: {
          sourceType: "QUEUE_ORDER_OVERRIDE_REVISION",
          sourceId: "wrong",
          sourceVersion: 1,
          semanticHash: digest("wrong"),
        },
      }),
    ).toThrow("QUEUE_CONTROL_RESULT_FAMILY_MISMATCH");
    expect(() => validateApprovalSubjectV2({} as never)).toThrow();
  });
});
