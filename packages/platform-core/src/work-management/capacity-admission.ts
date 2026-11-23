import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

import { authorizedProjectSetHash } from "./queue-query-ports.ts";
import type { QueueStage } from "./queue-stage.ts";

export interface BaseWipClaim {
  readonly workItemId: string;
  readonly units: 1;
}

export type BaseWipClaimDecision =
  | Readonly<{
      state: "NOT_CONSUMING";
      units: 0;
      reason: "NON_CONSUMING_STAGE" | "NON_CONSUMING_ACTIVITY" | "AUTOMATED_ACTIVITY";
    }>
  | Readonly<{ state: "CREATE"; units: 1; cause: "MANUAL_RUNNING" | "MANUAL_REVIEW_REQUIRED" }>
  | Readonly<{ state: "UNCHANGED"; units: 1; cause: "ALREADY_CLAIMED" }>;

export function deriveBaseWipClaimDecision(
  input: Readonly<{
    workItemId: string;
    stage: QueueStage;
    activity?: Readonly<{ mode: "MANUAL" | "AUTOMATED"; state: string }>;
    existingClaim?: BaseWipClaim;
    policyMode: "MEASURE_ONLY";
  }>,
): BaseWipClaimDecision {
  if (!input.workItemId || input.policyMode !== "MEASURE_ONLY")
    throw new Error("BASE_WIP_INPUT_INVALID");
  if (input.existingClaim) {
    if (input.existingClaim.workItemId !== input.workItemId || input.existingClaim.units !== 1)
      throw new Error("BASE_WIP_EXISTING_CLAIM_INVALID");
    return Object.freeze({ state: "UNCHANGED", units: 1, cause: "ALREADY_CLAIMED" });
  }
  if (input.stage !== "ACTIVE")
    return Object.freeze({ state: "NOT_CONSUMING", units: 0, reason: "NON_CONSUMING_STAGE" });
  if (!input.activity || !new Set(["RUNNING", "REVIEW_REQUIRED"]).has(input.activity.state)) {
    return Object.freeze({ state: "NOT_CONSUMING", units: 0, reason: "NON_CONSUMING_ACTIVITY" });
  }
  if (input.activity.mode !== "MANUAL")
    return Object.freeze({ state: "NOT_CONSUMING", units: 0, reason: "AUTOMATED_ACTIVITY" });
  return Object.freeze({
    state: "CREATE",
    units: 1,
    cause: input.activity.state === "REVIEW_REQUIRED" ? "MANUAL_REVIEW_REQUIRED" : "MANUAL_RUNNING",
  });
}

export interface MeasureOnlyAdmissionDecision {
  readonly schemaVersion: "measure-only-capacity-admission@1.0.0";
  readonly decisionId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly requestKeyHash: Sha256Digest;
  readonly requestHash: Sha256Digest;
  readonly activityKind: "MANUAL_SESSION_START" | "MANUAL_SESSION_RESUME";
  readonly outcome: "ADMITTED" | "NO_CHANGE";
  readonly claim: Readonly<{
    claimId: string;
    cause: "MANUAL_RUNNING" | "MANUAL_REVIEW_REQUIRED";
  }> | null;
  readonly policyFacetRef: Readonly<{ id: string; version: number; semanticHash: Sha256Digest }>;
  readonly authorizationScopeWitnessHash: Sha256Digest;
  readonly decidedAt: string;
  readonly semanticHash: Sha256Digest;
}

export function createMeasureOnlyAdmissionDecision(
  input: Omit<MeasureOnlyAdmissionDecision, "schemaVersion" | "semanticHash">,
): MeasureOnlyAdmissionDecision {
  if (
    !Number.isFinite(Date.parse(input.decidedAt)) ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.requestKeyHash) ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.requestHash)
  ) {
    throw new Error("MEASURE_ONLY_ADMISSION_INVALID");
  }
  const body = Object.freeze({
    schemaVersion: "measure-only-capacity-admission@1.0.0" as const,
    ...input,
  });
  return Object.freeze({ ...body, semanticHash: sha256(body as unknown as JsonValue) });
}

export type CapacityClaimCause =
  | "MANUAL_RUNNING"
  | "MANUAL_REVIEW_REQUIRED"
  | "AUTOMATED_REVIEW_REQUIRED"
  | "EXTERNAL_ACTIVE"
  | "HELD_BLOCK"
  | "FORCED_EXTERNAL";

export interface CapacityClaimFact {
  readonly projectId: string;
  readonly workItemId: string;
  readonly state: "ACTIVE" | "RELEASED_BLOCK" | "RELEASED_TERMINAL";
  readonly causes: readonly CapacityClaimCause[];
  readonly sourceRefs?: readonly Readonly<{
    sourceType: string;
    sourceId: string;
    sourceVersion: number | string;
    semanticHash: Sha256Digest;
  }>[];
}

export type ReviewReservationState = "HELD" | "COVERED_BY_CLAIM" | "CONVERTED" | "RELEASED";

export interface CapacityReservationFact {
  readonly projectId: string;
  readonly workItemId: string;
  readonly state: ReviewReservationState;
  readonly causes: readonly string[];
  readonly sourceRefs?: readonly Readonly<{
    sourceType: string;
    sourceId: string;
    sourceVersion: number | string;
    semanticHash: Sha256Digest;
  }>[];
}

export interface CapacityExpediteFact {
  readonly projectId: string;
  readonly workItemId: string;
  readonly state: "ACTIVE" | "CLEARED" | "EXPIRED";
  readonly controlRef: Readonly<{
    sourceType: "WORK_ITEM_QUEUE_CONTROL_REVISION";
    sourceId: string;
    sourceVersion: number;
    semanticHash: Sha256Digest;
  }>;
}

export interface CapacityProjectAccounting extends Readonly<Record<string, JsonValue>> {
  readonly projectId: string;
  readonly humanOccupiedCount: number;
  readonly reviewReservedCount: number;
  readonly humanCommittedCount: number;
  readonly forcedExternalCount: number;
  readonly activeExpediteCount: number;
  readonly policy:
    | Readonly<{ state: "NOT_CONFIGURED" }>
    | Readonly<{ state: "CONFIGURED"; softWipLimit: number; reservedCapacity: number }>;
  readonly warningState:
    "NOT_CONFIGURED" | "WITHIN_SOFT_LIMIT" | "ABOVE_SOFT_LIMIT" | "RESERVATION_PRESSURE";
}

