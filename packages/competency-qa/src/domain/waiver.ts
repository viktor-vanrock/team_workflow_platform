import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaScope,
} from "./primitives.ts";

export interface QaDorWaiver {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: 1;
  readonly scope: QaScope;
  readonly workItemId: string;
  readonly kind: "DOR";
  readonly ruleCode: "PROJECT_REGISTRY_NEEDS_REVIEW";
  readonly assessmentRef: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
  readonly inputFingerprint: QaContentHash;
  readonly initiatedBy: string;
  readonly reason: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly state: "PENDING" | "APPROVED";
  readonly approverId?: string;
  readonly authorizationBasisHash?: QaContentHash;
  readonly decidedAt?: string;
  readonly contentHash: QaContentHash;
}

export function createDorWaiver(
  input: Omit<
    QaDorWaiver,
    | "schemaVersion"
    | "version"
    | "kind"
    | "state"
    | "contentHash"
    | "approverId"
    | "authorizationBasisHash"
    | "decidedAt"
  > &
    Readonly<{ ruleCode: string }>,
): QaDorWaiver {
  if (input.ruleCode !== "PROJECT_REGISTRY_NEEDS_REVIEW")
    throw new QaDomainError("QA_DOR_WAIVER_SUBJECT_FORBIDDEN");
  if (
    input.reason.trim().length < 8 ||
    Number.isNaN(Date.parse(input.expiresAt)) ||
    Date.parse(input.expiresAt) <= Date.parse(input.createdAt)
  )
    throw new QaDomainError("QA_DOR_WAIVER_INVALID");
  const body = Object.freeze({
    schemaVersion: 1 as const,
    ...structuredClone(input),
    version: 1 as const,
    kind: "DOR" as const,
    ruleCode: "PROJECT_REGISTRY_NEEDS_REVIEW" as const,
    state: "PENDING" as const,
  });
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}

export function approveDorWaiver(
  waiver: QaDorWaiver,
  decision: Readonly<{
    actorId: string;
    role: string;
    decidedAt: string;
    authorizationBasisHash: QaContentHash;
  }>,
): QaDorWaiver {
  if (waiver.state !== "PENDING") return waiver;
  if (decision.role !== "QA_LEAD") throw new QaDomainError("QA_WAIVER_QA_LEAD_REQUIRED");
  if (decision.actorId === waiver.initiatedBy)
    throw new QaDomainError("QA_WAIVER_DISTINCT_LEAD_REQUIRED");
  if (Date.parse(decision.decidedAt) >= Date.parse(waiver.expiresAt))
    throw new QaDomainError("QA_WAIVER_EXPIRED");
  const body = Object.freeze({
    schemaVersion: waiver.schemaVersion,
    id: waiver.id,
    version: waiver.version,
    scope: waiver.scope,
    workItemId: waiver.workItemId,
    kind: waiver.kind,
    ruleCode: waiver.ruleCode,
    assessmentRef: waiver.assessmentRef,
    inputFingerprint: waiver.inputFingerprint,
    initiatedBy: waiver.initiatedBy,
    reason: waiver.reason,
    expiresAt: waiver.expiresAt,
    createdAt: waiver.createdAt,
    state: "APPROVED" as const,
    approverId: decision.actorId,
    authorizationBasisHash: decision.authorizationBasisHash,
    decidedAt: decision.decidedAt,
  });
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}

export function assertActiveExactDorWaiver(
  waiver: QaDorWaiver,
  input: Readonly<{
    scope: QaScope;
    assessmentRef: { id: string; version: number; contentHash: QaContentHash };
    inputFingerprint: QaContentHash;
    at: string;
  }>,
): void {
  if (
    waiver.state !== "APPROVED" ||
    waiver.scope.workspaceId !== input.scope.workspaceId ||
    waiver.scope.projectId !== input.scope.projectId ||
    waiver.assessmentRef.id !== input.assessmentRef.id ||
    waiver.assessmentRef.version !== input.assessmentRef.version ||
    waiver.assessmentRef.contentHash !== input.assessmentRef.contentHash ||
    waiver.inputFingerprint !== input.inputFingerprint
  )
    throw new QaDomainError("QA_WAIVER_EXACT_SUBJECT_MISMATCH");
  if (Date.parse(input.at) >= Date.parse(waiver.expiresAt))
    throw new QaDomainError("QA_WAIVER_EXPIRED");
}
