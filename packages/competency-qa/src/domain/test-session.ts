import type { QaAutomatedPlanItem } from "./plan-item.ts";
import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaExactReference,
  type QaHumanActor,
} from "./primitives.ts";
import type { QaScopeSnapshot, QaTargetSnapshot } from "./snapshots.ts";

export type QaTestSessionState =
  "PLANNED" | "READY" | "RUNNING" | "REVIEW_REQUIRED" | "COMPLETED" | "BLOCKED" | "CANCELLED";
export type QaSessionMilestone = "PLANNED" | "READY" | "RUNNING" | "REVIEW_REQUIRED";

export interface QaTestSession {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly ordinal: number;
  readonly parentSessionId?: string;
  readonly mode: "MANUAL";
  readonly planRevisionRef: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
  readonly requirementRef: Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
    requirementKey: string;
    ordinal?: number;
  }>;
  readonly ownerId: string;
  readonly requiredCapabilities: readonly string[];
  readonly targetSnapshot: QaTargetSnapshot;
  readonly scopeSnapshot: QaScopeSnapshot;
  readonly planItemSetHash: QaContentHash;
  readonly state: QaTestSessionState;
  readonly structureRevision: number;
  readonly structureHash: QaContentHash;
  readonly readyAgainstStructureHash: QaContentHash | null;
  readonly resourceVersion: number;
  readonly createdBy: QaHumanActor;
  readonly createdAt: string;
  readonly readyAt?: string;
  readonly startedAt?: string;
  readonly blockedAt?: string;
  readonly cancelledAt?: string;
  readonly completedAt?: string;
  readonly latestSessionReviewId?: string;
  readonly sessionOutcome?: "PASSED" | "FAILED" | "BLOCKED" | "INCONCLUSIVE";
  readonly adjudicativeManifestRevisionId?: string;
  readonly blockedFrom?: QaSessionMilestone;
  readonly cancelledFrom?: QaSessionMilestone;
  readonly stateReason?: string;
  readonly resetReason?: "STRUCTURE_CHANGED";
  readonly previousStructureHash?: QaContentHash;
  readonly previousStructureState?: "PLANNED" | "READY";
  readonly previousReadyAgainstStructureHash?: QaContentHash;
  readonly lastTransitionActor?: QaHumanActor;
  readonly readyBy?: QaHumanActor;
  readonly startedBy?: QaHumanActor;
}

export interface QaAutomatedTestSession {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly ordinal: number;
  readonly parentSessionId?: string;
  readonly replacement?: Readonly<{
    reason: "TARGET_CHANGED" | "REVIEW_FROZEN";
    priorTargetSnapshotHash: QaContentHash;
  }>;
  readonly mode: "AUTOMATED";
  readonly state: "READY";
  readonly executionActivity: "IDLE";
  readonly planRevisionRef: QaExactReference;
  readonly requirementRef: QaExactReference & Readonly<{ requirementKey: string }>;
  readonly ownerId: string;
  readonly requiredCapabilities: readonly string[];
  readonly suiteBindingRef: QaExactReference;
  readonly configurationPinSetHash: QaContentHash;
  readonly parameterSetHash: QaContentHash;
  readonly targetSnapshotRef: string;
  readonly targetSnapshotHash: QaContentHash;
  readonly scopeSnapshotRef: string;
  readonly scopeSnapshotHash: QaContentHash;
  readonly planItemId: string;
  readonly planItemSetHash: QaContentHash;
  readonly structureRevision: 1;
  readonly structureHash: QaContentHash;
  readonly readyAgainstStructureHash: QaContentHash;
  readonly resourceVersion: 1;
  readonly createdBy: QaHumanActor;
  readonly createdAt: string;
  readonly readyAt: string;
}

type QaAutomatedTestSessionInput = Omit<
  QaAutomatedTestSession,
  | "schemaVersion"
  | "mode"
  | "state"
  | "executionActivity"
  | "planItemId"
  | "planItemSetHash"
  | "structureRevision"
  | "structureHash"
  | "readyAgainstStructureHash"
  | "resourceVersion"
  | "readyAt"
> &
  Readonly<{ planItems: readonly QaAutomatedPlanItem[] }>;

function validHash(value: string): value is QaContentHash {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}