export interface CapacityAccountingSnapshot {
  readonly humanOccupiedCount: number;
  readonly reviewReservedCount: number;
  readonly humanCommittedCount: number;
  readonly forcedExternalCount: number;
  readonly activeExpediteCount: number;
  readonly claimSetHash: Sha256Digest;
  readonly reservationSetHash: Sha256Digest;
  readonly expediteSetHash: Sha256Digest;
  readonly reservationStateCounts: Readonly<{
    held: number;
    converted: number;
    released: number;
    coveredByClaim: number;
  }>;
  readonly projectFacets: readonly CapacityProjectAccounting[];
}

export interface PublicCapacitySnapshot extends Readonly<Record<string, JsonValue>> {
  readonly schemaVersion: "capacity-snapshot@1.0.0";
  readonly workspaceId: string;
  readonly scope:
    | Readonly<{ kind: "PROJECT"; workspaceId: string; projectId: string }>
    | Readonly<{ kind: "AUTHORIZED_PORTFOLIO"; workspaceId: string }>;
  readonly authorizedProjectSetHash: Sha256Digest;
  readonly policyFacetRef: Readonly<{ id: string; version: number; semanticHash: Sha256Digest }>;
  readonly policyMode: "MEASURE_ONLY" | "ENFORCED";
  readonly authorizedProjectionRef: Readonly<{
    id: string;
    version: number;
    semanticHash: Sha256Digest;
  }>;
  readonly humanOccupiedCount: number;
  readonly reviewReservedCount: number;
  readonly humanCommittedCount: number;
  readonly forcedExternalCount: number;
  readonly activeExpediteCount: number;
  readonly claimSetHash: Sha256Digest;
  readonly reservationSetHash: Sha256Digest;
  readonly expediteSetHash: Sha256Digest;
  readonly limits:
    | Readonly<{ state: "NOT_CONFIGURED" }>
    | Readonly<{
        state: "CONFIGURED";
        workspaceHumanWipLimit: number;
        activeExpediteLimit: number;
      }>;
  readonly reservationStateCounts: CapacityAccountingSnapshot["reservationStateCounts"];
  readonly projectFacets: readonly CapacityProjectAccounting[];
  readonly freshness: "CURRENT" | "STALE" | "ERROR" | "REBUILDING";
  readonly asOf: string;
  readonly reconciledAt: string;
}

export interface CapacityProjectLimit {
  readonly projectId: string;
  readonly softWipLimit: number;
  readonly reservedCapacity: number;
}

const stableUnique = (values: readonly string[]): readonly string[] =>
  Object.freeze([...new Set(values)].sort());
const workItemKey = (value: Readonly<{ projectId: string; workItemId: string }>): string =>
  `${value.projectId}\u0000${value.workItemId}`;

function normalizedFact(value: CapacityClaimFact | CapacityReservationFact): JsonValue {
  const refs = [...(value.sourceRefs ?? [])].sort((left, right) =>
    `${left.sourceType}:${left.sourceId}:${String(left.sourceVersion)}:${left.semanticHash}`.localeCompare(
      `${right.sourceType}:${right.sourceId}:${String(right.sourceVersion)}:${right.semanticHash}`,
    ),
  );
  return {
    projectId: value.projectId,
    workItemId: value.workItemId,
    state: value.state,
    causes: stableUnique(value.causes),
    sourceRefs: refs,
  } as JsonValue;
}

export function capacityCauseSetHash(
  value: CapacityClaimFact | CapacityReservationFact,
): Sha256Digest {
  if (
    !value.projectId ||
    !value.workItemId ||
    value.causes.length === 0 ||
    value.causes.some((cause) => !cause)
  ) {
    throw new Error("CAPACITY_CAUSE_SET_INVALID");
  }
  return sha256(normalizedFact(value));
}

function assertAtMostOneCurrent<T extends Readonly<{ projectId: string; workItemId: string }>>(
  values: readonly T[],
  code: string,
): void {
  const keys = values.map(workItemKey);
  if (new Set(keys).size !== keys.length) throw new Error(code);
}

