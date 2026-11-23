import {
  type ExternalCommandLifecycleUnitOfWork,
  type JsonValue,
  type PackOwnedTransaction,
  type ScopedExternalCommandContext,
  sha256,
} from "@awp/platform-contracts";

import {
  type ConnectorCommand,
  validateConnectorCommandSnapshot,
} from "../commanding/connector-command.ts";
import { type Approval, decideApproval, validateApprovalSnapshot } from "./approval.ts";

type ApprovalDecisionInput = Parameters<typeof decideApproval>[1];
export type ExternalCommandApprovalResult = Readonly<{
  command: ConnectorCommand;
  approval: Approval;
}>;

export function createOperationalActionApprovalSubject(
  input: Readonly<{
    commandId: string;
    operation: string;
    expectedState: Readonly<Record<string, unknown>>;
    pins: readonly Readonly<{ sequence: number; contentHash: string }>[];
    expiresAt: string;
  }>,
): `sha256:${string}` {
  const pins = [...input.pins].sort((left, right) => left.sequence - right.sequence);
  if (pins.some((pin, index) => pin.sequence !== index))
    throw new Error("APPROVAL_CONFIGURATION_PIN_SEQUENCE_INVALID");
  return sha256({ ...input, pins } as unknown as JsonValue);
}

export function externalCommandLifecycleContext(
  command: ConnectorCommand,
): ScopedExternalCommandContext {
  return {
    workspaceId: command.workspaceId,
    projectId: command.projectId,
    commandId: command.id,
    commandType: command.commandType,
    capabilityKey: command.capability.key,
    capabilityVersion: command.capability.exactContractVersion,
    operation: command.capability.operation,
    source: command.source,
    bindingRef: command.bindingRef,
    profileRefs: [command.profileRef],
    effectIdempotencyKey: command.effectIdempotencyKey,
    correlationId: command.correlationId,
    causationId: command.causationId,
    ...(command.approvalId ? { approvalId: command.approvalId } : {}),
    commandResourceVersion: command.rowVersion,
  };
}

export function approveExternalCommand(
  command: ConnectorCommand,
  approval: Approval,
  input: ApprovalDecisionInput,
): ExternalCommandApprovalResult {
  if (command.status !== "AWAITING_APPROVAL" || command.outboxStatus !== "HELD")
    throw new Error("COMMAND_NOT_HELD");
  const decided = decideApproval(approval, input);
  const released: ConnectorCommand = {
    ...command,
    status: "QUEUED",
    effectAuthorizationStatus: "AUTHORIZED",
    outboxStatus: "READY",
    rowVersion: command.rowVersion + 1,
    updatedAt: input.now ?? new Date(),
  };
  validateConnectorCommandSnapshot(released);
  return Object.freeze({ command: released, approval: decided });
}

function rejectExternalCommand(
  command: ConnectorCommand,
  approval: Approval,
  input: ApprovalDecisionInput,
): ExternalCommandApprovalResult {
  if (command.status !== "AWAITING_APPROVAL" || command.outboxStatus !== "HELD")
    throw new Error("COMMAND_NOT_HELD");
  if (approval.decisionStatus !== "PENDING") throw new Error("APPROVAL_ALREADY_DECIDED");
  if (
    approval.separationOfDutyPolicy === "SELF_APPROVAL_FORBIDDEN" &&
    approval.initiatorId === input.approverId
  )
    throw new Error("SELF_APPROVAL_FORBIDDEN");
  const now = input.now ?? new Date();
  const decision = {
    approverId: input.approverId,
    approverRole: input.approverRole,
    authorizationBasisHash: input.authorizationBasisHash,
    ...(input.authorizationBasis ? { authorizationBasis: input.authorizationBasis } : {}),
    decidedAt: now,
  };
  const rejectedApproval: Approval = {
    ...approval,
    decisionStatus: "REJECTED",
    effectAuthorizationStatus: "NOT_AUTHORIZED",
    decision,
    resourceVersion: approval.resourceVersion + 1,
  };
  const rejectedCommand: ConnectorCommand = {
    ...command,
    status: "CANCELLED",
    effectAuthorizationStatus: "INVALIDATED",
    outboxStatus: "DEAD",
    effectGateEvaluatedAt: now,
    effectGateDecision: "DENIED",
    effectGateReasonCode: "APPROVAL_REJECTED",
    effectAuthorizationBasis: command.initialAuthorizationBasis,
    effectAuthorizationBasisHash: command.initialAuthorizationBasisHash,
    rowVersion: command.rowVersion + 1,
    updatedAt: now,
  };
  validateApprovalSnapshot(rejectedApproval);
  validateConnectorCommandSnapshot(rejectedCommand);
  return Object.freeze({ command: rejectedCommand, approval: rejectedApproval });
}

export async function decideExternalCommandApproval(
  input: Readonly<{
    command: ConnectorCommand;
    approval: Approval;
    decision: "APPROVE" | "REJECT";
    actor: ApprovalDecisionInput;
    lifecycle: ExternalCommandLifecycleUnitOfWork;
    persist?: (
      transaction: PackOwnedTransaction,
      result: ExternalCommandApprovalResult,
    ) => Promise<void>;
  }>,
): Promise<ExternalCommandApprovalResult> {
  const phase = input.decision === "APPROVE" ? "APPROVAL_RELEASED" : "APPROVAL_REJECTED";
  const completed = await input.lifecycle.execute(
    phase,
    externalCommandLifecycleContext(input.command),
    async (transaction) => {
      const result =
        input.decision === "APPROVE"
          ? approveExternalCommand(input.command, input.approval, input.actor)
          : rejectExternalCommand(input.command, input.approval, input.actor);
      await input.persist?.(transaction, result);
      return result;
    },
  );
  return completed.result;
}