export function createPlannedAutomatedTestSession(
  input: QaAutomatedTestSessionInput,
): QaAutomatedTestSession {
  if (input.planItems.length !== 1)
    throw new QaDomainError("QA_AUTOMATED_SESSION_EXACTLY_ONE_PLAN_ITEM_REQUIRED");
  const item = input.planItems[0]!;
  if (
    [
      input.id,
      input.workspaceId,
      input.projectId,
      input.workItemId,
      input.ownerId,
      input.targetSnapshotRef,
      input.scopeSnapshotRef,
    ].some((value) => !value) ||
    !Number.isInteger(input.ordinal) ||
    input.ordinal < 1 ||
    input.requiredCapabilities.length !== 3 ||
    ![
      input.suiteBindingRef.contentHash,
      input.configurationPinSetHash,
      input.parameterSetHash,
      input.targetSnapshotHash,
      input.scopeSnapshotHash,
    ].every(validHash) ||
    item.sessionId !== input.id ||
    item.workspaceId !== input.workspaceId ||
    item.projectId !== input.projectId ||
    item.workItemId !== input.workItemId ||
    item.suiteBindingRef.id !== input.suiteBindingRef.id ||
    item.suiteBindingRef.version !== input.suiteBindingRef.version ||
    item.suiteBindingRef.contentHash !== input.suiteBindingRef.contentHash ||
    item.targetSnapshotHash !== input.targetSnapshotHash ||
    item.scopeSnapshotHash !== input.scopeSnapshotHash ||
    input.createdBy.kind !== "HUMAN" ||
    Number.isNaN(Date.parse(input.createdAt)) ||
    (input.parentSessionId === undefined) !== (input.replacement === undefined) ||
    (input.replacement !== undefined && !validHash(input.replacement.priorTargetSnapshotHash))
  )
    throw new QaDomainError("QA_AUTOMATED_SESSION_INVALID");
  const planItemSetHash = qaAggregateSnapshotHash([
    { id: item.id, contentHash: item.contentHash },
  ] as never);
  const structural = Object.freeze({
    ownerId: input.ownerId,
    requiredCapabilities: input.requiredCapabilities,
    suiteBindingRef: input.suiteBindingRef,
    configurationPinSetHash: input.configurationPinSetHash,
    parameterSetHash: input.parameterSetHash,
    targetSnapshotHash: input.targetSnapshotHash,
    scopeSnapshotHash: input.scopeSnapshotHash,
    planRevisionRef: input.planRevisionRef,
    requirementRef: input.requirementRef,
    planItemSetHash,
  });
  const structureHash = qaAggregateSnapshotHash(structural as never);
  return Object.freeze({
    schemaVersion: 2 as const,
    id: input.id,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workItemId: input.workItemId,
    ordinal: input.ordinal,
    ...(input.parentSessionId === undefined
      ? {}
      : {
          parentSessionId: input.parentSessionId,
          replacement: structuredClone(input.replacement),
        }),
    mode: "AUTOMATED" as const,
    state: "READY" as const,
    executionActivity: "IDLE" as const,
    planRevisionRef: structuredClone(input.planRevisionRef),
    requirementRef: structuredClone(input.requirementRef),
    ownerId: input.ownerId,
    requiredCapabilities: Object.freeze([...input.requiredCapabilities]),
    suiteBindingRef: structuredClone(input.suiteBindingRef),
    configurationPinSetHash: input.configurationPinSetHash,
    parameterSetHash: input.parameterSetHash,
    targetSnapshotRef: input.targetSnapshotRef,
    targetSnapshotHash: input.targetSnapshotHash,
    scopeSnapshotRef: input.scopeSnapshotRef,
    scopeSnapshotHash: input.scopeSnapshotHash,
    planItemId: item.id,
    planItemSetHash,
    structureRevision: 1 as const,
    structureHash,
    readyAgainstStructureHash: structureHash,
    resourceVersion: 1 as const,
    createdBy: structuredClone(input.createdBy),
    createdAt: input.createdAt,
    readyAt: input.createdAt,
  });
}

function structure(
  input: Pick<
    QaTestSession,
    | "ownerId"
    | "requiredCapabilities"
    | "targetSnapshot"
    | "scopeSnapshot"
    | "planRevisionRef"
    | "requirementRef"
    | "planItemSetHash"
  >,
): QaContentHash {
  return qaAggregateSnapshotHash({
    ownerId: input.ownerId,
    requiredCapabilities: input.requiredCapabilities,
    targetSnapshotHash: input.targetSnapshot.contentHash,
    scopeSnapshotHash: input.scopeSnapshot.contentHash,
    planRevisionRef: input.planRevisionRef,
    requirementRef: input.requirementRef,
    planItemSetHash: input.planItemSetHash,
  } as never);
}

function cas(session: QaTestSession, expected: number): void {
  if (session.resourceVersion !== expected) throw new QaDomainError("QA_SESSION_STALE_VERSION");
}
function reason(value: string): void {
  if (value.trim().length < 5 || value.length > 500)
    throw new QaDomainError("QA_SESSION_REASON_INVALID");
}

