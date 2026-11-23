import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
} from "../domain/primitives.ts";
import type { QaReadyTransitionCandidate } from "./confirm-readiness.ts";

export interface QaOperationalReadyTransition {
  readonly commandId: string;
  readonly effectIdempotencyKey: string;
  readonly scope: Readonly<{ workspaceId: string; projectId: string }>;
  readonly target: Readonly<{
    workspaceId: string;
    projectId: string;
    entityKind: "REQUEST";
    authorityScopeKey: string;
    externalEntityId: string;
  }>;
  readonly payload: Readonly<{
    requestedNormalizedStatus: "READY";
    expectedExternalVersion: string;
  }>;
  readonly bindingRef: Readonly<{ id: string; version: number }>;
  readonly profileRef: Readonly<{ id: string; version: number }>;
  readonly readinessCandidateRef: Readonly<{ id: string; contentHash: QaContentHash }>;
  readonly contentHash: QaContentHash;
}

export function buildReadyTransition(
  input: Readonly<{
    commandId: string;
    effectIdempotencyKey: string;
    scope: { workspaceId: string; projectId: string };
    authorityScopeKey: string;
    externalRequestId: string;
    expectedExternalVersion: string;
    bindingRef: { id: string; version: number };
    profileRef: { id: string; version: number };
    candidate: QaReadyTransitionCandidate;
  }>,
): QaOperationalReadyTransition {
  if (input.profileRef.version < 2 || input.bindingRef.version < 2)
    throw new QaDomainError("QA_READY_TRANSITION_PROFILE_OPERATION_UNAVAILABLE");
  if (!input.externalRequestId || !input.expectedExternalVersion)
    throw new QaDomainError("QA_READY_TRANSITION_TARGET_INVALID");
  const body = Object.freeze({
    commandId: input.commandId,
    effectIdempotencyKey: input.effectIdempotencyKey,
    scope: structuredClone(input.scope),
    target: {
      ...structuredClone(input.scope),
      entityKind: "REQUEST" as const,
      authorityScopeKey: input.authorityScopeKey,
      externalEntityId: input.externalRequestId,
    },
    payload: {
      requestedNormalizedStatus: "READY" as const,
      expectedExternalVersion: input.expectedExternalVersion,
    },
    bindingRef: structuredClone(input.bindingRef),
    profileRef: structuredClone(input.profileRef),
    readinessCandidateRef: { id: input.candidate.id, contentHash: input.candidate.contentHash },
  });
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}
