import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

import { createQueueActionPair, type QueueActionPair } from "../approval/queue-action-consumer.ts";

export type QueueServiceClass = "STANDARD" | "FIXED_DATE" | "EXPEDITE";
export type QueuePlanningLevel = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH" | "UNKNOWN";
export type QueuePlanningEffort =
  | Readonly<{ kind: "UNKNOWN" }>
  | Readonly<{
      kind: "ESTIMATE";
      lower: number;
      upper: number;
      unit: "PERSON_HOURS" | "PERSON_DAYS" | "SESSION_COUNT";
    }>;

export interface QueuePlanningValues extends Readonly<Record<string, JsonValue>> {
  readonly risk: QueuePlanningLevel;
  readonly businessImpact: QueuePlanningLevel;
  readonly dependencyReadiness: "READY" | "BLOCKED" | "UNKNOWN" | "NOT_APPLICABLE";
  readonly effortRange: QueuePlanningEffort;
}

export interface QueueExactSourceRef extends Readonly<Record<string, JsonValue>> {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceVersion: number | string;
  readonly semanticHash: Sha256Digest;
  readonly observedAt?: string;
  readonly confirmedAt?: string;
}

export interface QueueEntryCommandRef extends Readonly<Record<string, JsonValue>> {
  readonly queueEntryId: string;
  readonly revision: number;
  readonly semanticHash: Sha256Digest;
  readonly inputFingerprint: Sha256Digest;
}

export interface QueueControlExpectedState extends Readonly<Record<string, JsonValue>> {
  readonly kind: "WORK_ITEM_CONTROL";
  readonly policyRef: Readonly<{ id: string; version: number; semanticHash: Sha256Digest }>;
  readonly expectedControlVersion: number;
  readonly expectedQueueEntry: QueueEntryCommandRef;
  readonly operationalProjectionRef: QueueExactSourceRef;
  readonly qaSourceSetHash: Sha256Digest;
}

export type QueueControlEffect =
  | Readonly<{
      kind: "ACCEPT_PLANNING_VALUES";
      serviceClass: QueueServiceClass;
      before: QueuePlanningValues;
      after: QueuePlanningValues;
      triageAssessmentRef?: QueueExactSourceRef;
    }>
  | Readonly<{
      kind: "SET_FIXED_DATE";
      beforeServiceClass: "STANDARD";
      afterServiceClass: "FIXED_DATE";
      retainedPlanningValues: QueuePlanningValues;
      confirmedDueDateRef: QueueExactSourceRef;
    }>
  | Readonly<{
      kind: "CLEAR_SERVICE_CLASS";
      beforeServiceClass: "FIXED_DATE";
      afterServiceClass: "STANDARD";
      retainedPlanningValues: QueuePlanningValues;
    }>;

export interface QueueControlState {
  readonly controlId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly resourceVersion: number;
  readonly currentRevisionId?: string;
  readonly serviceClass: QueueServiceClass;
  readonly planningValues: QueuePlanningValues;
  readonly operationalProjectionRef: QueueExactSourceRef;
  readonly qaSourceSetHash: Sha256Digest;
  readonly policyRef: QueueControlExpectedState["policyRef"];
}

export interface QueueControlRevision extends Readonly<Record<string, JsonValue>> {
  readonly revisionId: string;
  readonly controlId: string;
  readonly revision: number;
  readonly previousRevisionId?: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly serviceClass: QueueServiceClass;
  readonly planningValues: QueuePlanningValues;
  readonly acceptedEffect: QueueControlEffect;
  readonly acceptedSourceRefs: readonly QueueExactSourceRef[];
  readonly dependencySourceSetHash: Sha256Digest;
  readonly acceptedActionRef: QueueExactSourceRef;
  readonly reason: string;
  readonly recordedAt: string;
  readonly recordedBy: string;
  readonly semanticHash: Sha256Digest;
}

export const UNKNOWN_QUEUE_PLANNING_VALUES: QueuePlanningValues = Object.freeze({
  risk: "UNKNOWN",
  businessImpact: "UNKNOWN",
  dependencyReadiness: "UNKNOWN",
  effortRange: Object.freeze({ kind: "UNKNOWN" }),
});

const hash = (value: unknown): Sha256Digest => sha256(value as JsonValue);
const nonempty = (value: string, code: string): void => {
  if (!value.trim()) throw new Error(code);
};

