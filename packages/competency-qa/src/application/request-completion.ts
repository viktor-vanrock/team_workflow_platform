import type { JsonValue } from "@awp/platform-contracts";

import type { QaCompletionCandidateAggregate } from "../domain/completion.ts";
import { QaDomainError, type QaWorkspaceContext } from "../domain/primitives.ts";

export interface QaCompletionCommandGatewayPort {
  submit(
    context: QaWorkspaceContext,
    intent: Readonly<{
      clientRequestKey: string;
      commandType: "qa.completion.done";
      capability: Readonly<{
        key: "operational-work-item";
        exactContractVersion: "1.0.0";
        operation: "request.transition";
        logicalRole: "QA_REQUEST_AUTHORITY";
      }>;
      target: JsonValue;
      payload: JsonValue;
      expectedExternalState: JsonValue;
      bindingRef: Readonly<{ id: string; version: number }>;
      profileRef: Readonly<{ id: string; version: number }>;
      dataClassificationKey: string;
      source: Readonly<{ sourceWorkItemId: string }>;
      approvalRequired: true;
    }>,
  ): Promise<
    Readonly<{
      replayed: boolean;
      command: Readonly<{
        id: string;
        approvalId?: string;
        effectIdempotencyKey: string;
        status: string;
      }>;
    }>
  >;
}

export async function requestQaCompletion(
  input: Readonly<{
    context: QaWorkspaceContext;
    candidate: QaCompletionCandidateAggregate;
    authorityScopeKey: string;
    externalEntityId: string;
    dataClassificationKey: string;
    commandGateway: QaCompletionCommandGatewayPort;
    at: string;
  }>,
): Promise<Readonly<{ replayed: boolean; commandId: string; approvalId: string }>> {
  if (
    input.context.actor.kind !== "HUMAN" ||
    input.candidate.initiatedBy.principalId !== input.context.actor.principalId ||
    input.candidate.state !== "CANDIDATE"
  ) {
    throw new QaDomainError("QA_COMPLETION_EXECUTOR_CANDIDATE_REQUIRED");
  }
  if (input.candidate.profileRefs.length !== 1 || input.candidate.profileRefs[0]!.version < 4)
    throw new QaDomainError("QA_COMPLETION_PROFILE_OPERATION_UNAVAILABLE");
  const payload = Object.freeze({
    requestedNormalizedStatus: "DONE",
    expectedExternalVersion: input.candidate.expectedExternalVersion,
    completionSummary: input.candidate.summary,
  });
  const submitted = await input.commandGateway.submit(input.context, {
    clientRequestKey: `qa:completion:${input.candidate.candidateId}:${input.candidate.version}`,
    commandType: "qa.completion.done",
    capability: {
      key: "operational-work-item",
      exactContractVersion: "1.0.0",
      operation: "request.transition",
      logicalRole: "QA_REQUEST_AUTHORITY",
    },
    target: {
      workspaceId: input.candidate.workspaceId,
      projectId: input.candidate.projectId,
      entityKind: "REQUEST",
      authorityScopeKey: input.authorityScopeKey,
      externalEntityId: input.externalEntityId,
    } as unknown as JsonValue,
    payload: payload as unknown as JsonValue,
    expectedExternalState: {
      normalizedStatus: input.candidate.expectedExternalState,
      externalVersion: input.candidate.expectedExternalVersion,
    },
    bindingRef: input.candidate.bindingRef,
    profileRef: input.candidate.profileRefs[0]!,
    dataClassificationKey: input.dataClassificationKey,
    source: { sourceWorkItemId: input.candidate.workItemId },
    approvalRequired: true,
  });
  if (!submitted.command.approvalId) throw new QaDomainError("QA_COMPLETION_APPROVAL_NOT_CREATED");
  input.candidate.awaitApproval({
    approvalId: submitted.command.approvalId,
    subjectHash: input.candidate.contentHash,
    at: input.at,
  });
  return Object.freeze({
    replayed: submitted.replayed,
    commandId: submitted.command.id,
    approvalId: submitted.command.approvalId,
  });
}
