import { type JsonValue, sha256 } from "@awp/platform-contracts";
import type { ConnectorCommand } from "@awp/platform-core";

export type DeadLetterEligibility =
  | "ELIGIBLE"
  | "EXPIRED"
  | "COMMAND_CHANGED"
  | "RECONCILIATION_REQUIRED"
  | "AUTHORIZATION_INVALIDATED"
  | "NOT_RETRYABLE"
  | "REPLAY_BUDGET_EXHAUSTED"
  | "NO_LONGER_DEAD";
export function deadLetterCommandHash(c: ConnectorCommand): `sha256:${string}` {
  return sha256({
    id: c.id,
    workspaceId: c.workspaceId,
    projectId: c.projectId,
    actor: c.actor,
    commandType: c.commandType,
    capability: c.capability,
    target: c.target,
    targetHash: c.targetHash,
    payload: c.payload,
    payloadHash: c.payloadHash,
    expectedExternalState: c.expectedExternalState,
    bindingRef: c.bindingRef,
    profileRef: c.profileRef,
    clientRequestKey: c.clientRequestKey,
    effectIdempotencyKey: c.effectIdempotencyKey,
    dataClassificationKey: c.dataClassificationKey,
    initialAuthorizationBasis: c.initialAuthorizationBasis,
    initialAuthorizationBasisHash: c.initialAuthorizationBasisHash,
    source: c.source,
    recoveryPolicy: c.recoveryPolicy ?? null,
    approvalId: c.approvalId ?? null,
    createdAt: c.createdAt.toISOString(),
    correlationId: c.correlationId,
    causationId: c.causationId,
  } as unknown as JsonValue);
}
const transport =
  /^(?:(?:JIRA|GITLAB|MATTERMOST)_(?:NETWORK_ERROR|TIMEOUT|HTTP_(?:401|403|408|429|500|502|503|504))|HTTP_(?:401|403|408|429|500|502|503|504)|RETRY_BUDGET_EXHAUSTED|RETRY_WINDOW_EXHAUSTED)$/u;
export function safeDeadLetterReason(command: ConnectorCommand): string {
  const code = command.terminalResult?.code;
  return code && transport.test(code) ? code : "COMMAND_REQUIRES_INVESTIGATION";
}
export function assessDeadLetterReplay(
  command: ConnectorCommand,
  input: Readonly<{
    originalHash: string;
    now: number;
    expiresAt: number;
    replayCount: number;
    maximumReplays: number;
  }>,
): DeadLetterEligibility {
  if (
    deadLetterCommandHash(command) !== input.originalHash ||
    sha256(command.payload as JsonValue) !== command.payloadHash ||
    sha256(command.target as JsonValue) !== command.targetHash
  )
    return "COMMAND_CHANGED";
  if (command.effectInvocationStartedAt) return "RECONCILIATION_REQUIRED";
  if (command.effectAuthorizationStatus === "INVALIDATED") return "AUTHORIZATION_INVALIDATED";
  if (command.status !== "FAILED" || command.outboxStatus !== "DEAD")
    return command.status === "CONFLICT" ? "NOT_RETRYABLE" : "NO_LONGER_DEAD";
  if (
    !Number.isFinite(input.now) ||
    !Number.isFinite(input.expiresAt) ||
    input.now >= input.expiresAt
  )
    return "EXPIRED";
  if (
    !Number.isSafeInteger(input.replayCount) ||
    input.replayCount < 0 ||
    !Number.isSafeInteger(input.maximumReplays) ||
    input.maximumReplays < 1 ||
    input.replayCount >= input.maximumReplays
  )
    return "REPLAY_BUDGET_EXHAUSTED";
  if (
    !transport.test(command.terminalResult?.code ?? "") ||
    !["NOT_REQUIRED", "CONSUMED"].includes(command.effectAuthorizationStatus)
  )
    return "NOT_RETRYABLE";
  return "ELIGIBLE";
}
