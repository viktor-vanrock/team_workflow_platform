import { type JsonValue, sha256 } from "@awp/platform-contracts";

import type {
  ActorReference,
  AuthorizationBasisRef,
  VersionedReference,
} from "../shared/primitives.ts";
import {
  APPROVAL_SUBJECT_V2_SCHEMA_ID,
  type ApprovalSubjectV2,
  parseApprovalSubjectV2,
} from "./approval-subject-v2.ts";

export type ApprovalDecisionStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED";
export type ApprovalEffectAuthorizationStatus =
  "NOT_AUTHORIZED" | "AUTHORIZED" | "INVALIDATED" | "CONSUMED";
export type ApprovalInvalidationReason =
  | "SUBJECT_CHANGED"
  | "TARGET_CHANGED"
  | "PAYLOAD_CHANGED"
  | "EXPECTED_STATE_CHANGED"
  | "BINDING_CHANGED"
  | "PROFILE_CHANGED"
  | "APPROVER_AUTH_REVOKED"
  | "APPROVER_ROLE_CHANGED"
  | "SCOPE_REVOKED"
  | "EXPIRED"
  | "COMMAND_CANCELLED";
export type ApprovalAction =
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

export interface ApprovalDecision {
  readonly approverId: string;
  readonly approverRole: string;
  readonly authorizationBasisHash: string;
  readonly authorizationBasis?: AuthorizationBasisRef;
  readonly decidedAt: Date;
}

export interface Approval {
  readonly id: string;
  readonly workspaceId?: string;
  readonly projectId?: string;
  readonly action: ApprovalAction;
  readonly initiatorId: string;
  readonly initiator?: ActorReference;
  readonly subjectHash: string;
  readonly target?: unknown;
  readonly targetHash?: string;
  readonly payloadHash?: string;
  readonly expectedState?: unknown;
  readonly bindingRef?: VersionedReference;
  readonly profileRefs?: readonly VersionedReference[];
  readonly requiredPermission?: string;
  readonly separationOfDutyPolicy: "SELF_APPROVAL_FORBIDDEN" | "SELF_APPROVAL_ALLOWED";
  readonly effectIdempotencyKey?: string;
  readonly expiresAt: Date;
  readonly decisionStatus: ApprovalDecisionStatus;
  readonly effectAuthorizationStatus: ApprovalEffectAuthorizationStatus;
  readonly decision?: ApprovalDecision;
  readonly invalidationReason?: ApprovalInvalidationReason;
  readonly invalidatedAt?: Date;
  readonly consumedAt?: Date;
  readonly resourceVersion: number;
  readonly createdAt: Date;
}

export interface ExactApprovalInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly initiatorId: string;
  readonly initiator: ActorReference;
  readonly action: ApprovalAction;
  readonly target: unknown;
  readonly targetHash: string;
  readonly payloadHash: string;
  readonly expectedState: unknown;
  readonly bindingRef: VersionedReference;
  readonly profileRefs: readonly VersionedReference[];
  readonly requiredPermission: string;
  readonly separationOfDutyPolicy: "SELF_APPROVAL_FORBIDDEN" | "SELF_APPROVAL_ALLOWED";
  readonly effectIdempotencyKey: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

function exactSemantic(input: Omit<ExactApprovalInput, "id" | "createdAt">): JsonValue {
  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    initiator: input.initiator,
    action: input.action,
    target: input.target,
    targetHash: input.targetHash,
    payloadHash: input.payloadHash,
    expectedState: input.expectedState,
    bindingRef: input.bindingRef,
    profileRefs: [...input.profileRefs].sort((left, right) =>
      `${left.id}:${left.version}`.localeCompare(`${right.id}:${right.version}`),
    ),
    requiredPermission: input.requiredPermission,
    separationOfDutyPolicy: input.separationOfDutyPolicy,
    effectIdempotencyKey: input.effectIdempotencyKey,
    expiresAt: input.expiresAt.toISOString(),
  } as unknown as JsonValue;
}

export function validateApprovalSnapshot(snapshot: Partial<Approval>): void {
  if (
    snapshot.decisionStatus !== "APPROVED" &&
    snapshot.effectAuthorizationStatus !== undefined &&
    snapshot.effectAuthorizationStatus !== "NOT_AUTHORIZED"
  ) {
    throw new Error("NON_APPROVED_EFFECT_NOT_AUTHORIZED");
  }
  if (
    (snapshot.decisionStatus === "APPROVED" || snapshot.decisionStatus === "REJECTED") &&
    !snapshot.decision
  ) {
    throw new Error("APPROVED_REQUIRES_DECISION");
  }
  if (
    snapshot.effectAuthorizationStatus === "INVALIDATED" &&
    (!snapshot.invalidationReason || !snapshot.invalidatedAt)
  ) {
    throw new Error("INVALIDATED_REQUIRES_REASON");
  }
  if (snapshot.effectAuthorizationStatus === "CONSUMED" && !snapshot.consumedAt) {
    throw new Error("CONSUMED_REQUIRES_TIMESTAMP");
  }
}

