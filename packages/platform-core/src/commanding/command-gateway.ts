import { type JsonValue, sha256 } from "@awp/platform-contracts";

import { createExactApproval } from "../approval/approval.ts";
import type { WriteStageAuditor } from "../audit/write-stage-auditor.ts";
import type { AuthorizedProjectQueryToken } from "../project-onboarding/query-ports.ts";
import type { Clock, IdGenerator, WorkspaceContext } from "../shared/primitives.ts";
import { type ConnectorCommand, validateConnectorCommandSnapshot } from "./connector-command.ts";
import type { ClientRequestIdentity, CommandGatewayUnitOfWork } from "./idempotency.ts";

export interface CommandIntent {
  readonly clientRequestKey: string;
  readonly commandType: string;
  readonly capability: Readonly<{
    key: string;
    exactContractVersion: string;
    operation: string;
    logicalRole: string;
  }>;
  readonly target: JsonValue;
  readonly payload: JsonValue;
  readonly expectedExternalState: JsonValue;
  readonly bindingRef: Readonly<{ id: string; version: number }>;
  readonly profileRef: Readonly<{ id: string; version: number }>;
  readonly dataClassificationKey: string;
  readonly source: Readonly<{
    intakeDraftId?: string;
    confirmationVersion?: number;
    sourceWorkItemId?: string;
    intakeCandidateId?: string;
    agentRunId?: string;
    notificationIntentId?: string;
  }>;
  readonly recoveryPolicy?: "SAFE_RETRY" | "LOOKUP_REQUIRED" | "NONE_AMBIGUOUS";
  readonly approvalRequired?: boolean;
}

