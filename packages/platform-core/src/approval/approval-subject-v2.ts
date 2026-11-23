import { type JsonValue, sha256 } from "@awp/platform-contracts";

import type { ActorReference, AuthorizationBasisRef, Sha256Digest } from "../shared/primitives.ts";
import type {
  ApprovalDecisionStatus,
  ApprovalEffectAuthorizationStatus,
  ApprovalInvalidationReason,
} from "./approval.ts";

export const APPROVAL_SUBJECT_V2_SCHEMA_ID =
  "urn:awp:contracts:commands:approval-subject:v2" as const;
export const QUEUE_ACTION_CANDIDATE_SCHEMA_ID =
  "urn:awp:schemas:006:queue-action-candidate:v1" as const;
export const QUEUE_ACTION_CANDIDATE_SCHEMA_DIGEST =
  "sha256:15100bb9367d8a2e6c573fbdffc5de1417727fe53d5ac404e1ba1a909eae9d13" as const;

export interface ApprovalSchemaRef {
  readonly id: string;
  readonly version: number;
  readonly digest: Sha256Digest;
}

export interface ApprovalSchemaBoundValue<T extends JsonValue = JsonValue> {
  readonly schemaRef: ApprovalSchemaRef;
  readonly value: T;
}

export type ApprovalAuthorizationScopeWitness =
  | Readonly<{
      scopeKind: "PROJECT";
      workspaceId: string;
      projectId: string;
      projectAuthorizationFacetHash: Sha256Digest;
      requiredPermission: string;
      evaluatedAt: string;
    }>
  | Readonly<{
      scopeKind: "AUTHORIZED_PORTFOLIO";
      workspaceId: string;
      authorizedProjectSetHash: Sha256Digest;
      requiredPermission: string;
      evaluatedAt: string;
    }>;

export interface ApprovalExpectedLocalState {
  readonly resourceRef: Readonly<{ id: string; version: number }>;
  readonly resourceVersion: number;
  readonly contentHash: Sha256Digest;
  readonly aggregateResourceVersion: number;
  readonly currentPublishedVersion: number;
}

export type ApprovalV2Action =
  | Readonly<{
      actionKind: "EXTERNAL_COMMAND";
      actionId: string;
      commandType: string;
      capabilityKey: string;
      capabilityVersion: string;
      operation: string;
    }>
  | Readonly<{
      actionKind: "PLATFORM_ACTION";
      actionId: string;
      commandType: string;
    }>;

export interface QueueActionCandidateForApproval extends Readonly<Record<string, JsonValue>> {
  readonly schemaVersion: "queue-action-candidate@1.0.0";
  readonly actionId: string;
  readonly actionKind:
    | "QUEUE_CONTROL_ACCEPT"
    | "QUEUE_ORDER_OVERRIDE"
    | "SERVICE_CLASS_EXPEDITE"
    | "EXPEDITE_CAPACITY_OVERRIDE"
    | "WIP_ADMISSION_OVERRIDE";
  readonly scope:
    | Readonly<{ kind: "PROJECT"; workspaceId: string; projectId: string }>
    | Readonly<{
        kind: "AUTHORIZED_PORTFOLIO";
        workspaceId: string;
        authorizedProjectSetHash: Sha256Digest;
      }>;
  readonly target: Readonly<{
    kind: "WORK_ITEM";
    workspaceId: string;
    projectId: string;
    workItemRef: JsonValue;
  }>;
  readonly requestHash: Sha256Digest;
  readonly expectedVisibleState: JsonValue;
  readonly requestedEffect: JsonValue;
  readonly reason: string;
  readonly expiresAt?: string;
  readonly approvalPolicy: "NO_SECOND_APPROVAL" | "SELF_APPROVAL_FORBIDDEN";
}

export interface ApprovalV2Decision {
  readonly approver: Extract<ActorReference, { kind: "HUMAN" }>;
  readonly approverRole: string;
  readonly authorizationBasis?: AuthorizationBasisRef;
  readonly authorizationScopeWitness?: ApprovalAuthorizationScopeWitness;
  readonly decidedAt: string;
}