export function decideApproval(
  approval: Approval,
  input: Readonly<{
    approverId: string;
    approverRole: string;
    authorizationBasisHash: string;
    authorizationBasis?: AuthorizationBasisRef;
    now?: Date;
  }>,
): Approval {
  if (approval.decisionStatus !== "PENDING") {
    throw new Error("APPROVAL_ALREADY_DECIDED");
  }
  if (
    approval.separationOfDutyPolicy === "SELF_APPROVAL_FORBIDDEN" &&
    approval.initiatorId === input.approverId
  ) {
    throw new Error("SELF_APPROVAL_FORBIDDEN");
  }
  const decidedAt = input.now ?? new Date("2026-01-01T00:01:00.000Z");
  const value: Approval = {
    ...approval,
    decisionStatus: "APPROVED",
    effectAuthorizationStatus: "AUTHORIZED",
    decision: {
      approverId: input.approverId,
      approverRole: input.approverRole,
      authorizationBasisHash: input.authorizationBasisHash,
      ...(input.authorizationBasis ? { authorizationBasis: input.authorizationBasis } : {}),
      decidedAt,
    },
    resourceVersion: approval.resourceVersion + 1,
  };
  validateApprovalSnapshot(value);
  return value;
}

export function exactApprovalSubjectHash(input: ExactApprovalInput): string {
  return sha256(exactSemantic(input));
}

export function recomputeExactApprovalSubjectHash(approval: Approval): string {
  if (
    !approval.workspaceId ||
    !approval.projectId ||
    !approval.initiator ||
    approval.target === undefined ||
    !approval.targetHash ||
    !approval.payloadHash ||
    approval.expectedState === undefined ||
    !approval.bindingRef ||
    !approval.profileRefs ||
    !approval.requiredPermission ||
    !approval.effectIdempotencyKey
  ) {
    throw new Error("APPROVAL_EXACT_SUBJECT_REQUIRED");
  }
  return exactApprovalSubjectHash({
    id: approval.id,
    workspaceId: approval.workspaceId,
    projectId: approval.projectId,
    initiatorId: approval.initiatorId,
    initiator: approval.initiator,
    action: approval.action,
    target: approval.target,
    targetHash: approval.targetHash,
    payloadHash: approval.payloadHash,
    expectedState: approval.expectedState,
    bindingRef: approval.bindingRef,
    profileRefs: approval.profileRefs,
    requiredPermission: approval.requiredPermission,
    separationOfDutyPolicy: approval.separationOfDutyPolicy,
    effectIdempotencyKey: approval.effectIdempotencyKey,
    expiresAt: approval.expiresAt,
    createdAt: approval.createdAt,
  });
}

export function createExactApproval(input: ExactApprovalInput): Approval {
  const value: Approval = {
    id: input.id,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    initiatorId: input.initiatorId,
    initiator: input.initiator,
    action: input.action,
    target: input.target,
    targetHash: input.targetHash,
    payloadHash: input.payloadHash,
    expectedState: input.expectedState,
    bindingRef: input.bindingRef,
    profileRefs: Object.freeze([...input.profileRefs]),
    requiredPermission: input.requiredPermission,
    separationOfDutyPolicy: input.separationOfDutyPolicy,
    effectIdempotencyKey: input.effectIdempotencyKey,
    expiresAt: input.expiresAt,
    subjectHash: exactApprovalSubjectHash(input),
    decisionStatus: "PENDING",
    effectAuthorizationStatus: "NOT_AUTHORIZED",
    resourceVersion: 1,
    createdAt: input.createdAt,
  };
  validateApprovalSnapshot(value);
  return Object.freeze(value);
}

export type ReadableApprovalSubject = Approval | ApprovalSubjectV2;

export function parseApprovalSubject(value: unknown): ReadableApprovalSubject {
  const parsed = (
    typeof value === "string" ? JSON.parse(value) : structuredClone(value)
  ) as unknown;
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (record.schemaVersion === 2 || record.subjectSchemaId === APPROVAL_SUBJECT_V2_SCHEMA_ID) {
      return parseApprovalSubjectV2(record);
    }
  }
  if (!parsed || typeof parsed !== "object") throw new Error("APPROVAL_SUBJECT_OBJECT_REQUIRED");
  const serialized = parsed as Omit<
    Approval,
    "expiresAt" | "createdAt" | "decision" | "invalidatedAt" | "consumedAt"
  > & {
    expiresAt: Date | string;
    createdAt: Date | string;
    decision?: Omit<ApprovalDecision, "decidedAt"> & Readonly<{ decidedAt: Date | string }>;
    invalidatedAt?: Date | string;
    consumedAt?: Date | string;
  };
  const { expiresAt, createdAt, decision, invalidatedAt, consumedAt, ...base } = serialized;
  const approval: Approval = {
    ...base,
    expiresAt: expiresAt instanceof Date ? expiresAt : new Date(expiresAt),
    createdAt: createdAt instanceof Date ? createdAt : new Date(createdAt),
    ...(decision
      ? {
          decision: {
            ...decision,
            decidedAt:
              decision.decidedAt instanceof Date
                ? decision.decidedAt
                : new Date(decision.decidedAt),
          },
        }
      : {}),
    ...(invalidatedAt
      ? {
          invalidatedAt: invalidatedAt instanceof Date ? invalidatedAt : new Date(invalidatedAt),
        }
      : {}),
    ...(consumedAt
      ? {
          consumedAt: consumedAt instanceof Date ? consumedAt : new Date(consumedAt),
        }
      : {}),
  };
  validateApprovalSnapshot(approval);
  return Object.freeze(approval);
}
