import { describe, expect, it } from "vitest";

import { validateApprovalSnapshot } from "../../../packages/platform-core/src/approval/approval.ts";
import { validateConnectorCommandSnapshot } from "../../../packages/platform-core/src/commanding/connector-command.ts";

// These fixtures deliberately violate the domain snapshot type.
const command = {
  status: "QUEUED",
  effectAuthorizationStatus: "NOT_REQUIRED",
  outboxStatus: "READY",
  terminalResult: undefined,
  effectInvocationStartedAt: undefined,
  effectGateDecision: undefined,
  effectGateReasonCode: undefined,
} as const;
describe("AT-017 command/Approval state matrix", () => {
  it.each([
    [
      {
        ...command,
        status: "AWAITING_APPROVAL",
        effectAuthorizationStatus: "PENDING",
        outboxStatus: "READY",
      },
      "AWAITING_APPROVAL_REQUIRES_HELD_OUTBOX",
    ],
    [
      {
        ...command,
        status: "CONFIRMED",
        outboxStatus: "ACKNOWLEDGED",
        terminalResult: { outcome: "FAILED" },
      },
      "CONFIRMED_REQUIRES_SUCCESS_RESULT",
    ],
    [
      {
        ...command,
        status: "FAILED",
        outboxStatus: "DEAD",
        terminalResult: { outcome: "SUCCEEDED" },
      },
      "FAILED_REJECTS_SUCCESS_RESULT",
    ],
    [
      {
        ...command,
        status: "FAILED",
        outboxStatus: "DEAD",
        effectGateDecision: "DENIED",
        effectInvocationStartedAt: new Date(),
      },
      "DENIED_EFFECT_MUST_NOT_START",
    ],
  ] as const)("rejects invalid command snapshot", (snapshot, code) => {
    expect(() =>
      validateConnectorCommandSnapshot(
        snapshot as unknown as Parameters<typeof validateConnectorCommandSnapshot>[0],
      ),
    ).toThrow(code);
  });
  it.each([
    [
      { decisionStatus: "APPROVED", effectAuthorizationStatus: "AUTHORIZED" },
      "APPROVED_REQUIRES_DECISION",
    ],
    [
      { decisionStatus: "PENDING", effectAuthorizationStatus: "CONSUMED", consumedAt: new Date() },
      "NON_APPROVED_EFFECT_NOT_AUTHORIZED",
    ],
    [
      {
        decisionStatus: "APPROVED",
        effectAuthorizationStatus: "INVALIDATED",
        decision: {},
        invalidationReason: undefined,
      },
      "INVALIDATED_REQUIRES_REASON",
    ],
  ] as const)("rejects invalid Approval snapshot", (snapshot, code) => {
    expect(() =>
      validateApprovalSnapshot(
        snapshot as unknown as Parameters<typeof validateApprovalSnapshot>[0],
      ),
    ).toThrow(code);
  });
});
