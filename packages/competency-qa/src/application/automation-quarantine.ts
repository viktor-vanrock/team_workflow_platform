import { createHash } from "node:crypto";

import {
  assertQaVerifiedHuman,
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  qaScopeFromContext,
  type QaWorkspaceContext,
} from "../domain/primitives.ts";
import {
  buildQaAutomationQuarantineChangedEvent,
  type QaDomainEventEnvelope,
} from "./domain-events.ts";

export type QaAutomationQuarantineSubject =
  | Readonly<{
      kind: "SUITE_BINDING_VERSION";
      suiteBindingRef: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
    }>
  | Readonly<{ kind: "INFRASTRUCTURE_CODE"; infrastructureCode: string }>;
export type QaAutomationQuarantineAction = "ACTIVATE" | "LIFT";
export type QaAutomationQuarantineEffectiveState = "ACTIVE" | "INACTIVE" | "EXPIRED";

export interface QaAutomationQuarantinePolicy {
  readonly policyRef: string;
  readonly policyHash: QaContentHash;
  readonly maximumLifetimeSeconds: number;
  readonly allowedSubjectKinds: readonly QaAutomationQuarantineSubject["kind"][];
}

export interface QaAutomationQuarantineRevision {
  readonly schemaVersion: "automation-quarantine-revision@1.0.0";
  readonly quarantineRevisionId: string;
  readonly quarantineId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly revisionNo: number;
  readonly previousRevisionId?: string;
  readonly previousRevisionHash?: QaContentHash;
  readonly subject: QaAutomationQuarantineSubject;
  readonly action: QaAutomationQuarantineAction;
  readonly ownerPrincipalId: string;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
  readonly evidenceSetHash: QaContentHash;
  readonly policyRef: string;
  readonly policyHash: QaContentHash;
  readonly maximumLifetimeSeconds: number;
  readonly expiresAt?: string;
  readonly actorPrincipalId: string;
  readonly authorizationBasisHash: QaContentHash;
  readonly createdAt: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly contentHash: QaContentHash;
}

