import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { designContractRegistry } from "../../packages/platform-contracts/src/index.ts";
import {
  validateApprovalSnapshot,
  validateConnectorCommandSnapshot,
} from "../../packages/platform-core/src/index.ts";

const root = resolve(import.meta.dirname, "../..");
const commandSchema = "urn:awp:contracts:commands:external-command-envelope:v1";
const approvalSchema = "urn:awp:contracts:commands:approval-subject:v1";
function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("AT-017 public command/Approval state boundaries", () => {
  it("round-trips the positive public fixtures", async () => {
    const command = JSON.parse(
      await readFile(
        resolve(
          root,
          "specs/001-extension-kernel-local-skeleton/contracts/examples/commands/sample-external-command.json",
        ),
        "utf8",
      ),
    );
    const approval = JSON.parse(
      await readFile(
        resolve(
          root,
          "specs/001-extension-kernel-local-skeleton/contracts/examples/commands/sample-approval.json",
        ),
        "utf8",
      ),
    );
    expect(() =>
      designContractRegistry.validateById(commandSchema, JSON.parse(JSON.stringify(command))),
    ).not.toThrow();
    expect(() =>
      designContractRegistry.validateById(approvalSchema, JSON.parse(JSON.stringify(approval))),
    ).not.toThrow();
  });

  it("rejects the full negative command matrix after public JSON serialization", async () => {
    const positive = JSON.parse(
      await readFile(
        resolve(
          root,
          "specs/001-extension-kernel-local-skeleton/contracts/examples/commands/sample-external-command.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const failedResult = {
      schemaVersion: 1,
      outcome: "FAILED",
      completedAt: "2026-08-27T10:22:00Z",
      error: { code: "DENIED", retryClass: "FINAL" },
    };
    const cases: Array<readonly [string, (value: Record<string, unknown>) => void]> = [
      [
        "CONFIRMED+HELD",
        (value) => {
          value.outboxStatus = "HELD";
        },
      ],
      [
        "CONFIRMED+PENDING",
        (value) => {
          value.effectAuthorizationStatus = "PENDING";
        },
      ],
      [
        "AWAITING_APPROVAL+CONSUMED",
        (value) => {
          value.status = "AWAITING_APPROVAL";
          value.effectAuthorizationStatus = "CONSUMED";
          value.outboxStatus = "HELD";
          delete value.terminalResult;
        },
      ],
      [
        "invocation without ALLOWED",
        (value) => {
          value.effectGateDecision = "DENIED";
          value.effectGateReasonCode = "POLICY_DENIED";
          value.status = "FAILED";
          value.effectAuthorizationStatus = "INVALIDATED";
          value.outboxStatus = "DEAD";
          value.terminalResult = failedResult;
        },
      ],
      [
        "DENIED without reason",
        (value) => {
          value.effectGateDecision = "DENIED";
          delete value.effectGateReasonCode;
          delete value.effectInvocationStartedAt;
          value.status = "FAILED";
          value.effectAuthorizationStatus = "INVALIDATED";
          value.outboxStatus = "DEAD";
          value.terminalResult = failedResult;
        },
      ],
      [
        "INVALIDATED without denied basis",
        (value) => {
          value.status = "FAILED";
          value.effectAuthorizationStatus = "INVALIDATED";
          value.outboxStatus = "DEAD";
          value.terminalResult = failedResult;
          delete value.effectGateEvaluatedAt;
          delete value.effectGateDecision;
          delete value.effectGateReasonCode;
          delete value.effectAuthorizationBasis;
          delete value.effectAuthorizationBasisHash;
          delete value.effectInvocationStartedAt;
        },
      ],
      [
        "non-terminal DEAD",
        (value) => {
          value.status = "QUEUED";
          value.effectAuthorizationStatus = "NOT_REQUIRED";
          value.outboxStatus = "DEAD";
          delete value.approvalId;
          delete value.terminalResult;
          delete value.effectInvocationStartedAt;
          delete value.effectGateEvaluatedAt;
          delete value.effectGateDecision;
          delete value.effectAuthorizationBasis;
          delete value.effectAuthorizationBasisHash;
        },
      ],
      [
        "terminal outcome mismatch",
        (value) => {
          value.status = "FAILED";
          value.effectAuthorizationStatus = "CONSUMED";
          value.outboxStatus = "ACKNOWLEDGED";
        },
      ],
    ];
    for (const [name, mutate] of cases) {
      const value = clone(positive);
      mutate(value);
      const serialized = JSON.parse(JSON.stringify(value));
      expect(() => designContractRegistry.validateById(commandSchema, serialized), name).toThrow();
      expect(
        () =>
          validateConnectorCommandSnapshot({
            status: value.status as never,
            effectAuthorizationStatus: value.effectAuthorizationStatus as never,
            outboxStatus: value.outboxStatus as never,
            terminalResult: value.terminalResult as never,
            effectInvocationStartedAt: value.effectInvocationStartedAt
              ? new Date(String(value.effectInvocationStartedAt))
              : undefined,
            effectGateDecision: value.effectGateDecision as never,
            effectGateReasonCode: value.effectGateReasonCode as string | undefined,
          } as unknown as Parameters<typeof validateConnectorCommandSnapshot>[0]),
        name,
      ).toThrow();
    }
  });

  it("rejects negative Approval pairs through both public and domain validators", async () => {
    const positive = JSON.parse(
      await readFile(
        resolve(
          root,
          "specs/001-extension-kernel-local-skeleton/contracts/examples/commands/sample-approval.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const cases = [
      { ...clone(positive), decisionStatus: "PENDING", effectAuthorizationStatus: "CONSUMED" },
      {
        ...clone(positive),
        decisionStatus: "APPROVED",
        effectAuthorizationStatus: "AUTHORIZED",
        decision: undefined,
      },
      {
        ...clone(positive),
        decisionStatus: "APPROVED",
        effectAuthorizationStatus: "INVALIDATED",
        invalidationReason: undefined,
        invalidatedAt: undefined,
      },
    ];
    for (const value of cases) {
      const serialized = JSON.parse(JSON.stringify(value));
      expect(() => designContractRegistry.validateById(approvalSchema, serialized)).toThrow();
      expect(() => validateApprovalSnapshot(serialized as never)).toThrow();
    }
  });
});