export function createPlannedTestSession(
  input: Omit<
    QaTestSession,
    | "schemaVersion"
    | "mode"
    | "state"
    | "structureRevision"
    | "structureHash"
    | "readyAgainstStructureHash"
    | "resourceVersion"
    | "planItemSetHash"
  > &
    Readonly<{ planItemSetHash?: QaContentHash }>,
): QaTestSession {
  if (
    !input.id ||
    !input.workspaceId ||
    !input.projectId ||
    !input.workItemId ||
    input.ordinal < 1 ||
    !input.ownerId ||
    input.requiredCapabilities.length === 0 ||
    input.targetSnapshot.workspaceId !== input.workspaceId ||
    input.targetSnapshot.projectId !== input.projectId
  )
    throw new QaDomainError("QA_SESSION_INVALID");
  const base = Object.freeze({
    schemaVersion: 1 as const,
    ...structuredClone(input),
    planItemSetHash: input.planItemSetHash ?? qaAggregateSnapshotHash([] as never),
    mode: "MANUAL" as const,
    state: "PLANNED" as const,
    structureRevision: 1,
    readyAgainstStructureHash: null,
    resourceVersion: 1,
  });
  return Object.freeze({ ...base, structureHash: structure(base) });
}

export function prepareTestSession(
  session: QaTestSession,
  input: Readonly<{ actor: QaHumanActor; at: string; expectedResourceVersion: number }>,
): QaTestSession {
  cas(session, input.expectedResourceVersion);
  if (session.state !== "PLANNED") throw new QaDomainError("QA_SESSION_PREPARE_STATE_INVALID");
  return Object.freeze({
    ...session,
    state: "READY",
    readyAgainstStructureHash: session.structureHash,
    readyAt: input.at,
    readyBy: structuredClone(input.actor),
    resourceVersion: session.resourceVersion + 1,
    lastTransitionActor: structuredClone(input.actor),
  });
}

export function startPreparedTestSession(
  session: QaTestSession,
  input: Readonly<{
    actor: QaHumanActor;
    at: string;
    expectedResourceVersion: number;
    confirmedOperationalReady: boolean;
  }>,
): QaTestSession {
  cas(session, input.expectedResourceVersion);
  if (session.state !== "READY") throw new QaDomainError("QA_SESSION_NOT_READY");
  if (!input.confirmedOperationalReady)
    throw new QaDomainError("QA_SESSION_OPERATIONAL_READY_REQUIRED");
  if (session.readyAgainstStructureHash !== session.structureHash)
    throw new QaDomainError("QA_SESSION_READY_HASH_STALE");
  return Object.freeze({
    ...session,
    state: "RUNNING",
    startedAt: input.at,
    startedBy: structuredClone(input.actor),
    resourceVersion: session.resourceVersion + 1,
    lastTransitionActor: structuredClone(input.actor),
  });
}

export function editPlannedSessionStructure(
  session: QaTestSession,
  input: Readonly<{
    actor: QaHumanActor;
    at: string;
    reason: string;
    expectedResourceVersion: number;
    ownerId?: string;
    requiredCapabilities?: readonly string[];
    targetSnapshot?: QaTargetSnapshot;
    scopeSnapshot?: QaScopeSnapshot;
    planItemSetHash?: QaContentHash;
  }>,
): QaTestSession {
  cas(session, input.expectedResourceVersion);
  if (session.startedAt || !["PLANNED", "READY"].includes(session.state))
    throw new QaDomainError("SESSION_SNAPSHOT_LOCKED");
  reason(input.reason);
  const previousStructureState = session.state as "PLANNED" | "READY";
  const updated = {
    ...session,
    ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
    ...(input.requiredCapabilities === undefined
      ? {}
      : { requiredCapabilities: Object.freeze([...input.requiredCapabilities]) }),
    ...(input.targetSnapshot === undefined ? {} : { targetSnapshot: input.targetSnapshot }),
    ...(input.scopeSnapshot === undefined ? {} : { scopeSnapshot: input.scopeSnapshot }),
    ...(input.planItemSetHash === undefined ? {} : { planItemSetHash: input.planItemSetHash }),
  };
  const nextHash = structure(updated);
  if (nextHash === session.structureHash) throw new QaDomainError("QA_SESSION_STRUCTURE_NOOP");
  return Object.freeze({
    ...updated,
    state: "PLANNED",
    structureRevision: session.structureRevision + 1,
    previousStructureHash: session.structureHash,
    previousStructureState,
    ...(session.readyAgainstStructureHash === null
      ? {}
      : { previousReadyAgainstStructureHash: session.readyAgainstStructureHash }),
    structureHash: nextHash,
    readyAgainstStructureHash: null,
    resetReason: "STRUCTURE_CHANGED",
    stateReason: input.reason,
    resourceVersion: session.resourceVersion + 1,
    lastTransitionActor: structuredClone(input.actor),
  });
}

function milestone(session: QaTestSession): QaSessionMilestone {
  if (session.state === "REVIEW_REQUIRED") return "REVIEW_REQUIRED";
  if (session.startedAt) return "RUNNING";
  if (session.readyAt) return "READY";
  return "PLANNED";
}