export function computeCapacityAccounting(
  input: Readonly<{
    claims: readonly CapacityClaimFact[];
    reservations: readonly CapacityReservationFact[];
    expedites: readonly CapacityExpediteFact[];
    authorizedProjectIds?: readonly string[];
    policyMode: "MEASURE_ONLY" | "ENFORCED";
    projectLimits?: readonly CapacityProjectLimit[];
  }>,
): CapacityAccountingSnapshot {
  const allowed = input.authorizedProjectIds
    ? new Set(stableUnique(input.authorizedProjectIds))
    : undefined;
  const claims = input.claims.filter(
    (value) => value.state === "ACTIVE" && (!allowed || allowed.has(value.projectId)),
  );
  const reservations = input.reservations.filter(
    (value) => !allowed || allowed.has(value.projectId),
  );
  const currentReservations = reservations.filter(
    (value) => value.state === "HELD" || value.state === "COVERED_BY_CLAIM",
  );
  const expedites = input.expedites.filter(
    (value) => value.state === "ACTIVE" && (!allowed || allowed.has(value.projectId)),
  );
  assertAtMostOneCurrent(claims, "CAPACITY_DUPLICATE_CURRENT_CLAIM");
  assertAtMostOneCurrent(currentReservations, "CAPACITY_DUPLICATE_CURRENT_RESERVATION");
  assertAtMostOneCurrent(expedites, "CAPACITY_DUPLICATE_CURRENT_EXPEDITE");
  for (const value of [...claims, ...reservations]) capacityCauseSetHash(value);

  const claimKeys = new Set(claims.map(workItemKey));
  const heldReservations = currentReservations.filter(
    (value) => value.state === "HELD" && !claimKeys.has(workItemKey(value)),
  );
  const occupiedKeys = stableUnique(claims.map(workItemKey));
  const reservedKeys = stableUnique(heldReservations.map(workItemKey));
  const committedKeys = stableUnique([...occupiedKeys, ...reservedKeys]);
  const forcedKeys = stableUnique(
    claims.filter(({ causes }) => causes.includes("FORCED_EXTERNAL")).map(workItemKey),
  );
  const expediteKeys = stableUnique(expedites.map(workItemKey));
  const claimSet = claims
    .map((value) => ({ key: workItemKey(value), causeSetHash: capacityCauseSetHash(value) }))
    .sort((left, right) => left.key.localeCompare(right.key));
  const reservationSet = currentReservations
    .map((value) => ({
      key: workItemKey(value),
      state: value.state,
      causeSetHash: capacityCauseSetHash(value),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
  const expediteSet = expedites
    .map((value) => ({ key: workItemKey(value), controlRef: value.controlRef }))
    .sort((left, right) => left.key.localeCompare(right.key));
  const projectIds = stableUnique(
    input.authorizedProjectIds ??
      [...claims, ...reservations, ...expedites].map(({ projectId }) => projectId),
  );
  const limits = new Map((input.projectLimits ?? []).map((value) => [value.projectId, value]));
  if (input.policyMode === "MEASURE_ONLY" && limits.size > 0)
    throw new Error("CAPACITY_MEASURE_ONLY_LIMITS_FORBIDDEN");
  if (
    new Set((input.projectLimits ?? []).map(({ projectId }) => projectId)).size !==
    (input.projectLimits ?? []).length
  )
    throw new Error("CAPACITY_PROJECT_LIMIT_DUPLICATE");
  const projectFacets = projectIds.map((projectId): CapacityProjectAccounting => {
    const projectClaims = claims.filter((value) => value.projectId === projectId);
    const projectClaimKeys = new Set(projectClaims.map(workItemKey));
    const projectReservations = currentReservations.filter(
      (value) => value.projectId === projectId,
    );
    const projectHeld = projectReservations.filter(
      (value) => value.state === "HELD" && !projectClaimKeys.has(workItemKey(value)),
    );
    const projectCommitted = new Set([...projectClaimKeys, ...projectHeld.map(workItemKey)]).size;
    const limit = input.policyMode === "ENFORCED" ? limits.get(projectId) : undefined;
    const policy = limit
      ? Object.freeze({
          state: "CONFIGURED" as const,
          softWipLimit: limit.softWipLimit,
          reservedCapacity: limit.reservedCapacity,
        })
      : Object.freeze({ state: "NOT_CONFIGURED" as const });
    const warningState = !limit
      ? ("NOT_CONFIGURED" as const)
      : projectHeld.length > limit.reservedCapacity
        ? ("RESERVATION_PRESSURE" as const)
        : projectCommitted > limit.softWipLimit
          ? ("ABOVE_SOFT_LIMIT" as const)
          : ("WITHIN_SOFT_LIMIT" as const);
    return Object.freeze({
      projectId,
      humanOccupiedCount: projectClaimKeys.size,
      reviewReservedCount: projectHeld.length,
      humanCommittedCount: projectCommitted,
      forcedExternalCount: new Set(
        projectClaims.filter(({ causes }) => causes.includes("FORCED_EXTERNAL")).map(workItemKey),
      ).size,
      activeExpediteCount: new Set(
        expedites.filter((value) => value.projectId === projectId).map(workItemKey),
      ).size,
      policy,
      warningState,
    });
  });
  return Object.freeze({
    humanOccupiedCount: occupiedKeys.length,
    reviewReservedCount: reservedKeys.length,
    humanCommittedCount: committedKeys.length,
    forcedExternalCount: forcedKeys.length,
    activeExpediteCount: expediteKeys.length,
    claimSetHash: sha256(claimSet as JsonValue),
    reservationSetHash: sha256(reservationSet as JsonValue),
    expediteSetHash: sha256(expediteSet as JsonValue),
    reservationStateCounts: Object.freeze({
      held: reservations.filter(({ state }) => state === "HELD").length,
      converted: reservations.filter(({ state }) => state === "CONVERTED").length,
      released: reservations.filter(({ state }) => state === "RELEASED").length,
      coveredByClaim: reservations.filter(({ state }) => state === "COVERED_BY_CLAIM").length,
    }),
    projectFacets: Object.freeze(projectFacets),
  });
}

function capacitySnapshotBody(
  snapshot: Omit<PublicCapacitySnapshot, "authorizedProjectionRef"> | PublicCapacitySnapshot,
): JsonValue {
  const { authorizedProjectionRef: _ref, ...body } = snapshot as PublicCapacitySnapshot;
  void _ref;
  return body as JsonValue;
}

export function validateCapacitySnapshot(snapshot: PublicCapacitySnapshot): void {
  if (
    snapshot.schemaVersion !== "capacity-snapshot@1.0.0" ||
    snapshot.scope.workspaceId !== snapshot.workspaceId ||
    !Number.isFinite(Date.parse(snapshot.asOf)) ||
    !Number.isFinite(Date.parse(snapshot.reconciledAt))
  )
    throw new Error("CAPACITY_SNAPSHOT_INVALID");
  const projects =
    snapshot.scope.kind === "PROJECT"
      ? [snapshot.scope.projectId]
      : snapshot.projectFacets.map(({ projectId }) => projectId);
  if (
    snapshot.authorizedProjectSetHash !== authorizedProjectSetHash(projects) ||
    new Set(snapshot.projectFacets.map(({ projectId }) => projectId)).size !==
      snapshot.projectFacets.length ||
    snapshot.projectFacets.some(({ projectId }) => !projects.includes(projectId))
  )
    throw new Error("CAPACITY_SNAPSHOT_SCOPE_MISMATCH");
  const counts = [
    snapshot.humanOccupiedCount,
    snapshot.reviewReservedCount,
    snapshot.humanCommittedCount,
    snapshot.forcedExternalCount,
    snapshot.activeExpediteCount,
    snapshot.reservationStateCounts.held,
    snapshot.reservationStateCounts.converted,
    snapshot.reservationStateCounts.released,
    snapshot.reservationStateCounts.coveredByClaim,
  ];
  if (
    counts.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    snapshot.humanCommittedCount > snapshot.humanOccupiedCount + snapshot.reviewReservedCount ||
    snapshot.humanCommittedCount <
      Math.max(snapshot.humanOccupiedCount, snapshot.reviewReservedCount)
  )
    throw new Error("CAPACITY_SNAPSHOT_COUNTS_INVALID");
  if ((snapshot.policyMode === "MEASURE_ONLY") !== (snapshot.limits.state === "NOT_CONFIGURED"))
    throw new Error("CAPACITY_SNAPSHOT_LIMIT_MODE_MISMATCH");
  for (const facet of snapshot.projectFacets) {
    if ((facet.policy.state === "NOT_CONFIGURED") !== (facet.warningState === "NOT_CONFIGURED"))
      throw new Error("CAPACITY_SNAPSHOT_PROJECT_WARNING_MISMATCH");
    if (snapshot.policyMode === "MEASURE_ONLY" && facet.policy.state !== "NOT_CONFIGURED")
      throw new Error("CAPACITY_SNAPSHOT_MEASURE_ONLY_PROJECT_LIMIT_FORBIDDEN");
  }
  if (
    snapshot.authorizedProjectionRef.version < 1 ||
    snapshot.authorizedProjectionRef.semanticHash !== sha256(capacitySnapshotBody(snapshot))
  )
    throw new Error("CAPACITY_SNAPSHOT_PROJECTION_HASH_MISMATCH");
}

export function createCapacitySnapshot(
  input: Readonly<{
    workspaceId: string;
    scope: PublicCapacitySnapshot["scope"];
    authorizedProjectIds: readonly string[];
    policyFacetRef: PublicCapacitySnapshot["policyFacetRef"];
    policyMode: PublicCapacitySnapshot["policyMode"];
    authorizedProjectionId: string;
    authorizedProjectionVersion: number;
    accounting: CapacityAccountingSnapshot;
    workspaceHumanWipLimit?: number;
    activeExpediteLimit?: number;
    freshness: PublicCapacitySnapshot["freshness"];
    asOf: string;
    reconciledAt: string;
  }>,
): PublicCapacitySnapshot {
  const authorizedIds = stableUnique(input.authorizedProjectIds);
  if (
    input.scope.kind === "PROJECT" &&
    (authorizedIds.length !== 1 || authorizedIds[0] !== input.scope.projectId)
  )
    throw new Error("CAPACITY_SNAPSHOT_PROJECT_SCOPE_INVALID");
  const limits =
    input.policyMode === "MEASURE_ONLY"
      ? Object.freeze({ state: "NOT_CONFIGURED" as const })
      : Object.freeze({
          state: "CONFIGURED" as const,
          workspaceHumanWipLimit: input.workspaceHumanWipLimit ?? 0,
          activeExpediteLimit: input.activeExpediteLimit ?? 0,
        });
  if (
    limits.state === "CONFIGURED" &&
    (!Number.isSafeInteger(limits.workspaceHumanWipLimit) ||
      limits.workspaceHumanWipLimit < 1 ||
      !Number.isSafeInteger(limits.activeExpediteLimit) ||
      limits.activeExpediteLimit < 1)
  )
    throw new Error("CAPACITY_SNAPSHOT_LIMIT_INVALID");
  const body = Object.freeze({
    schemaVersion: "capacity-snapshot@1.0.0" as const,
    workspaceId: input.workspaceId,
    scope: input.scope,
    authorizedProjectSetHash: authorizedProjectSetHash(authorizedIds),
    policyFacetRef: input.policyFacetRef,
    policyMode: input.policyMode,
    humanOccupiedCount: input.accounting.humanOccupiedCount,
    reviewReservedCount: input.accounting.reviewReservedCount,
    humanCommittedCount: input.accounting.humanCommittedCount,
    forcedExternalCount: input.accounting.forcedExternalCount,
    activeExpediteCount: input.accounting.activeExpediteCount,
    claimSetHash: input.accounting.claimSetHash,
    reservationSetHash: input.accounting.reservationSetHash,
    expediteSetHash: input.accounting.expediteSetHash,
    limits,
    reservationStateCounts: input.accounting.reservationStateCounts,
    projectFacets: input.accounting.projectFacets,
    freshness: input.freshness,
    asOf: input.asOf,
    reconciledAt: input.reconciledAt,
  });
  const snapshot = Object.freeze({
    ...body,
    authorizedProjectionRef: Object.freeze({
      id: input.authorizedProjectionId,
      version: input.authorizedProjectionVersion,
      semanticHash: sha256(body as unknown as JsonValue),
    }),
  }) as PublicCapacitySnapshot;
  validateCapacitySnapshot(snapshot);
  return snapshot;
}

export type CapacityAdmissionActivityKind =
  | "MANUAL_SESSION_START"
  | "MANUAL_SESSION_RESUME"
  | "AUTOMATED_SESSION_LAUNCH"
  | "AUTOMATED_RESULT_APPLY"
  | "EXTERNAL_JIRA_RECONCILIATION"
  | "SET_EXPEDITE"
  | "CLEAR_EXPEDITE"
  | "EXPIRE_EXPEDITE";

export type CapacityConstraint =
  | "HARD_WIP"
  | "EXPEDITE_SINGLETON"
  | "PROJECT_SOFT_LIMIT"
  | "RESERVATION_PRESSURE"
  | "OVER_CAPACITY_EXTERNAL";

export interface CapacityAdmissionEvaluation {
  readonly outcome:
    | "ADMITTED"
    | "DENIED"
    | "ADMITTED_WITH_EXACT_OVERRIDE"
    | "NON_DISCRETIONARY_APPLIED"
    | "NON_DISCRETIONARY_OVERFLOW"
    | "NO_CHANGE";
  readonly violatedConstraints: readonly CapacityConstraint[];
  readonly committedDelta: 0 | 1;
  readonly expediteDelta: -1 | 0 | 1;
  readonly mutationKind:
    | "CLAIM"
    | "RESERVATION"
    | "CONVERT_RESERVATION"
    | "RELEASE_RESERVATION"
    | "SET_EXPEDITE"
    | "CLEAR_EXPEDITE"
    | "NO_CHANGE";
}

export function evaluateCapacityAdmission(
  input: Readonly<{
    policyMode: "MEASURE_ONLY" | "ENFORCED";
    activityKind: CapacityAdmissionActivityKind;
    automatedResultPath?: "CONVERT_RESERVATION_TO_REVIEW_CLAIM" | "RELEASE_RESERVATION";
    current: Pick<CapacityAccountingSnapshot, "humanCommittedCount" | "activeExpediteCount">;
    workspaceHumanWipLimit: number | null;
    activeExpediteLimit: number | null;
    targetHasClaim: boolean;
    targetHasReservation: boolean;
    targetHasExpedite: boolean;
    projectCommittedCount?: number;
    projectReservedCount?: number;
    projectSoftWipLimit?: number;
    projectReservedCapacity?: number;
    exactOverride?: Readonly<{
      actionKind: "WIP_ADMISSION_OVERRIDE" | "EXPEDITE_CAPACITY_OVERRIDE";
      effectKind: "ALLOW_WIP_ADMISSION" | "ALLOW_EXPEDITE_CAPACITY";
    }>;
  }>,
): CapacityAdmissionEvaluation {
  const nondiscretionary =
    input.activityKind === "AUTOMATED_RESULT_APPLY" ||
    input.activityKind === "EXTERNAL_JIRA_RECONCILIATION" ||
    input.activityKind === "EXPIRE_EXPEDITE";
  let committedDelta: 0 | 1 = 0;
  let expediteDelta: -1 | 0 | 1 = 0;
  let mutationKind: CapacityAdmissionEvaluation["mutationKind"];
  if (
    input.activityKind === "MANUAL_SESSION_START" ||
    input.activityKind === "MANUAL_SESSION_RESUME"
  ) {
    committedDelta = input.targetHasClaim || input.targetHasReservation ? 0 : 1;
    mutationKind = input.targetHasClaim ? "NO_CHANGE" : "CLAIM";
  } else if (input.activityKind === "AUTOMATED_SESSION_LAUNCH") {
    committedDelta = input.targetHasClaim || input.targetHasReservation ? 0 : 1;
    mutationKind = input.targetHasReservation ? "NO_CHANGE" : "RESERVATION";
  } else if (input.activityKind === "AUTOMATED_RESULT_APPLY") {
    if (!input.automatedResultPath) throw new Error("CAPACITY_AUTOMATED_RESULT_PATH_REQUIRED");
    mutationKind =
      input.automatedResultPath === "CONVERT_RESERVATION_TO_REVIEW_CLAIM"
        ? "CONVERT_RESERVATION"
        : "RELEASE_RESERVATION";
    committedDelta =
      input.automatedResultPath === "CONVERT_RESERVATION_TO_REVIEW_CLAIM" &&
      !input.targetHasReservation &&
      !input.targetHasClaim
        ? 1
        : 0;
  } else if (input.activityKind === "EXTERNAL_JIRA_RECONCILIATION") {
    mutationKind = input.targetHasClaim ? "NO_CHANGE" : "CLAIM";
    committedDelta = input.targetHasClaim || input.targetHasReservation ? 0 : 1;
  } else if (input.activityKind === "SET_EXPEDITE") {
    mutationKind = input.targetHasExpedite ? "NO_CHANGE" : "SET_EXPEDITE";
    expediteDelta = input.targetHasExpedite ? 0 : 1;
  } else {
    mutationKind = input.targetHasExpedite ? "CLEAR_EXPEDITE" : "NO_CHANGE";
    expediteDelta = input.targetHasExpedite ? -1 : 0;
  }
  if (mutationKind === "NO_CHANGE")
    return Object.freeze({
      outcome: "NO_CHANGE",
      violatedConstraints: Object.freeze([]),
      committedDelta,
      expediteDelta,
      mutationKind,
    });
  if (input.policyMode === "MEASURE_ONLY") {
    if (
      input.workspaceHumanWipLimit !== null ||
      input.activeExpediteLimit !== null ||
      input.exactOverride
    )
      throw new Error("CAPACITY_MEASURE_ONLY_ENFORCEMENT_FORBIDDEN");
    return Object.freeze({
      outcome: nondiscretionary ? "NON_DISCRETIONARY_APPLIED" : "ADMITTED",
      violatedConstraints: Object.freeze([]),
      committedDelta,
      expediteDelta,
      mutationKind,
    });
  }
  if (
    !Number.isSafeInteger(input.workspaceHumanWipLimit) ||
    Number(input.workspaceHumanWipLimit) < 1 ||
    !Number.isSafeInteger(input.activeExpediteLimit) ||
    Number(input.activeExpediteLimit) < 1
  )
    throw new Error("CAPACITY_ENFORCED_LIMIT_REQUIRED");
  const hard: CapacityConstraint[] = [];
  if (
    committedDelta === 1 &&
    input.current.humanCommittedCount >= Number(input.workspaceHumanWipLimit)
  )
    hard.push("HARD_WIP");
  if (expediteDelta === 1 && input.current.activeExpediteCount >= Number(input.activeExpediteLimit))
    hard.push("EXPEDITE_SINGLETON");
  const warnings: CapacityConstraint[] = [];
  if (
    input.projectSoftWipLimit !== undefined &&
    (input.projectCommittedCount ?? 0) + committedDelta > input.projectSoftWipLimit
  )
    warnings.push("PROJECT_SOFT_LIMIT");
  if (
    input.projectReservedCapacity !== undefined &&
    (input.projectReservedCount ?? 0) + (mutationKind === "RESERVATION" ? 1 : 0) >
      input.projectReservedCapacity
  )
    warnings.push("RESERVATION_PRESSURE");
  const violations = Object.freeze([...hard, ...warnings]);
  if (nondiscretionary) {
    const overflow = hard.length > 0;
    return Object.freeze({
      outcome: overflow ? "NON_DISCRETIONARY_OVERFLOW" : "NON_DISCRETIONARY_APPLIED",
      violatedConstraints: Object.freeze(
        overflow ? [...violations, "OVER_CAPACITY_EXTERNAL" as const] : [...warnings],
      ),
      committedDelta,
      expediteDelta,
      mutationKind,
    });
  }
  if (hard.length === 0)
    return Object.freeze({
      outcome: "ADMITTED",
      violatedConstraints: violations,
      committedDelta,
      expediteDelta,
      mutationKind,
    });
  const expectedOverride = hard.includes("EXPEDITE_SINGLETON")
    ? { actionKind: "EXPEDITE_CAPACITY_OVERRIDE", effectKind: "ALLOW_EXPEDITE_CAPACITY" }
    : { actionKind: "WIP_ADMISSION_OVERRIDE", effectKind: "ALLOW_WIP_ADMISSION" };
  if (
    input.exactOverride &&
    input.exactOverride.actionKind === expectedOverride.actionKind &&
    input.exactOverride.effectKind === expectedOverride.effectKind
  ) {
    return Object.freeze({
      outcome: "ADMITTED_WITH_EXACT_OVERRIDE",
      violatedConstraints: violations,
      committedDelta,
      expediteDelta,
      mutationKind,
    });
  }
  return Object.freeze({
    outcome: "DENIED",
    violatedConstraints: violations,
    committedDelta: 0,
    expediteDelta: 0,
    mutationKind,
  });
}

export type AuthoritativeCapacityMutation =
  "UPSERT_FORCED_CLAIM" | "RELEASE_CLAIM_BLOCK" | "RELEASE_CLAIM_TERMINAL" | "NO_CHANGE";

/** Plans convergence from confirmed Jira truth; authoritative facts are never rejected for capacity. */
export function reconcileAuthoritativeCapacityFact(
  input: Readonly<{
    policyMode: "MEASURE_ONLY" | "ENFORCED";
    operationalState: "ACTIVE" | "BLOCKED" | "TERMINAL";
    blockedWipEffect?: "HOLD_WIP" | "RELEASE_WIP";
    current: Pick<CapacityAccountingSnapshot, "humanCommittedCount" | "activeExpediteCount">;
    workspaceHumanWipLimit: number | null;
    activeExpediteLimit: number | null;
    targetHasClaim: boolean;
    targetHasReservation: boolean;
    overflowAlreadyRecorded: boolean;
  }>,
): Readonly<{
  mutation: AuthoritativeCapacityMutation;
  cause: "EXTERNAL_ACTIVE" | "HELD_BLOCK" | "FORCED_EXTERNAL" | "RELEASE_WIP" | "TERMINAL";
  outcome: CapacityAdmissionEvaluation["outcome"];
  emitOverLimitDetected: boolean;
}> {
  if (input.operationalState === "TERMINAL")
    return Object.freeze({
      mutation: input.targetHasClaim ? "RELEASE_CLAIM_TERMINAL" : "NO_CHANGE",
      cause: "TERMINAL",
      outcome: input.targetHasClaim ? "NON_DISCRETIONARY_APPLIED" : "NO_CHANGE",
      emitOverLimitDetected: false,
    });
  if (input.operationalState === "BLOCKED" && input.blockedWipEffect === "RELEASE_WIP")
    return Object.freeze({
      mutation: input.targetHasClaim ? "RELEASE_CLAIM_BLOCK" : "NO_CHANGE",
      cause: "RELEASE_WIP",
      outcome: input.targetHasClaim ? "NON_DISCRETIONARY_APPLIED" : "NO_CHANGE",
      emitOverLimitDetected: false,
    });
  if (input.targetHasClaim)
    return Object.freeze({
      mutation: "NO_CHANGE",
      cause: input.operationalState === "BLOCKED" ? "HELD_BLOCK" : "EXTERNAL_ACTIVE",
      outcome: "NO_CHANGE",
      emitOverLimitDetected: false,
    });
  const evaluation = evaluateCapacityAdmission({
    policyMode: input.policyMode,
    activityKind: "EXTERNAL_JIRA_RECONCILIATION",
    current: input.current,
    workspaceHumanWipLimit: input.workspaceHumanWipLimit,
    activeExpediteLimit: input.activeExpediteLimit,
    targetHasClaim: false,
    targetHasReservation: input.targetHasReservation,
    targetHasExpedite: false,
  });
  const overflow = evaluation.outcome === "NON_DISCRETIONARY_OVERFLOW";
  return Object.freeze({
    mutation: "UPSERT_FORCED_CLAIM",
    cause: overflow
      ? "FORCED_EXTERNAL"
      : input.operationalState === "BLOCKED"
        ? "HELD_BLOCK"
        : "EXTERNAL_ACTIVE",
    outcome: evaluation.outcome,
    emitOverLimitDetected: overflow && !input.overflowAlreadyRecorded,
  });
}

const recordValue = (value: unknown, code: string): Readonly<Record<string, unknown>> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Readonly<Record<string, unknown>>;
};

/** Composed semantic checks that JSON Schema cannot express without dereferencing private state. */
export function validatePublicCapacityAdmission(value: Readonly<Record<string, unknown>>): void {
  if (value.schemaVersion !== "capacity-admission@1.0.0")
    throw new Error("CAPACITY_ADMISSION_SCHEMA_INVALID");
  const semantic = { ...value };
  delete semantic.semanticHash;
  const expectedSemanticHash = sha256(semantic as JsonValue);
  const request = recordValue(value.request, "CAPACITY_ADMISSION_REQUEST_INVALID");
  const before = recordValue(value.before, "CAPACITY_ADMISSION_WITNESS_INVALID");
  const after = recordValue(value.after, "CAPACITY_ADMISSION_WITNESS_INVALID");
  const witnessKeys = new Set(["policyMode", "authorizedScopeSnapshotRef"]);
  if (
    Object.keys(before).some((key) => !witnessKeys.has(key)) ||
    Object.keys(after).some((key) => !witnessKeys.has(key))
  ) {
    throw new Error("CAPACITY_ADMISSION_GLOBAL_WITNESS_FORBIDDEN");
  }
  const outcome = String(value.outcome);
  const constraints = Array.isArray(value.violatedConstraints)
    ? value.violatedConstraints.map(String)
    : [];
  const blocking = new Set([
    "HARD_WIP",
    "EXPEDITE_SINGLETON",
    "SOURCE_STALE",
    "SOURCE_CONFLICT",
    "CAPABILITY_MISSING",
    "APPROVAL_REQUIRED",
    "APPROVAL_STALE",
  ]);
  if (outcome === "DENIED" && !constraints.some((constraint) => blocking.has(constraint)))
    throw new Error("CAPACITY_ADMISSION_DENIAL_BLOCKER_REQUIRED");
  if (outcome === "NO_CHANGE" && constraints.length > 0)
    throw new Error("CAPACITY_ADMISSION_NO_CHANGE_CONSTRAINT_FORBIDDEN");
  if (
    before.policyMode === "MEASURE_ONLY" &&
    constraints.some(
      (constraint) =>
        constraint === "HARD_WIP" ||
        constraint === "EXPEDITE_SINGLETON" ||
        constraint === "OVER_CAPACITY_EXTERNAL",
    )
  ) {
    throw new Error("CAPACITY_ADMISSION_MEASURE_ONLY_BLOCKER_FORBIDDEN");
  }
  const override = recordValue(value.override, "CAPACITY_ADMISSION_OVERRIDE_INVALID");
  if ((outcome === "ADMITTED_WITH_EXACT_OVERRIDE") !== (override.state === "CONSUMED"))
    throw new Error("CAPACITY_ADMISSION_OVERRIDE_STATE_MISMATCH");
  if (override.state === "CONSUMED") {
    const candidateRef = recordValue(
      override.actionCandidateRef,
      "CAPACITY_ADMISSION_OVERRIDE_CANDIDATE_REF_INVALID",
    );
    if (override.publicIntentHash !== candidateRef.semanticHash)
      throw new Error("CAPACITY_ADMISSION_OVERRIDE_PUBLIC_HASH_MISMATCH");
    if (
      (override.actionKind === "WIP_ADMISSION_OVERRIDE") !==
      (override.effectKind === "ALLOW_WIP_ADMISSION")
    )
      throw new Error("CAPACITY_ADMISSION_OVERRIDE_EFFECT_MISMATCH");
  }
  const effect = recordValue(value.effect, "CAPACITY_ADMISSION_EFFECT_INVALID");
  const refs =
    effect.state === "COMMITTED" && Array.isArray(effect.mutationRefs)
      ? effect.mutationRefs.map((item) =>
          recordValue(item, "CAPACITY_ADMISSION_MUTATION_REF_INVALID"),
        )
      : [];
  const families = refs.map(({ sourceType }) => String(sourceType)).sort();
  const activity = String(request.activityKind);
  const expectedFamilies =
    activity === "MANUAL_SESSION_START" || activity === "MANUAL_SESSION_RESUME"
      ? ["HUMAN_WIP_CLAIM_REVISION", "QA_TEST_SESSION_REVISION"]
      : activity === "AUTOMATED_SESSION_LAUNCH"
        ? ["QA_TEST_SESSION_REVISION", "REVIEW_CAPACITY_RESERVATION_REVISION"]
        : activity === "AUTOMATED_RESULT_APPLY" &&
            request.automatedResultPath === "CONVERT_RESERVATION_TO_REVIEW_CLAIM"
          ? [
              "HUMAN_WIP_CLAIM_REVISION",
              "QA_TEST_SESSION_REVISION",
              "REVIEW_CAPACITY_RESERVATION_REVISION",
            ]
          : activity === "AUTOMATED_RESULT_APPLY"
            ? ["QA_TEST_SESSION_REVISION", "REVIEW_CAPACITY_RESERVATION_REVISION"]
            : activity === "SET_EXPEDITE" ||
                activity === "CLEAR_EXPEDITE" ||
                activity === "EXPIRE_EXPEDITE"
              ? ["WORK_ITEM_QUEUE_CONTROL_REVISION"]
              : undefined;
  if (
    effect.state === "COMMITTED" &&
    expectedFamilies &&
    JSON.stringify(families) !== JSON.stringify(expectedFamilies)
  ) {
    throw new Error("CAPACITY_ADMISSION_EFFECT_CARDINALITY_MISMATCH");
  }
  if (
    effect.state === "COMMITTED" &&
    activity === "EXTERNAL_JIRA_RECONCILIATION" &&
    (families.length === 0 || families.some((family) => family !== "HUMAN_WIP_CLAIM_REVISION"))
  ) {
    throw new Error("CAPACITY_ADMISSION_EXTERNAL_EFFECT_INVALID");
  }
  if (value.semanticHash !== expectedSemanticHash)
    throw new Error("CAPACITY_ADMISSION_SEMANTIC_HASH_MISMATCH");
}

export interface ReviewCapacityReservationRevision extends Readonly<Record<string, JsonValue>> {
  readonly reservationId: string;
  readonly revision: number;
  readonly previousRevisionId?: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionIds: readonly string[];
  readonly state: ReviewReservationState;
  readonly causes: readonly string[];
  readonly causeSetHash: Sha256Digest;
  readonly reservedAt: string;
  readonly expiresAt: string;
  readonly completedAt?: string;
  readonly semanticHash: Sha256Digest;
}

export interface HumanWipClaimRevision extends Readonly<Record<string, JsonValue>> {
  readonly claimId: string;
  readonly revision: number;
  readonly previousRevisionId?: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sessionIds: readonly string[];
  readonly state: CapacityClaimFact["state"];
  readonly causes: readonly CapacityClaimCause[];
  readonly causeSetHash: Sha256Digest;
  readonly acquiredAt: string;
  readonly releasedAt?: string;
  readonly semanticHash: Sha256Digest;
}

export type HumanWipClaimCommand =
  | Readonly<{ kind: "UPSERT"; sessionId?: string; cause: CapacityClaimCause; at: string }>
  | Readonly<{ kind: "RELEASE_BLOCK" | "RELEASE_TERMINAL"; cause: CapacityClaimCause; at: string }>;

export function transitionHumanWipClaim(
  input: Readonly<{
    claimId: string;
    workspaceId: string;
    projectId: string;
    workItemId: string;
    current?: HumanWipClaimRevision;
    command: HumanWipClaimCommand;
  }>,
): Readonly<{ outcome: "APPENDED" | "NO_CHANGE"; claim: HumanWipClaimRevision }> {
  const { command, current } = input;
  if (
    !input.claimId ||
    !input.workspaceId ||
    !input.projectId ||
    !input.workItemId ||
    !command.cause ||
    !Number.isFinite(Date.parse(command.at))
  )
    throw new Error("HUMAN_WIP_CLAIM_COMMAND_INVALID");
  if (
    current &&
    (current.workspaceId !== input.workspaceId ||
      current.projectId !== input.projectId ||
      current.workItemId !== input.workItemId)
  )
    throw new Error("HUMAN_WIP_CLAIM_SCOPE_MISMATCH");
  if (command.kind === "UPSERT") {
    if (current?.state === "RELEASED_TERMINAL") throw new Error("HUMAN_WIP_CLAIM_TERMINAL");
    const sessionIds = stableUnique([
      ...(current?.sessionIds ?? []),
      ...(command.sessionId ? [command.sessionId] : []),
    ]);
    const causes = stableUnique([
      ...(current?.state === "ACTIVE" ? current.causes : []),
      command.cause,
    ]) as readonly CapacityClaimCause[];
    if (
      current?.state === "ACTIVE" &&
      JSON.stringify(sessionIds) === JSON.stringify(current.sessionIds) &&
      JSON.stringify(causes) === JSON.stringify(current.causes)
    )
      return Object.freeze({ outcome: "NO_CHANGE", claim: current });
    const body = Object.freeze({
      claimId: input.claimId,
      revision: (current?.revision ?? 0) + 1,
      ...(current ? { previousRevisionId: current.claimId } : {}),
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workItemId: input.workItemId,
      sessionIds,
      state: "ACTIVE" as const,
      causes,
      causeSetHash: sha256(causes as JsonValue),
      acquiredAt: current?.state === "ACTIVE" ? current.acquiredAt : command.at,
    });
    return Object.freeze({
      outcome: "APPENDED",
      claim: Object.freeze({ ...body, semanticHash: sha256(body as unknown as JsonValue) }),
    });
  }
  if (!current || current.state !== "ACTIVE") {
    if (
      current &&
      current.state ===
        (command.kind === "RELEASE_BLOCK" ? "RELEASED_BLOCK" : "RELEASED_TERMINAL") &&
      current.releasedAt === command.at
    )
      return Object.freeze({ outcome: "NO_CHANGE", claim: current });
    throw new Error("HUMAN_WIP_CLAIM_NOT_ACTIVE");
  }
  const state =
    command.kind === "RELEASE_BLOCK" ? ("RELEASED_BLOCK" as const) : ("RELEASED_TERMINAL" as const);
  const causes = stableUnique([...current.causes, command.cause]) as readonly CapacityClaimCause[];
  const body = Object.freeze({
    claimId: input.claimId,
    revision: current.revision + 1,
    previousRevisionId: current.claimId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workItemId: input.workItemId,
    sessionIds: current.sessionIds,
    state,
    causes,
    causeSetHash: sha256(causes as JsonValue),
    acquiredAt: current.acquiredAt,
    releasedAt: command.at,
  });
  return Object.freeze({
    outcome: "APPENDED",
    claim: Object.freeze({ ...body, semanticHash: sha256(body as unknown as JsonValue) }),
  });
}

export type ReviewReservationCommand =
  | Readonly<{
      kind: "ACQUIRE";
      sessionId: string;
      cause: string;
      at: string;
      expiresAt: string;
      targetHasClaim: boolean;
    }>
  | Readonly<{
      kind: "CONVERT_TO_REVIEW_CLAIM";
      sessionId: string;
      cause: string;
      at: string;
      targetHasClaim: boolean;
    }>
  | Readonly<{ kind: "RELEASE"; sessionId: string; cause: string; at: string }>;

export interface ReviewReservationTransition {
  readonly outcome: "APPENDED" | "NO_CHANGE";
  readonly reservation: ReviewCapacityReservationRevision;
  readonly claimMutation: "NONE" | "CREATE" | "MERGE";
  readonly committedDelta: -1 | 0 | 1;
}

function reservationSemantic(
  value: Omit<ReviewCapacityReservationRevision, "semanticHash">,
): Sha256Digest {
  return sha256(value as unknown as JsonValue);
}

export function transitionReviewCapacityReservation(
  input: Readonly<{
    reservationId: string;
    workspaceId: string;
    projectId: string;
    workItemId: string;
    current?: ReviewCapacityReservationRevision;
    command: ReviewReservationCommand;
  }>,
): ReviewReservationTransition {
  const { command } = input;
  if (
    !input.reservationId ||
    !input.workspaceId ||
    !input.projectId ||
    !input.workItemId ||
    !command.sessionId ||
    !(command as { cause?: string }).cause ||
    !Number.isFinite(Date.parse(command.at))
  )
    throw new Error("REVIEW_RESERVATION_COMMAND_INVALID");
  const current = input.current;
  if (
    current &&
    (current.workspaceId !== input.workspaceId ||
      current.projectId !== input.projectId ||
      current.workItemId !== input.workItemId)
  )
    throw new Error("REVIEW_RESERVATION_SCOPE_MISMATCH");
  if (command.kind === "ACQUIRE") {
    if (
      !Number.isFinite(Date.parse(command.expiresAt)) ||
      Date.parse(command.expiresAt) <= Date.parse(command.at)
    )
      throw new Error("REVIEW_RESERVATION_EXPIRY_INVALID");
    const terminalPredecessor = current?.state === "CONVERTED" || current?.state === "RELEASED";
    const sessionIds = stableUnique([...(current?.sessionIds ?? []), command.sessionId]);
    const causes = stableUnique([
      ...(terminalPredecessor ? [] : (current?.causes ?? [])),
      command.cause,
    ]);
    const state = command.targetHasClaim
      ? ("COVERED_BY_CLAIM" as const)
      : terminalPredecessor
        ? ("HELD" as const)
        : (current?.state ?? ("HELD" as const));
    if (
      current &&
      !terminalPredecessor &&
      JSON.stringify(sessionIds) === JSON.stringify(current.sessionIds) &&
      JSON.stringify(causes) === JSON.stringify(current.causes) &&
      state === current.state &&
      command.expiresAt === current.expiresAt
    ) {
      return Object.freeze({
        outcome: "NO_CHANGE",
        reservation: current,
        claimMutation: "NONE",
        committedDelta: 0,
      });
    }
    const body = Object.freeze({
      reservationId: input.reservationId,
      revision: (current?.revision ?? 0) + 1,
      ...(current ? { previousRevisionId: current.reservationId } : {}),
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workItemId: input.workItemId,
      sessionIds,
      state,
      causes,
      causeSetHash: sha256(causes as JsonValue),
      reservedAt: terminalPredecessor ? command.at : (current?.reservedAt ?? command.at),
      expiresAt: command.expiresAt,
    });
    const reservation = Object.freeze({ ...body, semanticHash: reservationSemantic(body) });
    return Object.freeze({
      outcome: "APPENDED",
      reservation,
      claimMutation: "NONE",
      committedDelta: (!current || terminalPredecessor) && !command.targetHasClaim ? 1 : 0,
    });
  }
  if (current && (current.state === "CONVERTED" || current.state === "RELEASED")) {
    const expectedState = command.kind === "CONVERT_TO_REVIEW_CLAIM" ? "CONVERTED" : "RELEASED";
    if (
      current.state === expectedState &&
      current.sessionIds.includes(command.sessionId) &&
      current.causes.includes(command.cause) &&
      current.completedAt === command.at
    ) {
      return Object.freeze({
        outcome: "NO_CHANGE",
        reservation: current,
        claimMutation: "NONE",
        committedDelta: 0,
      });
    }
    throw new Error("REVIEW_RESERVATION_TERMINAL");
  }
  if (!current && command.kind === "CONVERT_TO_REVIEW_CLAIM") {
    const causes = Object.freeze([command.cause]);
    const body = Object.freeze({
      reservationId: input.reservationId,
      revision: 1,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workItemId: input.workItemId,
      sessionIds: Object.freeze([command.sessionId]),
      state: "CONVERTED" as const,
      causes,
      causeSetHash: sha256(causes as JsonValue),
      reservedAt: command.at,
      expiresAt: new Date(Date.parse(command.at) + 1).toISOString(),
      completedAt: command.at,
    });
    const reservation = Object.freeze({ ...body, semanticHash: reservationSemantic(body) });
    return Object.freeze({
      outcome: "APPENDED",
      reservation,
      claimMutation: command.targetHasClaim ? ("MERGE" as const) : ("CREATE" as const),
      committedDelta: command.targetHasClaim ? 0 : (1 as const),
    });
  }
  if (
    !current ||
    (current.state !== "HELD" && current.state !== "COVERED_BY_CLAIM") ||
    !current.sessionIds.includes(command.sessionId)
  )
    throw new Error("REVIEW_RESERVATION_NOT_HELD");
  const causes = stableUnique([...current.causes, command.cause]);
  const state =
    command.kind === "CONVERT_TO_REVIEW_CLAIM" ? ("CONVERTED" as const) : ("RELEASED" as const);
  const body = Object.freeze({
    reservationId: input.reservationId,
    revision: current.revision + 1,
    previousRevisionId: current.reservationId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workItemId: input.workItemId,
    sessionIds: current.sessionIds,
    state,
    causes,
    causeSetHash: sha256(causes as JsonValue),
    reservedAt: current.reservedAt,
    expiresAt: current.expiresAt,
    completedAt: command.at,
  });
  const reservation = Object.freeze({ ...body, semanticHash: reservationSemantic(body) });
  const claimMutation =
    command.kind === "CONVERT_TO_REVIEW_CLAIM"
      ? command.targetHasClaim
        ? ("MERGE" as const)
        : ("CREATE" as const)
      : ("NONE" as const);
  const committedDelta =
    command.kind === "RELEASE" && current.state === "HELD" ? (-1 as const) : (0 as const);
  return Object.freeze({ outcome: "APPENDED", reservation, claimMutation, committedDelta });
}
