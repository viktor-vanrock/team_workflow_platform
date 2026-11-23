import { QaDomainError, type QaHumanActor } from "../domain/primitives.ts";
import type { QaScopeSnapshot, QaTargetSnapshot } from "../domain/snapshots.ts";
import { createPlannedTestSession, type QaTestSession } from "../domain/test-session.ts";

export function createLinkedReplacementSession(
  input: Readonly<{
    original: QaTestSession;
    id: string;
    ordinal: number;
    targetSnapshot: QaTargetSnapshot;
    scopeSnapshot: QaScopeSnapshot;
    ownerId?: string;
    actor: QaHumanActor;
    createdAt: string;
  }>,
): QaTestSession {
  if (!input.original.startedAt)
    throw new QaDomainError("QA_LINKED_SESSION_REQUIRES_LOCKED_ORIGINAL");
  return createPlannedTestSession({
    id: input.id,
    workspaceId: input.original.workspaceId,
    projectId: input.original.projectId,
    workItemId: input.original.workItemId,
    ordinal: input.ordinal,
    parentSessionId: input.original.id,
    planRevisionRef: input.original.planRevisionRef,
    requirementRef: input.original.requirementRef,
    ownerId: input.ownerId ?? input.original.ownerId,
    requiredCapabilities: input.original.requiredCapabilities,
    targetSnapshot: input.targetSnapshot,
    scopeSnapshot: input.scopeSnapshot,
    createdBy: input.actor,
    createdAt: input.createdAt,
  });
}