export function blockTestSession(
  session: QaTestSession,
  input: Readonly<{
    actor: QaHumanActor;
    at: string;
    reason: string;
    expectedResourceVersion: number;
  }>,
): QaTestSession {
  cas(session, input.expectedResourceVersion);
  if (["COMPLETED", "CANCELLED", "BLOCKED"].includes(session.state))
    throw new QaDomainError("QA_SESSION_BLOCK_STATE_INVALID");
  reason(input.reason);
  return Object.freeze({
    ...session,
    state: "BLOCKED",
    blockedFrom: milestone(session),
    blockedAt: input.at,
    stateReason: input.reason,
    resourceVersion: session.resourceVersion + 1,
    lastTransitionActor: structuredClone(input.actor),
  });
}

export function resumeBlockedTestSession(
  session: QaTestSession,
  input: Readonly<{
    actor: QaHumanActor;
    at: string;
    target: QaSessionMilestone;
    expectedResourceVersion: number;
  }>,
): QaTestSession {
  cas(session, input.expectedResourceVersion);
  if (session.state !== "BLOCKED" || session.blockedFrom !== input.target)
    throw new QaDomainError("QA_SESSION_RESUME_STAGE_MISMATCH");
  return Object.freeze({
    ...session,
    state: input.target,
    resourceVersion: session.resourceVersion + 1,
    lastTransitionActor: structuredClone(input.actor),
  });
}

export function cancelTestSession(
  session: QaTestSession,
  input: Readonly<{
    actor: QaHumanActor;
    at: string;
    reason: string;
    expectedResourceVersion: number;
    executionFacts: { attempts: number; observations: number; results: number };
  }>,
): QaTestSession {
  cas(session, input.expectedResourceVersion);
  if (["COMPLETED", "CANCELLED"].includes(session.state))
    throw new QaDomainError("QA_SESSION_CANCEL_STATE_INVALID");
  reason(input.reason);
  if (
    input.executionFacts.attempts +
      input.executionFacts.observations +
      input.executionFacts.results >
    0
  )
    throw new QaDomainError("QA_SESSION_CANCEL_EXECUTION_EXISTS");
  const cancelledFrom = session.state === "BLOCKED" ? session.blockedFrom : milestone(session);
  if (!cancelledFrom) throw new QaDomainError("QA_SESSION_BLOCK_PROVENANCE_MISSING");
  return Object.freeze({
    ...session,
    state: "CANCELLED",
    cancelledFrom,
    cancelledAt: input.at,
    stateReason: input.reason,
    resourceVersion: session.resourceVersion + 1,
    lastTransitionActor: structuredClone(input.actor),
  });
}

export function requestTestSessionReview(
  session: QaTestSession,
  input: Readonly<{
    actor: QaHumanActor;
    at: string;
    expectedResourceVersion: number;
    terminalPlanItems: number;
    totalPlanItems: number;
  }>,
): QaTestSession {
  cas(session, input.expectedResourceVersion);
  if (session.state !== "RUNNING") throw new QaDomainError("QA_SESSION_REVIEW_STATE_INVALID");
  if (input.totalPlanItems < 1 || input.terminalPlanItems !== input.totalPlanItems)
    throw new QaDomainError("QA_SESSION_PLAN_ITEMS_NOT_TERMINAL");
  return Object.freeze({
    ...session,
    state: "REVIEW_REQUIRED",
    resourceVersion: session.resourceVersion + 1,
    lastTransitionActor: structuredClone(input.actor),
  });
}

export function completeTestSessionReview(
  session: QaTestSession,
  input: Readonly<{
    actor: QaHumanActor;
    at: string;
    expectedResourceVersion: number;
    sessionReviewId: string;
    sessionOutcome: "PASSED" | "FAILED" | "BLOCKED" | "INCONCLUSIVE";
    adjudicativeManifestRevisionId: string;
  }>,
): QaTestSession {
  cas(session, input.expectedResourceVersion);
  if (session.state !== "REVIEW_REQUIRED")
    throw new QaDomainError("QA_SESSION_REVIEW_STATE_INVALID");
  if (
    input.actor.kind !== "HUMAN" ||
    !input.sessionReviewId ||
    !input.adjudicativeManifestRevisionId
  )
    throw new QaDomainError("QA_SESSION_HUMAN_REVIEW_REQUIRED");
  return Object.freeze({
    ...session,
    state: "COMPLETED",
    latestSessionReviewId: input.sessionReviewId,
    sessionOutcome: input.sessionOutcome,
    adjudicativeManifestRevisionId: input.adjudicativeManifestRevisionId,
    completedAt: input.at,
    resourceVersion: session.resourceVersion + 1,
    lastTransitionActor: structuredClone(input.actor),
  });
}