/** Reauthorizes a durable command after dequeue and immediately before its provider effect. */
export async function executeAuthorizedConnectorCommand<TResult>(
  command: Pick<ConnectorCommand, "workspaceId" | "projectId" | "dataClassificationKey">,
  classificationRank: number,
  reauthorize: () => Promise<AuthorizedProjectQueryToken>,
  effect: () => Promise<TResult>,
): Promise<TResult> {
  const token = await reauthorize();
  if (
    token.workspaceId !== command.workspaceId ||
    !token.allows(command.projectId, classificationRank, "EFFECT")
  ) {
    throw new Error("CONNECTOR_COMMAND_AUTHORIZATION_REVOKED");
  }
  return effect();
}
export class CommandGateway {
  constructor(
    private readonly unitOfWork: CommandGatewayUnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly stageAudit?: WriteStageAuditor,
  ) {}
  async submit(
    context: WorkspaceContext,
    intent: CommandIntent,
  ): Promise<Readonly<{ command: ConnectorCommand; replayed: boolean }>> {
    if (context.scope.kind !== "PROJECT" || context.authorizationBasis?.kind !== "PROJECT")
      throw new Error("PROJECT_AUTHORIZATION_BASIS_REQUIRED");
    const sourceCount = [
      intent.source.intakeDraftId,
      intent.source.sourceWorkItemId,
      intent.source.intakeCandidateId,
      intent.source.agentRunId,
      intent.source.notificationIntentId,
    ].filter(Boolean).length;
    if (sourceCount !== 1) throw new Error("COMMAND_SOURCE_EXACTLY_ONE_REQUIRED");
    const requestHash = sha256({
      commandType: intent.commandType,
      capability: intent.capability,
      target: intent.target,
      payload: intent.payload,
      expectedExternalState: intent.expectedExternalState,
      bindingRef: intent.bindingRef,
      profileRef: intent.profileRef,
      dataClassificationKey: intent.dataClassificationKey,
      source: intent.source,
    } as JsonValue);
    const identity: ClientRequestIdentity = {
      workspaceId: context.scope.workspaceId,
      projectId: context.scope.projectId,
      actorId: context.actor.principalId,
      operation: intent.commandType,
      clientKey: intent.clientRequestKey,
    };
    const existing = await this.unitOfWork.find(identity);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new Error("IDEMPOTENCY_KEY_CONFLICT");
      const command = await this.unitOfWork.command(
        identity.workspaceId,
        identity.projectId,
        existing.commandId,
      );
      if (!command) throw new Error("IDEMPOTENCY_RESULT_COMMAND_NOT_FOUND");
      return Object.freeze({ command, replayed: true });
    }
    const now = this.clock.now();
    const id = this.ids.next();
    const approvalId = intent.approvalRequired ? this.ids.next() : undefined;
    const command: ConnectorCommand = {
      id,
      workspaceId: context.scope.workspaceId,
      projectId: context.scope.projectId,
      actor: context.actor,
      commandType: intent.commandType,
      capability: intent.capability,
      target: intent.target,
      targetHash: sha256(intent.target),
      payload: intent.payload,
      payloadHash: sha256(intent.payload),
      expectedExternalState: intent.expectedExternalState,
      bindingRef: intent.bindingRef,
      profileRef: intent.profileRef,
      clientRequestKey: intent.clientRequestKey,
      effectIdempotencyKey: `awp:effect:${id}`,
      dataClassificationKey: intent.dataClassificationKey,
      initialAuthorizationBasis: context.authorizationBasis,
      initialAuthorizationBasisHash: sha256(context.authorizationBasis as unknown as JsonValue),
      correlationId: context.correlationId,
      causationId: context.causationId,
      source: intent.source,
      ...(intent.recoveryPolicy ? { recoveryPolicy: intent.recoveryPolicy } : {}),
      status: intent.approvalRequired ? "AWAITING_APPROVAL" : "QUEUED",
      effectAuthorizationStatus: intent.approvalRequired ? "PENDING" : "NOT_REQUIRED",
      outboxStatus: intent.approvalRequired ? "HELD" : "READY",
      ...(approvalId ? { approvalId } : {}),
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
      rowVersion: 1,
    };
    validateConnectorCommandSnapshot(command);
    const approval = approvalId
      ? createExactApproval({
          id: approvalId,
          workspaceId: context.scope.workspaceId,
          projectId: context.scope.projectId,
          initiatorId: context.actor.principalId,
          initiator: context.actor,
          action: {
            actionKind: "EXTERNAL_COMMAND",
            actionId: id,
            commandType: command.commandType,
            capabilityKey: command.capability.key,
            capabilityVersion: command.capability.exactContractVersion,
            operation: command.capability.operation,
          },
          target: command.target,
          targetHash: command.targetHash,
          payloadHash: command.payloadHash,
          expectedState: command.expectedExternalState,
          bindingRef: command.bindingRef,
          profileRefs: [command.profileRef],
          requiredPermission: "connector.effect.approve",
          separationOfDutyPolicy: "SELF_APPROVAL_FORBIDDEN",
          effectIdempotencyKey: command.effectIdempotencyKey,
          expiresAt: new Date(now.getTime() + 15 * 60_000),
          createdAt: now,
        })
      : undefined;
    try {
      await this.unitOfWork.commit({
        command,
        idempotency: { ...identity, requestHash, commandId: id, createdAt: now },
        mutation: { commandId: id, source: intent.source },
        audit: { action: intent.commandType, commandId: id, outcome: "ACCEPTED" },
        outbox: { commandId: id, state: command.outboxStatus },
        ...(approval ? { approval } : {}),
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "IDEMPOTENCY_CONCURRENT_CLAIM")
        throw error;
      const winner = await this.unitOfWork.find(identity);
      if (!winner) throw error;
      if (winner.requestHash !== requestHash) throw new Error("IDEMPOTENCY_KEY_CONFLICT");
      const winnerCommand = await this.unitOfWork.command(
        identity.workspaceId,
        identity.projectId,
        winner.commandId,
      );
      if (!winnerCommand) throw new Error("IDEMPOTENCY_RESULT_COMMAND_NOT_FOUND");
      return Object.freeze({ command: winnerCommand, replayed: true });
    }
    await this.stageAudit?.record({
      stage: "GATEWAY",
      workspaceId: command.workspaceId,
      projectId: command.projectId,
      action: command.commandType,
      initialAuthorizationBasis: command.initialAuthorizationBasis,
      bindingRef: command.bindingRef,
      profileRef: command.profileRef,
      resultCode: "ACCEPTED",
      reasonCode: "COMMAND_ACCEPTED",
      attributes: { commandId: command.id },
    });
    return Object.freeze({ command: structuredClone(command), replayed: false });
  }
}