interface ApprovalSubjectV2Base {
  readonly approvalId: string;
  readonly schemaVersion: 2;
  readonly subjectSchemaId: typeof APPROVAL_SUBJECT_V2_SCHEMA_ID;
  readonly subjectSchemaVersion: 2;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly initiator: ActorReference;
  readonly target: ApprovalSchemaBoundValue;
  readonly targetHash: Sha256Digest;
  readonly payloadHash: Sha256Digest;
  readonly requiredPermission: string;
  readonly separationOfDutyPolicy: "SELF_APPROVAL_FORBIDDEN" | "SELF_APPROVAL_ALLOWED";
  readonly effectIdempotencyKey: string;
  readonly dataClassificationKey: string;
  readonly expiresAt: string;
  readonly subjectHash: Sha256Digest;
  readonly decisionStatus: ApprovalDecisionStatus;
  readonly effectAuthorizationStatus: ApprovalEffectAuthorizationStatus;
  readonly decision?: ApprovalV2Decision;
  readonly invalidationReason?: ApprovalInvalidationReason;
  readonly invalidatedAt?: string;
  readonly consumedAt?: string;
  readonly resourceVersion: number;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

export interface ExternalCommandApprovalSubjectV2 extends ApprovalSubjectV2Base {
  readonly initiatorAuthorizationBasis: AuthorizationBasisRef;
  readonly initiatorAuthorizationScopeWitness?: never;
  readonly action: Extract<ApprovalV2Action, { actionKind: "EXTERNAL_COMMAND" }>;
  readonly expectedExternalState: JsonValue;
  readonly expectedLocalState?: never;
  readonly bindingRef: Readonly<{ id: string; version: number }>;
  readonly profileRefs: readonly Readonly<{ id: string; version: number }>[];
}

export interface PlatformActionApprovalSubjectV2 extends ApprovalSubjectV2Base {
  readonly initiatorAuthorizationBasis?: never;
  readonly initiatorAuthorizationScopeWitness: ApprovalAuthorizationScopeWitness;
  readonly action: Extract<ApprovalV2Action, { actionKind: "PLATFORM_ACTION" }>;
  readonly target: ApprovalSchemaBoundValue<QueueActionCandidateForApproval>;
  readonly expectedExternalState?: never;
  readonly expectedLocalState: ApprovalExpectedLocalState;
  readonly bindingRef?: never;
  readonly profileRefs?: never;
  readonly separationOfDutyPolicy: "SELF_APPROVAL_FORBIDDEN";
}

export type ApprovalSubjectV2 = ExternalCommandApprovalSubjectV2 | PlatformActionApprovalSubjectV2;

export interface CreatePlatformActionApprovalV2Input {
  readonly approvalId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly initiator: Extract<ActorReference, { kind: "HUMAN" }>;
  readonly initiatorAuthorizationScopeWitness: ApprovalAuthorizationScopeWitness;
  readonly action: Extract<ApprovalV2Action, { actionKind: "PLATFORM_ACTION" }>;
  readonly candidate: QueueActionCandidateForApproval;
  readonly requiredPermission: string;
  readonly effectIdempotencyKey: string;
  readonly dataClassificationKey: string;
  readonly expiresAt: string;
  readonly createdAt: string;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDigest(value: unknown): value is Sha256Digest {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function immutableProjection(subject: ApprovalSubjectV2): JsonValue {
  const common = {
    schemaVersion: subject.schemaVersion,
    subjectSchemaId: subject.subjectSchemaId,
    subjectSchemaVersion: subject.subjectSchemaVersion,
    workspaceId: subject.workspaceId,
    projectId: subject.projectId,
    initiator: subject.initiator,
    action: subject.action,
    target: subject.target,
    targetHash: subject.targetHash,
    payloadHash: subject.payloadHash,
    requiredPermission: subject.requiredPermission,
    separationOfDutyPolicy: subject.separationOfDutyPolicy,
    effectIdempotencyKey: subject.effectIdempotencyKey,
    dataClassificationKey: subject.dataClassificationKey,
    expiresAt: subject.expiresAt,
  };
  if (subject.action.actionKind === "EXTERNAL_COMMAND") {
    const external = subject as ExternalCommandApprovalSubjectV2;
    return {
      ...common,
      initiatorAuthorizationBasis: external.initiatorAuthorizationBasis,
      expectedExternalState: external.expectedExternalState,
      bindingRef: external.bindingRef,
      profileRefs: [...external.profileRefs].sort((left, right) =>
        `${left.id}:${left.version}`.localeCompare(`${right.id}:${right.version}`),
      ),
    } as unknown as JsonValue;
  }
  return {
    ...common,
    initiatorAuthorizationScopeWitness: subject.initiatorAuthorizationScopeWitness,
    expectedLocalState: subject.expectedLocalState,
  } as unknown as JsonValue;
}

export function approvalSubjectV2Hash(subject: ApprovalSubjectV2): Sha256Digest {
  return sha256(immutableProjection(subject));
}

function assertSafeScopeWitness(
  witness: ApprovalAuthorizationScopeWitness,
  requiredPermission: string,
): void {
  if (witness.requiredPermission !== requiredPermission || !Date.parse(witness.evaluatedAt)) {
    throw new Error("APPROVAL_V2_AUTHORIZATION_SCOPE_WITNESS_INVALID");
  }
  const forbidden = new Set([
    "membershipRef",
    "entitlementRefs",
    "roleAssignmentRefs",
    "authorizationBasis",
  ]);
  if (Object.keys(witness).some((key) => forbidden.has(key)))
    throw new Error("APPROVAL_V2_PUBLIC_AUTHORIZATION_RECORD_REF_FORBIDDEN");
  if (witness.scopeKind === "PROJECT") {
    if (!witness.projectId || !isDigest(witness.projectAuthorizationFacetHash))
      throw new Error("APPROVAL_V2_PROJECT_WITNESS_INVALID");
  } else if (!isDigest(witness.authorizedProjectSetHash))
    throw new Error("APPROVAL_V2_PORTFOLIO_WITNESS_INVALID");
}

function assertLifecycle(subject: ApprovalSubjectV2): void {
  if (
    (subject.decisionStatus === "APPROVED" || subject.decisionStatus === "REJECTED") !==
    (subject.decision !== undefined)
  ) {
    throw new Error("APPROVAL_V2_DECISION_LIFECYCLE_INVALID");
  }
  if (
    subject.decisionStatus !== "APPROVED" &&
    subject.effectAuthorizationStatus !== "NOT_AUTHORIZED"
  ) {
    throw new Error("APPROVAL_V2_EFFECT_NOT_AUTHORIZED");
  }
  if (
    subject.decisionStatus === "APPROVED" &&
    subject.effectAuthorizationStatus === "NOT_AUTHORIZED"
  ) {
    throw new Error("APPROVAL_V2_APPROVED_EFFECT_STATE_INVALID");
  }
  if (
    (subject.effectAuthorizationStatus === "INVALIDATED") !==
    (subject.invalidationReason !== undefined && subject.invalidatedAt !== undefined)
  ) {
    throw new Error("APPROVAL_V2_INVALIDATION_LIFECYCLE_INVALID");
  }
  if ((subject.effectAuthorizationStatus === "CONSUMED") !== (subject.consumedAt !== undefined)) {
    throw new Error("APPROVAL_V2_CONSUMPTION_LIFECYCLE_INVALID");
  }
  if (subject.decision) {
    if (subject.decision.approver.kind !== "HUMAN")
      throw new Error("APPROVAL_V2_HUMAN_APPROVER_REQUIRED");
    if (
      subject.separationOfDutyPolicy === "SELF_APPROVAL_FORBIDDEN" &&
      subject.initiator.kind === "HUMAN" &&
      subject.initiator.principalId === subject.decision.approver.principalId
    ) {
      throw new Error("SELF_APPROVAL_FORBIDDEN");
    }
  }
}

function assertPlatformBinding(subject: PlatformActionApprovalSubjectV2): void {
  const candidate = subject.target.value;
  if (
    subject.target.schemaRef.id !== QUEUE_ACTION_CANDIDATE_SCHEMA_ID ||
    subject.target.schemaRef.version !== 1 ||
    subject.target.schemaRef.digest !== QUEUE_ACTION_CANDIDATE_SCHEMA_DIGEST
  ) {
    throw new Error("APPROVAL_V2_CANDIDATE_SCHEMA_REF_INVALID");
  }
  const candidateHash = sha256(candidate as unknown as JsonValue);
  if (
    subject.payloadHash !== candidateHash ||
    subject.targetHash !== sha256(subject.target as unknown as JsonValue)
  ) {
    throw new Error("APPROVAL_V2_CANDIDATE_HASH_MISMATCH");
  }
  if (
    subject.action.actionId !== candidate.actionId ||
    subject.expectedLocalState.resourceRef.id !== candidate.actionId ||
    subject.expectedLocalState.resourceRef.version !== 1 ||
    subject.expectedLocalState.resourceVersion !== 1 ||
    subject.expectedLocalState.aggregateResourceVersion !== 1 ||
    subject.expectedLocalState.currentPublishedVersion !== 0 ||
    subject.expectedLocalState.contentHash !== candidateHash
  ) {
    throw new Error("APPROVAL_V2_CANDIDATE_LOCAL_STATE_MISMATCH");
  }
  if (
    candidate.schemaVersion !== "queue-action-candidate@1.0.0" ||
    candidate.target.workspaceId !== subject.workspaceId ||
    candidate.target.projectId !== subject.projectId ||
    candidate.scope.workspaceId !== subject.workspaceId ||
    candidate.approvalPolicy !== "SELF_APPROVAL_FORBIDDEN" ||
    candidate.expiresAt !== subject.expiresAt
  ) {
    throw new Error("APPROVAL_V2_CANDIDATE_SCOPE_MISMATCH");
  }
  const witness = subject.initiatorAuthorizationScopeWitness;
  assertSafeScopeWitness(witness, subject.requiredPermission);
  if (candidate.scope.kind === "PROJECT") {
    if (
      witness.scopeKind !== "PROJECT" ||
      witness.workspaceId !== candidate.scope.workspaceId ||
      witness.projectId !== candidate.scope.projectId ||
      witness.projectId !== candidate.target.projectId
    ) {
      throw new Error("APPROVAL_V2_PROJECT_WITNESS_SCOPE_MISMATCH");
    }
  } else if (
    witness.scopeKind !== "AUTHORIZED_PORTFOLIO" ||
    witness.workspaceId !== candidate.scope.workspaceId ||
    witness.authorizedProjectSetHash !== candidate.scope.authorizedProjectSetHash
  ) {
    throw new Error("APPROVAL_V2_PORTFOLIO_WITNESS_SCOPE_MISMATCH");
  }
  if (subject.decision) {
    if (!subject.decision.authorizationScopeWitness || subject.decision.authorizationBasis) {
      throw new Error("APPROVAL_V2_PLATFORM_DECISION_WITNESS_INVALID");
    }
    assertSafeScopeWitness(subject.decision.authorizationScopeWitness, subject.requiredPermission);
    if (
      JSON.stringify({ ...subject.decision.authorizationScopeWitness, evaluatedAt: undefined }) !==
      JSON.stringify({ ...witness, evaluatedAt: undefined })
    ) {
      throw new Error("APPROVAL_V2_DECISION_SCOPE_MISMATCH");
    }
  }
}

function assertExternalBinding(subject: ExternalCommandApprovalSubjectV2): void {
  if (
    !subject.bindingRef ||
    subject.profileRefs.length === 0 ||
    subject.expectedExternalState === undefined
  ) {
    throw new Error("APPROVAL_V2_EXTERNAL_COMMAND_BINDING_REQUIRED");
  }
  if (subject.initiatorAuthorizationScopeWitness || subject.expectedLocalState) {
    throw new Error("APPROVAL_V2_EXTERNAL_COMMAND_LOCAL_FIELDS_FORBIDDEN");
  }
  if (
    subject.decision &&
    (!subject.decision.authorizationBasis || subject.decision.authorizationScopeWitness)
  ) {
    throw new Error("APPROVAL_V2_EXTERNAL_DECISION_BASIS_INVALID");
  }
}

export function validateApprovalSubjectV2(subject: ApprovalSubjectV2): void {
  if (
    subject.schemaVersion !== 2 ||
    subject.subjectSchemaId !== APPROVAL_SUBJECT_V2_SCHEMA_ID ||
    subject.subjectSchemaVersion !== 2
  ) {
    throw new Error("APPROVAL_V2_SCHEMA_IDENTITY_INVALID");
  }
  if (
    !subject.approvalId ||
    !subject.workspaceId ||
    !subject.projectId ||
    !subject.requiredPermission ||
    !subject.effectIdempotencyKey
  ) {
    throw new Error("APPROVAL_V2_REQUIRED_FIELD_MISSING");
  }
  if (
    subject.resourceVersion < 1 ||
    !Number.isSafeInteger(subject.resourceVersion) ||
    !Date.parse(subject.createdAt) ||
    !Date.parse(subject.expiresAt) ||
    Date.parse(subject.expiresAt) <= Date.parse(subject.createdAt)
  ) {
    throw new Error("APPROVAL_V2_LIFETIME_INVALID");
  }
  if (!isDigest(subject.subjectHash) || subject.subjectHash !== approvalSubjectV2Hash(subject)) {
    throw new Error("APPROVAL_V2_SUBJECT_HASH_MISMATCH");
  }
  assertLifecycle(subject);
  if (subject.action.actionKind === "PLATFORM_ACTION")
    assertPlatformBinding(subject as PlatformActionApprovalSubjectV2);
  else assertExternalBinding(subject as ExternalCommandApprovalSubjectV2);
}

export function createPlatformActionApprovalV2(
  input: CreatePlatformActionApprovalV2Input,
): PlatformActionApprovalSubjectV2 {
  if (input.initiator.kind !== "HUMAN") throw new Error("APPROVAL_V2_HUMAN_INITIATOR_REQUIRED");
  const candidate = structuredClone(input.candidate);
  const payloadHash = sha256(candidate as unknown as JsonValue);
  const target: ApprovalSchemaBoundValue<QueueActionCandidateForApproval> = {
    schemaRef: {
      id: QUEUE_ACTION_CANDIDATE_SCHEMA_ID,
      version: 1,
      digest: QUEUE_ACTION_CANDIDATE_SCHEMA_DIGEST,
    },
    value: candidate,
  };
  const base = {
    approvalId: input.approvalId,
    schemaVersion: 2 as const,
    subjectSchemaId: APPROVAL_SUBJECT_V2_SCHEMA_ID,
    subjectSchemaVersion: 2 as const,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    initiator: structuredClone(input.initiator),
    initiatorAuthorizationScopeWitness: structuredClone(input.initiatorAuthorizationScopeWitness),
    action: structuredClone(input.action),
    target,
    targetHash: sha256(target as unknown as JsonValue),
    payloadHash,
    expectedLocalState: {
      resourceRef: { id: candidate.actionId, version: 1 },
      resourceVersion: 1,
      contentHash: payloadHash,
      aggregateResourceVersion: 1,
      currentPublishedVersion: 0,
    },
    requiredPermission: input.requiredPermission,
    separationOfDutyPolicy: "SELF_APPROVAL_FORBIDDEN" as const,
    effectIdempotencyKey: input.effectIdempotencyKey,
    dataClassificationKey: input.dataClassificationKey,
    expiresAt: input.expiresAt,
    decisionStatus: "PENDING" as const,
    effectAuthorizationStatus: "NOT_AUTHORIZED" as const,
    resourceVersion: 1,
    createdAt: input.createdAt,
  };
  const subject = {
    ...base,
    subjectHash: sha256(immutableProjection(base as PlatformActionApprovalSubjectV2)),
  } as PlatformActionApprovalSubjectV2;
  validateApprovalSubjectV2(subject);
  return deepFreeze(subject) as PlatformActionApprovalSubjectV2;
}

export const createApprovalSubjectV2 = createPlatformActionApprovalV2;

export function decideApprovalSubjectV2(
  input: Readonly<{
    subject: ApprovalSubjectV2;
    decision: "APPROVE" | "REJECT";
    approver: Extract<ActorReference, { kind: "HUMAN" }>;
    approverRole: string;
    authorizationBasis?: AuthorizationBasisRef;
    authorizationScopeWitness?: ApprovalAuthorizationScopeWitness;
    now: string;
  }>,
): ApprovalSubjectV2 {
  validateApprovalSubjectV2(input.subject);
  if (input.subject.decisionStatus !== "PENDING") throw new Error("APPROVAL_V2_ALREADY_DECIDED");
  if (Date.parse(input.now) >= Date.parse(input.subject.expiresAt))
    throw new Error("APPROVAL_V2_EXPIRED");
  if (
    input.subject.initiator.kind === "HUMAN" &&
    input.subject.initiator.principalId === input.approver.principalId
  ) {
    throw new Error("SELF_APPROVAL_FORBIDDEN");
  }
  if (!input.approverRole) throw new Error("APPROVAL_V2_APPROVER_ROLE_REQUIRED");
  const platform = input.subject.action.actionKind === "PLATFORM_ACTION";
  if (
    platform !== Boolean(input.authorizationScopeWitness) ||
    platform === Boolean(input.authorizationBasis)
  ) {
    throw new Error("APPROVAL_V2_DECISION_AUTHORIZATION_KIND_MISMATCH");
  }
  const decision: ApprovalV2Decision = Object.freeze({
    approver: input.approver,
    approverRole: input.approverRole,
    ...(input.authorizationBasis ? { authorizationBasis: input.authorizationBasis } : {}),
    ...(input.authorizationScopeWitness
      ? { authorizationScopeWitness: input.authorizationScopeWitness }
      : {}),
    decidedAt: input.now,
  });
  const approved = input.decision === "APPROVE";
  const subject = {
    ...input.subject,
    decisionStatus: approved ? ("APPROVED" as const) : ("REJECTED" as const),
    effectAuthorizationStatus: approved ? ("AUTHORIZED" as const) : ("NOT_AUTHORIZED" as const),
    decision,
    resourceVersion: input.subject.resourceVersion + 1,
    updatedAt: input.now,
  } as ApprovalSubjectV2;
  validateApprovalSubjectV2(subject);
  return deepFreeze(subject) as ApprovalSubjectV2;
}

export function consumeApprovalSubjectV2(
  input: Readonly<{
    subject: ApprovalSubjectV2;
    currentSubjectHash: Sha256Digest;
    currentAuthorizationScopeWitness?: ApprovalAuthorizationScopeWitness;
    currentAuthorizationBasis?: AuthorizationBasisRef;
    now: string;
  }>,
): ApprovalSubjectV2 {
  validateApprovalSubjectV2(input.subject);
  if (
    input.subject.decisionStatus !== "APPROVED" ||
    input.subject.effectAuthorizationStatus !== "AUTHORIZED"
  ) {
    throw new Error("APPROVAL_V2_EFFECT_NOT_AUTHORIZED");
  }
  if (input.currentSubjectHash !== input.subject.subjectHash)
    throw new Error("APPROVAL_V2_SUBJECT_CHANGED");
  if (Date.parse(input.now) >= Date.parse(input.subject.expiresAt))
    throw new Error("APPROVAL_V2_EXPIRED");
  const platform = input.subject.action.actionKind === "PLATFORM_ACTION";
  if (platform) {
    if (!input.currentAuthorizationScopeWitness || input.currentAuthorizationBasis)
      throw new Error("APPROVAL_V2_CURRENT_SCOPE_REQUIRED");
    assertSafeScopeWitness(
      input.currentAuthorizationScopeWitness,
      input.subject.requiredPermission,
    );
    const decided = input.subject.decision?.authorizationScopeWitness;
    if (
      !decided ||
      JSON.stringify({ ...decided, evaluatedAt: undefined }) !==
        JSON.stringify({ ...input.currentAuthorizationScopeWitness, evaluatedAt: undefined })
    ) {
      throw new Error("APPROVAL_V2_SCOPE_REVOKED");
    }
  } else if (!input.currentAuthorizationBasis || input.currentAuthorizationScopeWitness) {
    throw new Error("APPROVAL_V2_CURRENT_BASIS_REQUIRED");
  }
  const consumed = {
    ...input.subject,
    effectAuthorizationStatus: "CONSUMED" as const,
    consumedAt: input.now,
    resourceVersion: input.subject.resourceVersion + 1,
    updatedAt: input.now,
  } as ApprovalSubjectV2;
  validateApprovalSubjectV2(consumed);
  return deepFreeze(consumed) as ApprovalSubjectV2;
}

export function invalidateApprovalSubjectV2(
  subject: ApprovalSubjectV2,
  reason: ApprovalInvalidationReason,
  now: string,
): ApprovalSubjectV2 {
  validateApprovalSubjectV2(subject);
  if (subject.effectAuthorizationStatus === "CONSUMED")
    throw new Error("APPROVAL_V2_ALREADY_CONSUMED");
  const invalidated = {
    ...subject,
    effectAuthorizationStatus: "INVALIDATED" as const,
    invalidationReason: reason,
    invalidatedAt: now,
    resourceVersion: subject.resourceVersion + 1,
    updatedAt: now,
  } as ApprovalSubjectV2;
  validateApprovalSubjectV2(invalidated);
  return deepFreeze(invalidated) as ApprovalSubjectV2;
}

export function parseApprovalSubjectV2(value: unknown): ApprovalSubjectV2 {
  const parsed = (
    typeof value === "string" ? JSON.parse(value) : structuredClone(value)
  ) as unknown;
  if (!isRecord(parsed)) throw new Error("APPROVAL_V2_OBJECT_REQUIRED");
  const subject = parsed as unknown as ApprovalSubjectV2;
  validateApprovalSubjectV2(subject);
  return deepFreeze(subject) as ApprovalSubjectV2;
}