function assertPlanningValues(values: QueuePlanningValues): void {
  const levels = new Set(["LOW", "MEDIUM", "HIGH", "VERY_HIGH", "UNKNOWN"]);
  if (
    !levels.has(values.risk) ||
    !levels.has(values.businessImpact) ||
    !new Set(["READY", "BLOCKED", "UNKNOWN", "NOT_APPLICABLE"]).has(values.dependencyReadiness)
  ) {
    throw new Error("QUEUE_CONTROL_PLANNING_VALUES_INVALID");
  }
  if (
    values.effortRange.kind === "ESTIMATE" &&
    (values.effortRange.lower < 0 || values.effortRange.upper < values.effortRange.lower)
  ) {
    throw new Error("QUEUE_CONTROL_EFFORT_RANGE_INVALID");
  }
}

export function queueControlDefaultState(
  input: Readonly<{
    controlId: string;
    workspaceId: string;
    projectId: string;
    workItemId: string;
    operationalProjectionRef: QueueExactSourceRef;
    qaSourceSetHash: Sha256Digest;
    policyRef: QueueControlExpectedState["policyRef"];
  }>,
): QueueControlState {
  return Object.freeze({
    ...input,
    resourceVersion: 0,
    serviceClass: "STANDARD",
    planningValues: UNKNOWN_QUEUE_PLANNING_VALUES,
  });
}

export function assertQueueControlExpectedState(
  current: QueueControlState,
  expected: QueueControlExpectedState,
  currentQueueEntry: QueueEntryCommandRef,
): void {
  if (
    expected.kind !== "WORK_ITEM_CONTROL" ||
    expected.expectedControlVersion !== current.resourceVersion
  ) {
    throw new Error("QUEUE_CONTROL_CAS_CONFLICT");
  }
  if (hash(expected.expectedQueueEntry) !== hash(currentQueueEntry))
    throw new Error("QUEUE_CONTROL_QUEUE_ENTRY_CONFLICT");
  if (
    hash(expected.operationalProjectionRef) !== hash(current.operationalProjectionRef) ||
    expected.qaSourceSetHash !== current.qaSourceSetHash ||
    hash(expected.policyRef) !== hash(current.policyRef)
  ) {
    throw new Error("QUEUE_CONTROL_SOURCE_DRIFT");
  }
}

export function prepareQueueControlAction(
  input: Readonly<{
    actionId: string;
    requestKey: string;
    requestHash?: Sha256Digest;
    workspaceId: string;
    projectId: string;
    workItemId: string;
    workItemRef: QueueExactSourceRef;
    current: QueueControlState;
    currentQueueEntry: QueueEntryCommandRef;
    expectedState: QueueControlExpectedState;
    effect:
      | Readonly<{
          kind: "ACCEPT_PLANNING_VALUES";
          after: QueuePlanningValues;
          triageAssessmentRef?: QueueExactSourceRef;
        }>
      | Readonly<{ kind: "SET_FIXED_DATE"; confirmedDueDateRef: QueueExactSourceRef }>
      | Readonly<{ kind: "CLEAR_SERVICE_CLASS" }>;
    reason: string;
  }>,
): QueueActionPair {
  nonempty(input.actionId, "QUEUE_CONTROL_ACTION_ID_REQUIRED");
  nonempty(input.requestKey, "QUEUE_CONTROL_IDEMPOTENCY_KEY_REQUIRED");
  nonempty(input.reason, "QUEUE_CONTROL_REASON_REQUIRED");
  assertQueueControlExpectedState(input.current, input.expectedState, input.currentQueueEntry);

  let effect: QueueControlEffect;
  if (input.effect.kind === "ACCEPT_PLANNING_VALUES") {
    assertPlanningValues(input.effect.after);
    effect = Object.freeze({
      kind: "ACCEPT_PLANNING_VALUES",
      serviceClass: input.current.serviceClass,
      before: input.current.planningValues,
      after: input.effect.after,
      ...(input.effect.triageAssessmentRef
        ? { triageAssessmentRef: input.effect.triageAssessmentRef }
        : {}),
    });
  } else if (input.effect.kind === "SET_FIXED_DATE") {
    if (input.current.serviceClass !== "STANDARD")
      throw new Error("QUEUE_CONTROL_FIXED_DATE_TRANSITION_INVALID");
    if (
      input.effect.confirmedDueDateRef.sourceType !== "JIRA_OPERATIONAL_PROJECTION_REVISION" ||
      !input.effect.confirmedDueDateRef.confirmedAt
    )
      throw new Error("QUEUE_CONTROL_CONFIRMED_DUE_DATE_REQUIRED");
    effect = Object.freeze({
      kind: "SET_FIXED_DATE",
      beforeServiceClass: "STANDARD",
      afterServiceClass: "FIXED_DATE",
      retainedPlanningValues: input.current.planningValues,
      confirmedDueDateRef: input.effect.confirmedDueDateRef,
    });
  } else {
    if (input.current.serviceClass === "EXPEDITE")
      throw new Error("QUEUE_CONTROL_EXPEDITE_DEDICATED_ACTION_REQUIRED");
    if (input.current.serviceClass !== "FIXED_DATE")
      throw new Error("QUEUE_CONTROL_CLEAR_TRANSITION_INVALID");
    effect = Object.freeze({
      kind: "CLEAR_SERVICE_CLASS",
      beforeServiceClass: "FIXED_DATE",
      afterServiceClass: "STANDARD",
      retainedPlanningValues: input.current.planningValues,
    });
  }

  const scope = Object.freeze({
    kind: "PROJECT" as const,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  });
  const target = Object.freeze({
    kind: "WORK_ITEM" as const,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workItemRef: input.workItemRef,
  });
  const { policyRef: policyFacetRef, ...visibleExpectedRest } = input.expectedState;
  const expectedVisibleState = Object.freeze({ ...visibleExpectedRest, policyFacetRef });
  const requestHash =
    input.requestHash ??
    hash({
      scope,
      target,
      expectedState: input.expectedState,
      requestedEffect: effect,
      reason: input.reason,
    });
  return createQueueActionPair({
    candidate: {
      schemaVersion: "queue-action-candidate@1.0.0",
      actionId: input.actionId,
      actionKind: "QUEUE_CONTROL_ACCEPT",
      scope,
      target,
      requestHash,
      expectedVisibleState,
      requestedEffect: effect,
      reason: input.reason,
      approvalPolicy: "NO_SECOND_APPROVAL",
    },
    witness: {
      schemaVersion: "queue-control-action@1.0.0",
      actionId: input.actionId,
      actionKind: "QUEUE_CONTROL_ACCEPT",
      scope,
      target,
      expectedState: input.expectedState,
      requestedEffect: effect,
      reason: input.reason,
      approvalPolicy: "NO_SECOND_APPROVAL",
      idempotencyKeyHash: hash(input.requestKey),
    },
  });
}