export interface QaAutomationQuarantine {
  readonly schemaVersion: "automation-quarantine@1.0.0";
  readonly quarantineId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly subject: QaAutomationQuarantineSubject;
  readonly currentRevisionId: string;
  readonly currentRevisionNo: number;
  readonly currentRevisionHash: QaContentHash;
  readonly currentAction: QaAutomationQuarantineAction;
  readonly currentExpiresAt?: string;
  readonly resourceVersion: number;
  readonly createdByPrincipalId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface QaAutomationQuarantineProjection {
  readonly schemaVersion: "automation-quarantine@1.0.0";
  readonly quarantineId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly subject: QaAutomationQuarantineSubject;
  readonly currentRevisionId: string;
  readonly currentRevisionNo: number;
  readonly currentRevisionHash: QaContentHash;
  readonly effectiveState: QaAutomationQuarantineEffectiveState;
  readonly expiresAt?: string;
  readonly resourceVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface QaAutomationQuarantineChange {
  readonly quarantine: QaAutomationQuarantine;
  readonly revision: QaAutomationQuarantineRevision;
  readonly event: QaDomainEventEnvelope<Readonly<Record<string, unknown>>>;
  readonly sessionState: "RUNNING" | "REVIEW_REQUIRED" | "COMPLETED";
  readonly preservedReviewFreeze?: Readonly<Record<string, unknown>>;
}

function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function hash(value: string): value is QaContentHash {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}

function subjectValid(subject: QaAutomationQuarantineSubject): boolean {
  if (subject.kind === "INFRASTRUCTURE_CODE")
    return /^[A-Z][A-Z0-9_]{0,63}$/u.test(subject.infrastructureCode);
  return (
    !!subject.suiteBindingRef.id &&
    subject.suiteBindingRef.version >= 1 &&
    hash(subject.suiteBindingRef.contentHash)
  );
}

function subjectHash(subject: QaAutomationQuarantineSubject): QaContentHash {
  if (!subjectValid(subject)) throw new QaDomainError("QA_AUTOMATION_QUARANTINE_SUBJECT_INVALID");
  return qaAggregateSnapshotHash(subject as never);
}

function assertPolicy(
  policy: QaAutomationQuarantinePolicy,
  subject: QaAutomationQuarantineSubject,
): void {
  if (
    !policy.policyRef ||
    !hash(policy.policyHash) ||
    !Number.isSafeInteger(policy.maximumLifetimeSeconds) ||
    policy.maximumLifetimeSeconds < 1 ||
    policy.maximumLifetimeSeconds > 31_536_000 ||
    !policy.allowedSubjectKinds.includes(subject.kind)
  )
    throw new QaDomainError("QA_AUTOMATION_QUARANTINE_POLICY_DENIED");
}

function evidence(
  input: Readonly<{
    evidenceRefs: readonly string[];
    originalFailureEvidenceRefs: readonly string[];
  }>,
): readonly string[] {
  const refs = [...new Set(input.evidenceRefs)].sort();
  const originals = [...new Set(input.originalFailureEvidenceRefs)].sort();
  if (
    refs.length < 1 ||
    refs.length > 32 ||
    refs.some((ref) => !ref || ref.length > 512) ||
    originals.length < 1 ||
    originals.some((ref) => !refs.includes(ref))
  ) {
    throw new QaDomainError("QA_AUTOMATION_QUARANTINE_FAILURE_EVIDENCE_REQUIRED");
  }
  return Object.freeze(refs);
}

function expiry(
  input: Readonly<{
    action: QaAutomationQuarantineAction;
    expiresAt?: string;
    createdAt: string;
    maximumLifetimeSeconds: number;
  }>,
): string | undefined {
  const created = Date.parse(input.createdAt);
  if (Number.isNaN(created)) throw new QaDomainError("QA_AUTOMATION_QUARANTINE_TIME_INVALID");
  if (input.action === "LIFT") {
    if (input.expiresAt !== undefined)
      throw new QaDomainError("QA_AUTOMATION_QUARANTINE_LIFT_EXPIRY_FORBIDDEN");
    return undefined;
  }
  const expires = Date.parse(input.expiresAt ?? "");
  if (
    Number.isNaN(expires) ||
    expires <= created ||
    expires > created + input.maximumLifetimeSeconds * 1000
  ) {
    throw new QaDomainError("QA_AUTOMATION_QUARANTINE_EXPIRY_INVALID");
  }
  return new Date(expires).toISOString();
}

function revision(
  input: Readonly<{
    context: QaWorkspaceContext;
    quarantineId: string;
    quarantineRevisionId: string;
    revisionNo: number;
    previousRevision?: QaAutomationQuarantineRevision;
    subject: QaAutomationQuarantineSubject;
    action: QaAutomationQuarantineAction;
    ownerPrincipalId: string;
    reason: string;
    evidenceRefs: readonly string[];
    originalFailureEvidenceRefs: readonly string[];
    policy: QaAutomationQuarantinePolicy;
    expiresAt?: string;
    authorizationBasisHash: QaContentHash;
    createdAt: string;
  }>,
): QaAutomationQuarantineRevision {
  const actor = assertQaVerifiedHuman(input.context);
  const scope = qaScopeFromContext(input.context);
  assertPolicy(input.policy, input.subject);
  const refs = evidence(input);
  const originals = Object.freeze([...new Set(input.originalFailureEvidenceRefs)].sort());
  const effectiveExpiry = expiry({
    action: input.action,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    createdAt: input.createdAt,
    maximumLifetimeSeconds: input.policy.maximumLifetimeSeconds,
  });
  if (
    !input.quarantineId ||
    !input.quarantineRevisionId ||
    !input.ownerPrincipalId ||
    input.reason.trim().length < 1 ||
    input.reason.length > 1024 ||
    !hash(input.authorizationBasisHash) ||
    (input.revisionNo === 1) !== (input.previousRevision === undefined) ||
    (input.revisionNo === 1 && input.action !== "ACTIVATE") ||
    (input.previousRevision !== undefined &&
      (input.previousRevision.quarantineId !== input.quarantineId ||
        input.previousRevision.revisionNo + 1 !== input.revisionNo ||
        input.previousRevision.action === input.action ||
        subjectHash(input.previousRevision.subject) !== subjectHash(input.subject) ||
        input.previousRevision.evidenceRefs.some((ref) => !originals.includes(ref))))
  )
    throw new QaDomainError("QA_AUTOMATION_QUARANTINE_REVISION_INVALID");
  const body = deepFreeze({
    schemaVersion: "automation-quarantine-revision@1.0.0" as const,
    quarantineRevisionId: input.quarantineRevisionId,
    quarantineId: input.quarantineId,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    revisionNo: input.revisionNo,
    ...(input.previousRevision === undefined
      ? {}
      : {
          previousRevisionId: input.previousRevision.quarantineRevisionId,
          previousRevisionHash: input.previousRevision.contentHash,
        }),
    subject: structuredClone(input.subject),
    action: input.action,
    ownerPrincipalId: input.ownerPrincipalId,
    reason: input.reason.trim(),
    evidenceRefs: refs,
    evidenceSetHash: qaAggregateSnapshotHash(refs as never),
    policyRef: input.policy.policyRef,
    policyHash: input.policy.policyHash,
    maximumLifetimeSeconds: input.policy.maximumLifetimeSeconds,
    ...(effectiveExpiry === undefined ? {} : { expiresAt: effectiveExpiry }),
    actorPrincipalId: actor.principalId,
    authorizationBasisHash: input.authorizationBasisHash,
    createdAt: new Date(input.createdAt).toISOString(),
    correlationId: input.context.correlationId,
    causationId: input.context.causationId,
  });
  return deepFreeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}

function event(
  context: QaWorkspaceContext,
  value: QaAutomationQuarantineRevision,
): QaDomainEventEnvelope<Readonly<Record<string, unknown>>> {
  return buildQaAutomationQuarantineChangedEvent({
    context,
    eventId: deterministicUuid(
      `event:qa-automation-quarantine:${value.quarantineRevisionId}:${value.contentHash}`,
    ),
    quarantineId: value.quarantineId,
    quarantineRevisionId: value.quarantineRevisionId,
    revisionNo: value.revisionNo,
    ...(value.previousRevisionId === undefined
      ? {}
      : {
          previousRevisionId: value.previousRevisionId,
          previousRevisionHash: value.previousRevisionHash!,
        }),
    subject: value.subject,
    action: value.action,
    effectiveState: value.action === "ACTIVATE" ? "ACTIVE" : "INACTIVE",
    ownerPrincipalId: value.ownerPrincipalId,
    reason: value.reason,
    evidenceRefs: value.evidenceRefs,
    evidenceSetHash: value.evidenceSetHash,
    policyRef: value.policyRef,
    policyHash: value.policyHash,
    actorPrincipalId: value.actorPrincipalId,
    authorizationBasisHash: value.authorizationBasisHash,
    ...(value.expiresAt === undefined ? {} : { expiresAt: value.expiresAt }),
    effectiveAt: value.createdAt,
    contentHash: value.contentHash,
  });
}

export function activateQaAutomationQuarantine(
  input: Readonly<{
    context: QaWorkspaceContext;
    quarantineId: string;
    quarantineRevisionId: string;
    subject: QaAutomationQuarantineSubject;
    ownerPrincipalId: string;
    reason: string;
    evidenceRefs: readonly string[];
    originalFailureEvidenceRefs: readonly string[];
    policy: QaAutomationQuarantinePolicy;
    expiresAt: string;
    authorizationBasisHash: QaContentHash;
    createdAt: string;
    sessionState: "RUNNING" | "REVIEW_REQUIRED" | "COMPLETED";
    reviewFreeze?: Readonly<Record<string, unknown>>;
  }>,
): QaAutomationQuarantineChange {
  const value = revision({ ...input, revisionNo: 1, action: "ACTIVATE" });
  const quarantine = deepFreeze({
    schemaVersion: "automation-quarantine@1.0.0" as const,
    quarantineId: input.quarantineId,
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    subject: value.subject,
    currentRevisionId: value.quarantineRevisionId,
    currentRevisionNo: 1,
    currentRevisionHash: value.contentHash,
    currentAction: "ACTIVATE" as const,
    currentExpiresAt: value.expiresAt!,
    resourceVersion: 1,
    createdByPrincipalId: value.actorPrincipalId,
    createdAt: value.createdAt,
    updatedAt: value.createdAt,
  });
  return deepFreeze({
    quarantine,
    revision: value,
    event: event(input.context, value),
    sessionState: input.sessionState,
    ...(input.reviewFreeze === undefined
      ? {}
      : { preservedReviewFreeze: structuredClone(input.reviewFreeze) }),
  });
}

export function reviseQaAutomationQuarantine(
  input: Readonly<{
    context: QaWorkspaceContext;
    quarantine: QaAutomationQuarantine;
    previousRevision: QaAutomationQuarantineRevision;
    quarantineRevisionId: string;
    action: QaAutomationQuarantineAction;
    ownerPrincipalId: string;
    reason: string;
    evidenceRefs: readonly string[];
    originalFailureEvidenceRefs: readonly string[];
    policy: QaAutomationQuarantinePolicy;
    expiresAt?: string;
    authorizationBasisHash: QaContentHash;
    createdAt: string;
    expectedResourceVersion: number;
    sessionState: "RUNNING" | "REVIEW_REQUIRED" | "COMPLETED";
    reviewFreeze?: Readonly<Record<string, unknown>>;
  }>,
): QaAutomationQuarantineChange {
  const scope = qaScopeFromContext(input.context);
  if (
    input.expectedResourceVersion !== input.quarantine.resourceVersion ||
    input.quarantine.workspaceId !== scope.workspaceId ||
    input.quarantine.projectId !== scope.projectId ||
    input.quarantine.currentRevisionId !== input.previousRevision.quarantineRevisionId ||
    input.quarantine.currentRevisionHash !== input.previousRevision.contentHash ||
    input.quarantine.currentRevisionNo !== input.previousRevision.revisionNo ||
    input.quarantine.currentAction !== input.previousRevision.action
  )
    throw new QaDomainError("QA_AUTOMATION_QUARANTINE_CAS_CONFLICT");
  const value = revision({
    context: input.context,
    quarantineId: input.quarantine.quarantineId,
    quarantineRevisionId: input.quarantineRevisionId,
    revisionNo: input.previousRevision.revisionNo + 1,
    previousRevision: input.previousRevision,
    subject: input.quarantine.subject,
    action: input.action,
    ownerPrincipalId: input.ownerPrincipalId,
    reason: input.reason,
    evidenceRefs: input.evidenceRefs,
    originalFailureEvidenceRefs: input.originalFailureEvidenceRefs,
    policy: input.policy,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    authorizationBasisHash: input.authorizationBasisHash,
    createdAt: input.createdAt,
  });
  const { currentExpiresAt: ignoredExpiry, ...currentHeader } = input.quarantine;
  void ignoredExpiry;
  const quarantine = deepFreeze({
    ...currentHeader,
    currentRevisionId: value.quarantineRevisionId,
    currentRevisionNo: value.revisionNo,
    currentRevisionHash: value.contentHash,
    currentAction: value.action,
    ...(value.expiresAt === undefined ? {} : { currentExpiresAt: value.expiresAt }),
    resourceVersion: input.quarantine.resourceVersion + 1,
    updatedAt: value.createdAt,
  });
  return deepFreeze({
    quarantine,
    revision: value,
    event: event(input.context, value),
    sessionState: input.sessionState,
    ...(input.reviewFreeze === undefined
      ? {}
      : { preservedReviewFreeze: structuredClone(input.reviewFreeze) }),
  });
}

export function projectQaAutomationQuarantine(
  quarantine: QaAutomationQuarantine,
  now: Date,
): QaAutomationQuarantineProjection {
  if (Number.isNaN(now.getTime()))
    throw new QaDomainError("QA_AUTOMATION_QUARANTINE_CLOCK_INVALID");
  const effectiveState: QaAutomationQuarantineEffectiveState =
    quarantine.currentAction === "LIFT"
      ? "INACTIVE"
      : Date.parse(quarantine.currentExpiresAt ?? "") <= now.getTime()
        ? "EXPIRED"
        : "ACTIVE";
  return deepFreeze({
    schemaVersion: quarantine.schemaVersion,
    quarantineId: quarantine.quarantineId,
    workspaceId: quarantine.workspaceId,
    projectId: quarantine.projectId,
    subject: quarantine.subject,
    currentRevisionId: quarantine.currentRevisionId,
    currentRevisionNo: quarantine.currentRevisionNo,
    currentRevisionHash: quarantine.currentRevisionHash,
    effectiveState,
    ...(quarantine.currentExpiresAt === undefined
      ? {}
      : { expiresAt: quarantine.currentExpiresAt }),
    resourceVersion: quarantine.resourceVersion,
    createdAt: quarantine.createdAt,
    updatedAt: quarantine.updatedAt,
  });
}
