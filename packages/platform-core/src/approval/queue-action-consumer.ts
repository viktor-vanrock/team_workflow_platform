import { type JsonValue, sha256 } from "@awp/platform-contracts";

import type { Sha256Digest } from "../shared/primitives.ts";
import type {
  ApprovalAuthorizationScopeWitness,
  QueueActionCandidateForApproval,
} from "./approval-subject-v2.ts";

export const QUEUE_CONTROL_ACTION_SCHEMA_ID =
  "urn:awp:schemas:006:queue-control-action:v1" as const;

export type QueueActionKind = QueueActionCandidateForApproval["actionKind"];

export interface QueueControlAction extends Readonly<Record<string, JsonValue>> {
  readonly schemaVersion: "queue-control-action@1.0.0";
  readonly actionId: string;
  readonly actionKind: QueueActionKind;
  readonly scope: QueueActionCandidateForApproval["scope"];
  readonly target: QueueActionCandidateForApproval["target"];
  readonly expectedState: Readonly<Record<string, JsonValue>>;
  readonly requestedEffect: Readonly<Record<string, JsonValue>>;
  readonly reason: string;
  readonly expiresAt?: string;
  readonly approvalPolicy: "NO_SECOND_APPROVAL" | "SELF_APPROVAL_FORBIDDEN";
  readonly idempotencyKeyHash: Sha256Digest;
  readonly actionHash: Sha256Digest;
}

export interface QueueActionPair {
  readonly actionId: string;
  readonly candidateSchemaId: "urn:awp:schemas:006:queue-action-candidate:v1";
  readonly candidateSchemaVersion: 1;
  readonly candidate: QueueActionCandidateForApproval;
  readonly publicIntentHash: Sha256Digest;
  readonly witnessSchemaId: typeof QUEUE_CONTROL_ACTION_SCHEMA_ID;
  readonly witnessSchemaVersion: 1;
  readonly witness: QueueControlAction;
  readonly actionHash: Sha256Digest;
}