export function applyQueueControlEffect(
  input: Readonly<{
    pair: QueueActionPair;
    current: QueueControlState;
    revisionId: string;
    actorId: string;
    recordedAt: string;
  }>,
): QueueControlRevision {
  if (input.pair.candidate.actionKind !== "QUEUE_CONTROL_ACCEPT")
    throw new Error("QUEUE_CONTROL_ACTION_KIND_INVALID");
  const effect = input.pair.witness.requestedEffect as QueueControlEffect;
  let serviceClass = input.current.serviceClass;
  let planningValues = input.current.planningValues;
  const acceptedSourceRefs: QueueExactSourceRef[] = [input.current.operationalProjectionRef];
  if (effect.kind === "ACCEPT_PLANNING_VALUES") {
    if (effect.serviceClass !== serviceClass || hash(effect.before) !== hash(planningValues))
      throw new Error("QUEUE_CONTROL_BEFORE_STATE_MISMATCH");
    planningValues = effect.after;
    if (effect.triageAssessmentRef) acceptedSourceRefs.push(effect.triageAssessmentRef);
  } else if (effect.kind === "SET_FIXED_DATE") {
    if (serviceClass !== "STANDARD" || hash(effect.retainedPlanningValues) !== hash(planningValues))
      throw new Error("QUEUE_CONTROL_BEFORE_STATE_MISMATCH");
    serviceClass = "FIXED_DATE";
    acceptedSourceRefs.push(effect.confirmedDueDateRef);
  } else {
    if (
      serviceClass !== "FIXED_DATE" ||
      hash(effect.retainedPlanningValues) !== hash(planningValues)
    )
      throw new Error("QUEUE_CONTROL_BEFORE_STATE_MISMATCH");
    serviceClass = "STANDARD";
  }
  const semantic = {
    revisionId: input.revisionId,
    controlId: input.current.controlId,
    revision: input.current.resourceVersion + 1,
    ...(input.current.currentRevisionId
      ? { previousRevisionId: input.current.currentRevisionId }
      : {}),
    workspaceId: input.current.workspaceId,
    projectId: input.current.projectId,
    workItemId: input.current.workItemId,
    serviceClass,
    planningValues,
    acceptedEffect: effect,
    acceptedSourceRefs: Object.freeze(acceptedSourceRefs),
    dependencySourceSetHash: input.current.qaSourceSetHash,
    acceptedActionRef: Object.freeze({
      sourceType: "QUEUE_ACTION_CANDIDATE",
      sourceId: input.pair.actionId,
      sourceVersion: 1,
      semanticHash: input.pair.publicIntentHash,
    }),
    reason: input.pair.candidate.reason,
    recordedAt: input.recordedAt,
    recordedBy: input.actorId,
  };
  return Object.freeze({ ...semantic, semanticHash: hash(semantic) });
}
