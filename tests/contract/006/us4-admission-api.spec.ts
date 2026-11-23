import { describe, expect, it } from "vitest";

import { exactQueueActionHttpReceipt } from "../../../apps/api/src/extensions/queue/queue-http-receipts.ts";
import {
  assertQueueActionConsumedResult,
  type CapacityActionExpectedState,
  prepareCapacityQueueAction,
} from "../../../packages/platform-core/src/index.ts";
import {
  assertCapacityAdmissionHttpCommand,
  assertStrongSessionIfMatch,
  capacityAdmissionHttpProblem,
  capacityAdmissionHttpReceipt,
  strongSessionEtag,
} from "../../../packages/runtime-composition/src/index.ts";
import { policyIds } from "../../helpers/006/policy-fixture.ts";
import { digest } from "../../helpers/006/triage-fixture.ts";

const session = {
  sourceId: "00000000-0000-4000-8000-000000000661",
  sourceVersion: 4,
  semanticHash: digest("session:r4"),
};

describe("US4 capacity admission HTTP contract", () => {
  it("requires the exact strong predecessor Session ETag", () => {
    const tag = strongSessionEtag(session);
    expect(tag.startsWith('"qa-session:4:sha256:')).toBe(true);
    expect(() => assertStrongSessionIfMatch(tag, session)).not.toThrow();
    expect(() => assertStrongSessionIfMatch('W/"4"', session)).toThrow(
      "CAPACITY_ADMISSION_SESSION_ETAG_STALE",
    );
    expect(() =>
      assertStrongSessionIfMatch(strongSessionEtag({ ...session, sourceVersion: 5 }), session),
    ).toThrow("CAPACITY_ADMISSION_SESSION_ETAG_STALE");
  });

  it("accepts a closed command and rejects all client-supplied global capacity witnesses", () => {
    const command = {
      schemaVersion: "capacity-admission-request@1.0.0",
      activityKind: "MANUAL_SESSION_START",
      sessionId: session.sourceId,
      expectedSessionVersion: session.sourceVersion,
      expectedQueueControlVersion: 0,
      expectedOperationalProjectionRef: {
        sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
        sourceId: "jira",
        sourceVersion: 1,
        semanticHash: digest("jira"),
      },
    };
    expect(() => assertCapacityAdmissionHttpCommand(command)).not.toThrow();
    for (const key of [
      "expectedCapacityHeadVersion",
      "humanCommittedCount",
      "workspaceHumanWipLimit",
      "claimSetHash",
    ]) {
      expect(() =>
        assertCapacityAdmissionHttpCommand({
          ...command,
          [key]: key === "humanCommittedCount" ? 1 : digest(key),
        }),
      ).toThrow();
    }
  });

  it("returns durable denial/replay as 200 and approval creation as 202 with Location", () => {
    const decisionRef = {
      sourceType: "CAPACITY_ADMISSION_DECISION" as const,
      sourceId: "00000000-0000-4000-8000-000000000662",
      sourceVersion: 1 as const,
      semanticHash: digest("decision"),
    };
    expect(
      capacityAdmissionHttpReceipt({ outcome: "DENIED", decisionRef, replayed: false }),
    ).toMatchObject({ status: 200, body: { state: "DECIDED", outcome: "DENIED" } });
    expect(
      capacityAdmissionHttpReceipt({ outcome: "DENIED", decisionRef, replayed: true }),
    ).toMatchObject({ status: 200, body: { replayed: true } });
    expect(
      capacityAdmissionHttpReceipt({
        outcome: "DENIED",
        decisionRef,
        replayed: false,
        approvalId: "00000000-0000-4000-8000-000000000663",
      }),
    ).toMatchObject({ status: 202, location: "/approvals/00000000-0000-4000-8000-000000000663" });
  });

  it("keeps consumed capacity actions in the CapacityAdmissionDecision result family", () => {
    const expected = {
      kind: "CAPACITY",
      policyRef: { id: policyIds.policy, version: 1, semanticHash: digest("policy") },
      policyMode: "ENFORCED",
      expectedControlVersion: 0,
      expectedQueueEntry: {
        queueEntryId: "e",
        revision: 1,
        semanticHash: digest("e"),
        inputFingerprint: digest("i"),
      },
      expectedCapacityHeadVersion: 1,
      workspaceHumanWipLimit: 1,
      activeExpediteLimit: 1,
      humanOccupiedCount: 1,
      reviewReservedCount: 0,
      humanCommittedCount: 1,
      forcedExternalCount: 0,
      activeExpediteCount: 0,
      claimSetHash: digest("c"),
      reservationSetHash: digest("r"),
      expediteSetHash: digest("x"),
      sessionRef: { sourceType: "QA_TEST_SESSION_REVISION", ...session },
      operationalProjectionRef: {
        sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION",
        sourceId: "j",
        sourceVersion: 1,
        semanticHash: digest("j"),
      },
    } as unknown as CapacityActionExpectedState;
    const pair = prepareCapacityQueueAction({
      actionId: "00000000-0000-4000-8000-000000000664",
      actionKind: "WIP_ADMISSION_OVERRIDE",
      requestKey: "admission-override-key-01",
      requestHash: digest("request"),
      workspaceId: policyIds.workspace,
      projectId: policyIds.projectA,
      workItemRef: {
        sourceType: "WORK_ITEM_REVISION",
        sourceId: "wi",
        sourceVersion: 1,
        semanticHash: digest("wi"),
      },
      expectedState: expected,
      authorizedCapacitySnapshotRef: {
        id: "00000000-0000-4000-8000-000000000665",
        version: 1,
        semanticHash: digest("snapshot"),
      },
      effect: {
        kind: "ALLOW_WIP_ADMISSION",
        activityKind: "MANUAL_SESSION_START",
        sessionRef: expected.sessionRef!,
        requestedSessionState: "RUNNING",
      },
      reason: "Exact",
      expiresAt: "2026-09-04T09:00:00.000Z",
    });
    expect(() =>
      assertQueueActionConsumedResult(pair, {
        resultRef: {
          sourceType: "WORK_ITEM_QUEUE_CONTROL_REVISION",
          sourceId: "bad",
          sourceVersion: 1,
          semanticHash: digest("bad"),
        },
      }),
    ).toThrow("CAPACITY_ADMISSION_RESULT_FAMILY_MISMATCH");
    expect(() =>
      assertQueueActionConsumedResult(pair, {
        resultRef: {
          sourceType: "CAPACITY_ADMISSION_DECISION",
          sourceId: "ok",
          sourceVersion: 1,
          semanticHash: digest("ok"),
        },
      }),
    ).not.toThrow();
  });

  it("maps stale state to 409 and keeps scoped forbidden/not-found responses closed", () => {
    const correlationId = "00000000-0000-4000-8000-000000000666";
    expect(
      capacityAdmissionHttpProblem(new Error("CAPACITY_ADMISSION_SESSION_STALE"), correlationId),
    ).toMatchObject({
      status: 409,
      body: { code: "CAPACITY_ADMISSION_SESSION_STALE", correlationId },
    });
    expect(
      capacityAdmissionHttpProblem(new Error("CAPACITY_ADMISSION_FORBIDDEN"), correlationId),
    ).toMatchObject({ status: 403, body: { title: "Forbidden" } });
    const missing = capacityAdmissionHttpProblem(
      new Error("CAPACITY_ADMISSION_NOT_FOUND"),
      correlationId,
    );
    expect(missing).toMatchObject({
      status: 404,
      body: { type: "urn:awp:problem:not-found", title: "Not Found" },
    });
    expect(missing.body).not.toHaveProperty("detail");
    expect(missing.body).not.toHaveProperty("violatedConstraints");
  });

  it("closes control/order HTTP receipt unions and strips internal replay or witness fields", () => {
    const common = {
      actionId: "00000000-0000-4000-8000-000000000667",
      resourceVersion: 1,
      publicIntentHash: digest("public-intent"),
      requestedAt: "2026-09-03T09:00:00.000Z",
    } as const;
    const consumed = exactQueueActionHttpReceipt({
      ...common,
      actionKind: "QUEUE_CONTROL_ACCEPT",
      state: "CONSUMED",
      approvalRequired: false,
      resultRef: {
        sourceType: "WORK_ITEM_QUEUE_CONTROL_REVISION",
        sourceId: "00000000-0000-4000-8000-000000000668",
        sourceVersion: 2,
        semanticHash: digest("control:2"),
      },
      replayed: true,
      privateWitness: { capacityHeadVersion: 9 },
    } as never);
    expect(consumed).toMatchObject({
      schemaVersion: "queue-action-receipt@1.0.0",
      actionKind: "QUEUE_CONTROL_ACCEPT",
      state: "CONSUMED",
    });
    expect(Object.keys(consumed).sort()).toEqual([
      "actionId",
      "actionKind",
      "approvalRequired",
      "publicIntentHash",
      "requestedAt",
      "resourceVersion",
      "resultRef",
      "schemaVersion",
      "state",
    ]);
    expect(JSON.stringify(consumed)).not.toMatch(/replayed|privateWitness|capacityHead/iu);

    const pending = exactQueueActionHttpReceipt({
      ...common,
      actionKind: "QUEUE_ORDER_OVERRIDE",
      state: "PENDING_APPROVAL",
      approvalRequired: true,
      approvalRef: {
        sourceType: "APPROVAL_SUBJECT_V2",
        sourceId: "00000000-0000-4000-8000-000000000669",
        sourceVersion: 1,
        semanticHash: digest("approval"),
      },
      expiresAt: "2026-09-04T09:00:00.000Z",
    });
    expect(pending).toMatchObject({
      actionKind: "QUEUE_ORDER_OVERRIDE",
      state: "PENDING_APPROVAL",
      approvalRequired: true,
    });
    expect(pending).not.toHaveProperty("resultRef");
    expect(() =>
      exactQueueActionHttpReceipt({
        ...common,
        actionKind: "SERVICE_CLASS_EXPEDITE",
        state: "CONSUMED",
        approvalRequired: false,
        resultRef: {
          sourceType: "WORK_ITEM_QUEUE_CONTROL_REVISION",
          sourceId: "bad",
          sourceVersion: 1,
          semanticHash: digest("bad"),
        },
      }),
    ).toThrow("QUEUE_ACTION_HTTP_RECEIPT_INVALID");
  });
});
