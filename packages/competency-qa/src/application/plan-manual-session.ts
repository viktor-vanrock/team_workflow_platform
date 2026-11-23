import { QaDomainError, type QaHumanActor } from "../domain/primitives.ts";
import type { QaRequiredSessionPlanRevision } from "../domain/required-session-plan.ts";
import type { QaScopeSnapshot, QaTargetSnapshot } from "../domain/snapshots.ts";
import { createPlannedTestSession, type QaTestSession } from "../domain/test-session.ts";

export function planManualSession(
  input: Readonly<{
    id: string;
    plan: QaRequiredSessionPlanRevision;
    requirementKey: string;
    confirmedOperationalReady: boolean;
    existingSessions: readonly QaTestSession[];
    parentSessionId?: string;
    ownerId: string;
    targetSnapshot: QaTargetSnapshot;
    scopeSnapshot: QaScopeSnapshot;
    actor: QaHumanActor;
    createdAt: string;
  }>,
): QaTestSession {
  if (!input.confirmedOperationalReady)
    throw new QaDomainError("QA_SESSION_REQUIRES_CONFIRMED_READY");
  const requirement = input.plan.requirements.find(
    (candidate) => candidate.requirementKey === input.requirementKey,
  );
  if (!requirement || requirement.resolution !== "REQUIRED" || requirement.mode !== "MANUAL")
    throw new QaDomainError("QA_SESSION_REQUIREMENT_INVALID");
  if (input.parentSessionId) {
    const parent = input.existingSessions.find(({ id }) => id === input.parentSessionId);
    if (
      !parent ||
      parent.workspaceId !== input.plan.workspaceId ||
      parent.projectId !== input.plan.projectId ||
      parent.workItemId !== input.plan.workItemId ||
      parent.requirementRef.requirementKey !== requirement.requirementKey
    )
      throw new QaDomainError("QA_SESSION_PARENT_SCOPE_MISMATCH");
  }
  const ordinal = Math.max(0, ...input.existingSessions.map((session) => session.ordinal)) + 1;
  return createPlannedTestSession({
    id: input.id,
    workspaceId: input.plan.workspaceId,
    projectId: input.plan.projectId,
    workItemId: input.plan.workItemId,
    ordinal,
    ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
    planRevisionRef: {
      id: input.plan.id,
      version: input.plan.version,
      contentHash: input.plan.contentHash,
    },
    requirementRef: {
      id: requirement.id,
      version: input.plan.version,
      contentHash: requirement.contentHash,
      requirementKey: requirement.requirementKey,
      ordinal: requirement.ordinal,
    },
    ownerId: input.ownerId,
    requiredCapabilities: requirement.requiredCapabilities,
    targetSnapshot: input.targetSnapshot,
    scopeSnapshot: input.scopeSnapshot,
    createdBy: input.actor,
    createdAt: input.createdAt,
  });
}