export interface QueuePrivateAuthorizationFacts {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly requiredPermission: string;
  readonly classificationDecision: string;
  readonly authorizedProjectSetHash?: Sha256Digest;
  readonly membershipRef?: unknown;
  readonly entitlementRefs?: readonly unknown[];
  readonly roleAssignmentRefs?: readonly unknown[];
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function without<T extends Readonly<Record<string, JsonValue>>>(
  value: T,
  keys: readonly string[],
): Readonly<Record<string, JsonValue>> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

export function queueControlActionHash(
  witness: Omit<QueueControlAction, "actionHash"> | QueueControlAction,
): Sha256Digest {
  return sha256(without(witness as QueueControlAction, ["actionHash"]));
}

export function queueActionPublicIntentHash(
  candidate: QueueActionCandidateForApproval,
): Sha256Digest {
  return sha256(candidate as unknown as JsonValue);
}

function effectKind(effect: JsonValue): string {
  if (!effect || typeof effect !== "object" || Array.isArray(effect)) {
    throw new Error("QUEUE_ACTION_EFFECT_KIND_INVALID");
  }
  const record = effect as Readonly<Record<string, JsonValue>>;
  if (typeof record.kind !== "string") throw new Error("QUEUE_ACTION_EFFECT_KIND_INVALID");
  return record.kind;
}

function publicEffectProjection(witnessEffect: Readonly<Record<string, JsonValue>>): JsonValue {
  const kind = effectKind(witnessEffect);
  if (kind === "ANCHOR_UNAVAILABLE_NO_OP") return without(witnessEffect, ["requestedAnchor"]);
  if (kind === "ALLOW_EXPEDITE_CAPACITY") return without(witnessEffect, ["originatingActionHash"]);
  return witnessEffect;
}

function assertExpectedStateMapping(
  visible: JsonValue,
  internal: Readonly<Record<string, JsonValue>>,
): void {
  if (!visible || typeof visible !== "object" || Array.isArray(visible))
    throw new Error("QUEUE_ACTION_VISIBLE_STATE_INVALID");
  const visibleRecord = visible as Readonly<Record<string, JsonValue>>;
  if (visibleRecord.kind !== internal.kind) throw new Error("QUEUE_ACTION_STATE_KIND_MISMATCH");
  for (const [key, value] of Object.entries(visibleRecord)) {
    if (key === "policyFacetRef" || key === "authorizedCapacitySnapshotRef") continue;
    if (!(key in internal) || sha256(value) !== sha256(internal[key]!)) {
      throw new Error(`QUEUE_ACTION_VISIBLE_STATE_MISMATCH:${key}`);
    }
  }
}

export function assertQueueActionPair(pair: QueueActionPair): void {
  const { candidate, witness } = pair;
  if (
    pair.actionId !== candidate.actionId ||
    pair.actionId !== witness.actionId ||
    pair.candidateSchemaId !== "urn:awp:schemas:006:queue-action-candidate:v1" ||
    pair.candidateSchemaVersion !== 1 ||
    pair.witnessSchemaId !== QUEUE_CONTROL_ACTION_SCHEMA_ID ||
    pair.witnessSchemaVersion !== 1
  ) {
    throw new Error("QUEUE_ACTION_PAIR_IDENTITY_MISMATCH");
  }
  if (pair.publicIntentHash !== queueActionPublicIntentHash(candidate))
    throw new Error("QUEUE_ACTION_PUBLIC_HASH_MISMATCH");
  if (
    pair.actionHash !== queueControlActionHash(witness) ||
    witness.actionHash !== pair.actionHash
  ) {
    throw new Error("QUEUE_ACTION_PRIVATE_HASH_MISMATCH");
  }
  if (
    candidate.actionKind !== witness.actionKind ||
    candidate.approvalPolicy !== witness.approvalPolicy ||
    candidate.reason !== witness.reason ||
    candidate.expiresAt !== witness.expiresAt ||
    sha256(candidate.scope as unknown as JsonValue) !==
      sha256(witness.scope as unknown as JsonValue) ||
    sha256(candidate.target as unknown as JsonValue) !==
      sha256(witness.target as unknown as JsonValue)
  ) {
    throw new Error("QUEUE_ACTION_PAIR_CONTENT_MISMATCH");
  }
  if (
    effectKind(candidate.requestedEffect) !== effectKind(witness.requestedEffect) ||
    sha256(candidate.requestedEffect) !== sha256(publicEffectProjection(witness.requestedEffect))
  ) {
    throw new Error("QUEUE_ACTION_EFFECT_MAPPING_MISMATCH");
  }
  assertExpectedStateMapping(candidate.expectedVisibleState, witness.expectedState);
}

export function createQueueActionPair(
  input: Readonly<{
    candidate: QueueActionCandidateForApproval;
    witness: Omit<QueueControlAction, "actionHash">;
  }>,
): QueueActionPair {
  const candidate = structuredClone(input.candidate);
  const witnessSemantic = structuredClone(input.witness);
  const actionHash = queueControlActionHash(witnessSemantic);
  const witness = { ...witnessSemantic, actionHash } as QueueControlAction;
  const pair: QueueActionPair = {
    actionId: candidate.actionId,
    candidateSchemaId: "urn:awp:schemas:006:queue-action-candidate:v1",
    candidateSchemaVersion: 1,
    candidate,
    publicIntentHash: queueActionPublicIntentHash(candidate),
    witnessSchemaId: QUEUE_CONTROL_ACTION_SCHEMA_ID,
    witnessSchemaVersion: 1,
    witness,
    actionHash,
  };
  assertQueueActionPair(pair);
  return deepFreeze(pair) as QueueActionPair;
}

export function projectSafeQueueAuthorizationWitness(
  scope: QueueActionCandidateForApproval["scope"],
  facts: QueuePrivateAuthorizationFacts,
  evaluatedAt: string,
): ApprovalAuthorizationScopeWitness {
  if (
    scope.workspaceId !== facts.workspaceId ||
    !facts.requiredPermission ||
    !facts.classificationDecision ||
    !Date.parse(evaluatedAt)
  ) {
    throw new Error("QUEUE_ACTION_AUTHORIZATION_WITNESS_INPUT_INVALID");
  }
  if (scope.kind === "PROJECT") {
    if (scope.projectId !== facts.projectId)
      throw new Error("QUEUE_ACTION_PROJECT_AUTHORIZATION_SCOPE_MISMATCH");
    const safe = {
      workspaceId: facts.workspaceId,
      projectId: facts.projectId,
      requiredPermission: facts.requiredPermission,
      classificationDecision: facts.classificationDecision,
    };
    return deepFreeze({
      scopeKind: "PROJECT",
      workspaceId: facts.workspaceId,
      projectId: facts.projectId,
      projectAuthorizationFacetHash: sha256(safe),
      requiredPermission: facts.requiredPermission,
      evaluatedAt,
    }) as ApprovalAuthorizationScopeWitness;
  }
  if (
    !facts.authorizedProjectSetHash ||
    facts.authorizedProjectSetHash !== scope.authorizedProjectSetHash
  ) {
    throw new Error("QUEUE_ACTION_PORTFOLIO_AUTHORIZATION_SCOPE_MISMATCH");
  }
  return deepFreeze({
    scopeKind: "AUTHORIZED_PORTFOLIO",
    workspaceId: facts.workspaceId,
    authorizedProjectSetHash: facts.authorizedProjectSetHash,
    requiredPermission: facts.requiredPermission,
    evaluatedAt,
  }) as ApprovalAuthorizationScopeWitness;
}

export interface QueueActionPairPort {
  getQueueActionPair(
    workspaceId: string,
    projectId: string,
    actionId: string,
  ): Promise<QueueActionPair | undefined>;
}

export type QueueActionConsumedResultRef = Readonly<{
  sourceType:
    | "QUEUE_ACTION_CANDIDATE"
    | "WORK_ITEM_QUEUE_CONTROL_REVISION"
    | "QUEUE_ORDER_OVERRIDE_REVISION"
    | "CAPACITY_ADMISSION_DECISION";
  sourceId: string;
  sourceVersion: number;
  semanticHash: Sha256Digest;
}>;

export function assertQueueActionConsumedResult(
  pair: QueueActionPair,
  result: unknown,
): asserts result is Readonly<{ resultRef: QueueActionConsumedResultRef }> {
  const value = result as Readonly<{ resultRef?: QueueActionConsumedResultRef }> | undefined;
  const ref = value?.resultRef;
  if (
    !ref ||
    !ref.sourceId ||
    !Number.isSafeInteger(ref.sourceVersion) ||
    ref.sourceVersion < 1 ||
    !/^sha256:[a-f0-9]{64}$/u.test(ref.semanticHash)
  ) {
    throw new Error("QUEUE_ACTION_RESULT_REF_INVALID");
  }
  const effect = pair.candidate.requestedEffect as Readonly<Record<string, JsonValue>>;
  if (pair.candidate.actionKind === "QUEUE_ORDER_OVERRIDE") {
    if (effect.kind === "ANCHOR_UNAVAILABLE_NO_OP") {
      if (
        ref.sourceType !== "QUEUE_ACTION_CANDIDATE" ||
        ref.sourceId !== pair.actionId ||
        ref.sourceVersion !== 1 ||
        ref.semanticHash !== pair.publicIntentHash
      ) {
        throw new Error("QUEUE_ORDER_NO_OP_RESULT_REF_MISMATCH");
      }
      return;
    }
    if (effect.kind !== "MOVE" || ref.sourceType !== "QUEUE_ORDER_OVERRIDE_REVISION")
      throw new Error("QUEUE_ORDER_RESULT_FAMILY_MISMATCH");
    return;
  }
  if (
    pair.candidate.actionKind === "QUEUE_CONTROL_ACCEPT" &&
    ref.sourceType !== "WORK_ITEM_QUEUE_CONTROL_REVISION"
  ) {
    throw new Error("QUEUE_CONTROL_RESULT_FAMILY_MISMATCH");
  }
  if (
    new Set(["SERVICE_CLASS_EXPEDITE", "EXPEDITE_CAPACITY_OVERRIDE", "WIP_ADMISSION_OVERRIDE"]).has(
      pair.candidate.actionKind,
    ) &&
    ref.sourceType !== "CAPACITY_ADMISSION_DECISION"
  ) {
    throw new Error("CAPACITY_ADMISSION_RESULT_FAMILY_MISMATCH");
  }
}

export interface QueueActionConsumptionContext {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly approvalId: string;
  readonly approverId: string;
  readonly currentAuthorizationWitness: ApprovalAuthorizationScopeWitness;
}

export interface QueueActionConsumer<TResult = unknown> {
  readonly key: string;
  readonly actionKinds: readonly QueueActionKind[];
  consume(pair: QueueActionPair, context: QueueActionConsumptionContext): Promise<TResult>;
}

export interface CapacityActionExpectedState extends Readonly<Record<string, JsonValue>> {
  readonly kind: "CAPACITY";
  readonly policyRef: Readonly<{ id: string; version: number; semanticHash: Sha256Digest }>;
  readonly policyMode: "MEASURE_ONLY" | "ENFORCED";
  readonly expectedControlVersion: number;
  readonly expectedQueueEntry: Readonly<{
    queueEntryId: string;
    revision: number;
    semanticHash: Sha256Digest;
    inputFingerprint: Sha256Digest;
  }>;
  readonly expectedCapacityHeadVersion: number;
  readonly workspaceHumanWipLimit: number | null;
  readonly activeExpediteLimit: number | null;
  readonly humanOccupiedCount: number;
  readonly reviewReservedCount: number;
  readonly humanCommittedCount: number;
  readonly forcedExternalCount: number;
  readonly activeExpediteCount: number;
  readonly claimSetHash: Sha256Digest;
  readonly reservationSetHash: Sha256Digest;
  readonly expediteSetHash: Sha256Digest;
  readonly sessionRef?: Readonly<Record<string, JsonValue>>;
  readonly operationalProjectionRef: Readonly<Record<string, JsonValue>>;
}

export type CapacityActionEffect =
  | Readonly<{
      kind: "SET_EXPEDITE";
      beforeServiceClass: "STANDARD" | "FIXED_DATE" | "EXPEDITE";
      afterServiceClass: "EXPEDITE";
      reviewAt: string;
    }>
  | Readonly<{
      kind: "CLEAR_EXPEDITE";
      beforeServiceClass: "EXPEDITE";
      afterServiceClass: "STANDARD";
    }>
  | Readonly<{
      kind: "ALLOW_EXPEDITE_CAPACITY";
      workItemRef: Readonly<Record<string, JsonValue>>;
      originatingActionRef: Readonly<{
        sourceType: "QUEUE_ACTION_CANDIDATE";
        sourceId: string;
        sourceVersion: 1;
        semanticHash: Sha256Digest;
      }>;
      originatingActionHash: Sha256Digest;
      requestedExpediteEffect: Readonly<{
        kind: "SET_EXPEDITE";
        beforeServiceClass: "STANDARD" | "FIXED_DATE" | "EXPEDITE";
        afterServiceClass: "EXPEDITE";
        reviewAt: string;
      }>;
    }>
  | Readonly<{
      kind: "ALLOW_WIP_ADMISSION";
      activityKind: "MANUAL_SESSION_START" | "MANUAL_SESSION_RESUME" | "AUTOMATED_SESSION_LAUNCH";
      sessionRef: Readonly<Record<string, JsonValue>>;
      requestedSessionState: "RUNNING" | "REVIEW_REQUIRED";
    }>;

function assertCapacityExpectedState(value: CapacityActionExpectedState): void {
  const counts = [
    value.expectedControlVersion,
    value.expectedCapacityHeadVersion,
    value.humanOccupiedCount,
    value.reviewReservedCount,
    value.humanCommittedCount,
    value.forcedExternalCount,
    value.activeExpediteCount,
  ];
  if (
    value.kind !== "CAPACITY" ||
    counts.some((count) => !Number.isSafeInteger(count) || count < 0) ||
    value.expectedCapacityHeadVersion < 1
  )
    throw new Error("CAPACITY_ACTION_EXPECTED_STATE_INVALID");
  if (value.policyMode === "MEASURE_ONLY") {
    if (value.workspaceHumanWipLimit !== null || value.activeExpediteLimit !== null)
      throw new Error("CAPACITY_ACTION_MEASURE_ONLY_LIMIT_FORBIDDEN");
  } else if (
    !Number.isSafeInteger(value.workspaceHumanWipLimit) ||
    Number(value.workspaceHumanWipLimit) < 1 ||
    !Number.isSafeInteger(value.activeExpediteLimit) ||
    Number(value.activeExpediteLimit) < 1
  )
    throw new Error("CAPACITY_ACTION_ENFORCED_LIMIT_REQUIRED");
}

/** Builds the public candidate and its private global-capacity witness as one hash-bound pair. */
export function prepareCapacityQueueAction(
  input: Readonly<{
    actionId: string;
    actionKind: "SERVICE_CLASS_EXPEDITE" | "EXPEDITE_CAPACITY_OVERRIDE" | "WIP_ADMISSION_OVERRIDE";
    requestKey: string;
    requestHash: Sha256Digest;
    workspaceId: string;
    projectId: string;
    workItemRef: Readonly<Record<string, JsonValue>>;
    expectedState: CapacityActionExpectedState;
    authorizedCapacitySnapshotRef: Readonly<{
      id: string;
      version: number;
      semanticHash: Sha256Digest;
    }>;
    effect: CapacityActionEffect;
    reason: string;
    expiresAt?: string;
  }>,
): QueueActionPair {
  assertCapacityExpectedState(input.expectedState);
  if (!input.actionId || !input.requestKey || !input.reason.trim() || input.reason.length > 2_000)
    throw new Error("CAPACITY_ACTION_INPUT_INVALID");
  const override =
    input.actionKind === "EXPEDITE_CAPACITY_OVERRIDE" ||
    input.actionKind === "WIP_ADMISSION_OVERRIDE";
  const clear =
    input.actionKind === "SERVICE_CLASS_EXPEDITE" && input.effect.kind === "CLEAR_EXPEDITE";
  if ((override || !clear) && (!input.expiresAt || !Number.isFinite(Date.parse(input.expiresAt))))
    throw new Error("CAPACITY_ACTION_EXPIRY_REQUIRED");
  if (clear && input.expiresAt !== undefined)
    throw new Error("CAPACITY_ACTION_CLEAR_EXPIRY_FORBIDDEN");
  if (
    input.actionKind === "SERVICE_CLASS_EXPEDITE" &&
    !new Set(["SET_EXPEDITE", "CLEAR_EXPEDITE"]).has(input.effect.kind)
  )
    throw new Error("CAPACITY_ACTION_EFFECT_MISMATCH");
  if (input.actionKind === "SERVICE_CLASS_EXPEDITE" && input.expectedState.sessionRef !== undefined)
    throw new Error("EXPEDITE_SESSION_REF_FORBIDDEN");
  if (input.actionKind === "EXPEDITE_CAPACITY_OVERRIDE") {
    if (
      input.expectedState.policyMode !== "ENFORCED" ||
      input.expectedState.sessionRef !== undefined ||
      input.effect.kind !== "ALLOW_EXPEDITE_CAPACITY" ||
      input.effect.originatingActionRef.sourceType !== "QUEUE_ACTION_CANDIDATE" ||
      input.effect.originatingActionRef.sourceVersion !== 1 ||
      !/^sha256:[a-f0-9]{64}$/u.test(input.effect.originatingActionHash)
    )
      throw new Error("EXPEDITE_CAPACITY_OVERRIDE_BINDING_INVALID");
  }
  if (input.actionKind === "WIP_ADMISSION_OVERRIDE") {
    if (
      input.expectedState.policyMode !== "ENFORCED" ||
      !input.expectedState.sessionRef ||
      input.effect.kind !== "ALLOW_WIP_ADMISSION" ||
      sha256(input.effect.sessionRef as JsonValue) !==
        sha256(input.expectedState.sessionRef as JsonValue) ||
      (input.effect.activityKind !== "MANUAL_SESSION_RESUME" &&
        input.effect.requestedSessionState !== "RUNNING")
    )
      throw new Error("WIP_ADMISSION_OVERRIDE_BINDING_INVALID");
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
  const safeExpected = without(
    input.expectedState as unknown as Readonly<Record<string, JsonValue>>,
    [
      "policyRef",
      "expectedCapacityHeadVersion",
      "workspaceHumanWipLimit",
      "activeExpediteLimit",
      "humanOccupiedCount",
      "reviewReservedCount",
      "humanCommittedCount",
      "forcedExternalCount",
      "activeExpediteCount",
      "claimSetHash",
      "reservationSetHash",
      "expediteSetHash",
    ],
  );
  const { policyRef } = input.expectedState;
  const expectedVisibleState = Object.freeze({
    ...safeExpected,
    policyFacetRef: policyRef,
    authorizedCapacitySnapshotRef: input.authorizedCapacitySnapshotRef,
  });
  const approvalPolicy = clear
    ? ("NO_SECOND_APPROVAL" as const)
    : ("SELF_APPROVAL_FORBIDDEN" as const);
  return createQueueActionPair({
    candidate: {
      schemaVersion: "queue-action-candidate@1.0.0",
      actionId: input.actionId,
      actionKind: input.actionKind,
      scope,
      target,
      requestHash: input.requestHash,
      expectedVisibleState,
      requestedEffect:
        input.effect.kind === "ALLOW_EXPEDITE_CAPACITY"
          ? without(input.effect as unknown as Readonly<Record<string, JsonValue>>, [
              "originatingActionHash",
            ])
          : input.effect,
      reason: input.reason,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      approvalPolicy,
    },
    witness: {
      schemaVersion: "queue-control-action@1.0.0",
      actionId: input.actionId,
      actionKind: input.actionKind,
      scope,
      target,
      expectedState: input.expectedState,
      requestedEffect: input.effect,
      reason: input.reason,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      approvalPolicy,
      idempotencyKeyHash: sha256(input.requestKey),
    },
  });
}

export interface ExactCapacityApprovalBinding {
  readonly approvalId: string;
  readonly state: "APPROVED" | "CONSUMED" | "PENDING" | "REJECTED" | "INVALIDATED";
  readonly initiatorId: string;
  readonly approverId: string;
  readonly approverRole: string;
  readonly expiresAt: string;
}

/** Rechecks the exact approved intent immediately before the serialized capacity mutation. */
export function assertExactCapacityActionConsumption(
  input: Readonly<{
    pair: QueueActionPair;
    currentExpectedState: CapacityActionExpectedState;
    currentWorkItemRef: Readonly<Record<string, JsonValue>>;
    approval?: ExactCapacityApprovalBinding;
    originatingPair?: QueueActionPair;
    blockedFromState?: "RUNNING" | "REVIEW_REQUIRED";
    now: string;
  }>,
): void {
  assertQueueActionPair(input.pair);
  const pair = input.pair;
  if (
    pair.candidate.scope.kind !== "PROJECT" ||
    pair.candidate.target.projectId !== pair.candidate.scope.projectId ||
    pair.candidate.target.workspaceId !== pair.candidate.scope.workspaceId ||
    sha256(pair.candidate.target.workItemRef) !== sha256(input.currentWorkItemRef as JsonValue)
  )
    throw new Error("CAPACITY_ACTION_TARGET_SCOPE_MISMATCH");
  if (
    sha256(pair.witness.expectedState as JsonValue) !==
    sha256(input.currentExpectedState as unknown as JsonValue)
  )
    throw new Error("CAPACITY_ACTION_STALE");
  const requiresApproval = pair.candidate.approvalPolicy === "SELF_APPROVAL_FORBIDDEN";
  if (requiresApproval) {
    const approval = input.approval;
    if (
      !approval ||
      approval.state !== "APPROVED" ||
      !new Set(["Lead", "qa-lead"]).has(approval.approverRole) ||
      approval.approverId === approval.initiatorId ||
      pair.candidate.expiresAt !== approval.expiresAt ||
      Date.parse(input.now) >= Date.parse(approval.expiresAt)
    )
      throw new Error("CAPACITY_ACTION_APPROVAL_INVALID");
  }
  const effect = pair.witness.requestedEffect as unknown as CapacityActionEffect;
  if (pair.candidate.actionKind === "WIP_ADMISSION_OVERRIDE") {
    if (
      effect.kind !== "ALLOW_WIP_ADMISSION" ||
      !input.blockedFromState ||
      effect.requestedSessionState !== input.blockedFromState ||
      sha256(effect.sessionRef as JsonValue) !==
        sha256(input.currentExpectedState.sessionRef as JsonValue)
    )
      throw new Error("WIP_ADMISSION_OVERRIDE_STALE_SESSION");
  }
  if (pair.candidate.actionKind === "EXPEDITE_CAPACITY_OVERRIDE") {
    if (effect.kind !== "ALLOW_EXPEDITE_CAPACITY" || !input.originatingPair)
      throw new Error("EXPEDITE_OVERRIDE_ORIGIN_REQUIRED");
    assertQueueActionPair(input.originatingPair);
    if (
      input.originatingPair.candidate.actionKind !== "SERVICE_CLASS_EXPEDITE" ||
      input.originatingPair.actionId !== effect.originatingActionRef.sourceId ||
      input.originatingPair.publicIntentHash !== effect.originatingActionRef.semanticHash ||
      input.originatingPair.actionHash !== effect.originatingActionHash ||
      sha256(input.originatingPair.candidate.target as unknown as JsonValue) !==
        sha256(pair.candidate.target as unknown as JsonValue) ||
      sha256(input.originatingPair.candidate.requestedEffect) !==
        sha256(effect.requestedExpediteEffect as unknown as JsonValue)
    ) {
      throw new Error("EXPEDITE_OVERRIDE_ORIGIN_MISMATCH");
    }
  }
}

export class QueueActionConsumerRegistry {
  readonly #consumers: readonly QueueActionConsumer[];

  constructor(consumers: readonly QueueActionConsumer[]) {
    const keys = new Set<string>();
    for (const consumer of consumers) {
      if (!consumer.key || keys.has(consumer.key))
        throw new Error(`QUEUE_ACTION_CONSUMER_COLLISION:${consumer.key}`);
      keys.add(consumer.key);
    }
    this.#consumers = Object.freeze(
      [...consumers].sort((left, right) => left.key.localeCompare(right.key)),
    );
  }

  consumerFor(pair: QueueActionPair): QueueActionConsumer {
    assertQueueActionPair(pair);
    const matches = this.#consumers.filter(({ actionKinds }) =>
      actionKinds.includes(pair.candidate.actionKind),
    );
    if (matches.length === 0)
      throw new Error(`QUEUE_ACTION_CONSUMER_NOT_FOUND:${pair.candidate.actionKind}`);
    if (matches.length > 1)
      throw new Error(`QUEUE_ACTION_CONSUMER_AMBIGUOUS:${pair.candidate.actionKind}`);
    return matches[0]!;
  }
}

export class QueueActionConsumptionService {
  constructor(
    private readonly pairs: QueueActionPairPort,
    private readonly consumers: QueueActionConsumerRegistry,
  ) {}

  async consume(actionId: string, context: QueueActionConsumptionContext): Promise<unknown> {
    const pair = await this.pairs.getQueueActionPair(
      context.workspaceId,
      context.projectId,
      actionId,
    );
    if (!pair) throw new Error("QUEUE_ACTION_PAIR_NOT_FOUND");
    if (pair.actionId !== actionId) throw new Error("QUEUE_ACTION_PAIR_LOOKUP_MISMATCH");
    const result = await this.consumers.consumerFor(pair).consume(pair, context);
    assertQueueActionConsumedResult(pair, result);
    return result;
  }
}
