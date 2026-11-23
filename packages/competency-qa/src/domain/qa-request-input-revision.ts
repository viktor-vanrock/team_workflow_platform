import type { QaRequestKind } from "../manifest.ts";
import {
  qaAggregateSnapshotHash,
  type QaAuthorizationBasis,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
  type QaScope,
} from "./primitives.ts";
import type { QaExternalImmutableRef, QaSemanticRef } from "./qa-project-context.ts";

export interface QaDeclaredBlocker {
  readonly code: string;
  readonly description: string;
}
export interface QaResponseChannelRef {
  readonly channelKind: "PLATFORM_WEB";
  readonly channelId: string;
  readonly version: number;
  readonly contentHash: QaContentHash;
}
export type QaResponseChannelResolution =
  | Readonly<{
      state: "CONFIRMED";
      requesterPrincipal: QaHumanActor;
      resolutionPolicyRef: QaSemanticRef;
      responseChannelRef: QaResponseChannelRef;
      evaluatedAt: string;
    }>
  | Readonly<{
      state: "MISSING";
      requesterPrincipal: QaHumanActor;
      resolutionPolicyRef: QaSemanticRef;
      evaluatedAt: string;
      missingReasonCode: string;
    }>;
export type QaPreviousSessionRef =
  | Readonly<{ kind: "EXTERNAL_HISTORICAL"; historicalSessionRef: QaExternalImmutableRef }>
  | Readonly<{
      kind: "QA_SESSION";
      sessionId: string;
      sessionReviewRef: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
    }>;

export interface QaRequestedTarget {
  readonly environmentId?: string;
  readonly environmentRevision?: number;
  readonly buildRef?: QaExternalImmutableRef;
  readonly targetPolicyRef?: QaExternalImmutableRef;
  readonly testDataRef?: QaExternalImmutableRef;
  readonly accountLeaseRef?: QaExternalImmutableRef;
}

export interface QaDorSemanticInput {
  readonly goal?: string;
  readonly scope?: string;
  readonly acceptanceOutcome?: string;
  readonly sourceRefs?: readonly QaExternalImmutableRef[];
  readonly blockers?: readonly QaDeclaredBlocker[];
  readonly dependencies?: readonly QaExternalImmutableRef[];
  readonly requestedTarget?: QaRequestedTarget;
  readonly requestRisk?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly businessImpact?: string;
  readonly desiredDate?: string;
  readonly checklistRefs?: readonly QaExternalImmutableRef[];
  readonly roleMetadataRefs?: readonly QaExternalImmutableRef[];
  readonly defectRef?: QaExternalImmutableRef;
  readonly previousSessionRef?: QaPreviousSessionRef;
  readonly sourceBuildRef?: QaExternalImmutableRef;
}

export interface QaRequestInputRevision extends QaDorSemanticInput {
  readonly schemaVersion: 1;
  readonly inputRevisionId: string;
  readonly version: number;
  readonly previousRevisionRef: null | Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly definitionRef: Readonly<{ key: "qa.validation"; version: "1.0.0" }>;
  readonly acceptedDraftRef: QaExternalImmutableRef;
  readonly externalRequestRef: QaExternalImmutableRef;
  readonly operationalBindingRef: Readonly<{ id: string; version: number }>;
  readonly originalRequesterRef: QaHumanActor;
  readonly title: string;
  readonly requestKind: QaRequestKind;
  readonly blockersDeclared: boolean;
  readonly blockers: readonly QaDeclaredBlocker[];
  readonly dependenciesDeclared: boolean;
  readonly dependencies: readonly QaExternalImmutableRef[];
  readonly dataClassificationKey: string;
  readonly responseChannelResolution: QaResponseChannelResolution;
  readonly readyEffectGuard: Readonly<{
    observedState: "NONE" | "PENDING_NOT_DISPATCHED";
    expectedAggregateVersion: number;
    pendingCommandRef?: Readonly<{ commandId: string }>;
  }>;
  readonly invalidatedState: Readonly<{
    readinessAssessmentRefs: readonly unknown[];
    waiverRefs: readonly unknown[];
    pendingReadyCommandRefs: readonly unknown[];
  }>;
  readonly changeReasonCode:
    "INITIAL_CONFIRMED_DRAFT" | "MISSING_INFO_SUPPLIED" | "REQUESTER_CORRECTION";
  readonly changeReason?: string;
  readonly contentHash: QaContentHash;
  readonly recordedBy: QaHumanActor;
  readonly authorizationBasisHash: QaContentHash;
  readonly recordedAt: string;
  readonly correlationId: string;
  readonly causationId?: string;
}

function assertExactRef(ref: QaExternalImmutableRef): void {
  if (
    ref.kind.length === 0 ||
    ref.id.length === 0 ||
    ref.version.length === 0 ||
    !ref.contentHash.startsWith("sha256:")
  ) {
    throw new QaDomainError("QA_MUTABLE_ALIAS_FORBIDDEN");
  }
}

export function assertQaDorSemanticInput(
  input: QaDorSemanticInput,
  requestKind: QaRequestKind,
): void {
  for (const value of [input.goal, input.scope, input.acceptanceOutcome, input.businessImpact]) {
    if (value !== undefined && value.trim().length === 0)
      throw new QaDomainError("QA_EMPTY_OPTIONAL_FACT_FORBIDDEN");
  }
  for (const ref of [
    ...(input.sourceRefs ?? []),
    ...(input.dependencies ?? []),
    ...(input.checklistRefs ?? []),
    ...(input.roleMetadataRefs ?? []),
  ])
    assertExactRef(ref);
  for (const blocker of input.blockers ?? [])
    if (blocker.code.length < 3 || blocker.description.trim().length === 0)
      throw new QaDomainError("QA_BLOCKER_INVALID");
  const lineage = [input.defectRef, input.sourceBuildRef].filter(
    (value): value is QaExternalImmutableRef => value !== undefined,
  );
  for (const ref of lineage) assertExactRef(ref);
  if (
    requestKind !== "retest" &&
    (input.defectRef || input.previousSessionRef || input.sourceBuildRef)
  )
    throw new QaDomainError("QA_RETEST_LINEAGE_FORBIDDEN");
  if (input.previousSessionRef?.kind === "QA_SESSION")
    throw new QaDomainError("QA_NATIVE_SESSION_LINEAGE_NOT_INSTALLED");
  if (input.previousSessionRef?.kind === "EXTERNAL_HISTORICAL")
    assertExactRef(input.previousSessionRef.historicalSessionRef);
}

export function buildInitialQaRequestInputRevision(
  input: Readonly<{
    inputRevisionId: string;
    scope: QaScope;
    workItemId: string;
    acceptedDraftRef: QaExternalImmutableRef;
    externalRequestRef: QaExternalImmutableRef;
    operationalBindingRef: Readonly<{ id: string; version: number }>;
    originalRequesterRef: QaHumanActor;
    title: string;
    requestKind: QaRequestKind;
    semanticInput: QaDorSemanticInput;
    blockersDeclared: boolean;
    dependenciesDeclared: boolean;
    dataClassificationKey: string;
    responseChannelResolution: QaResponseChannelResolution;
    recordedBy: QaHumanActor;
    authorizationBasis: QaAuthorizationBasis;
    recordedAt: string;
    correlationId: string;
    causationId?: string;
  }>,
): QaRequestInputRevision {
  assertQaDorSemanticInput(input.semanticInput, input.requestKind);
  if (
    input.title.trim().length === 0 ||
    input.operationalBindingRef.version < 1 ||
    Number.isNaN(Date.parse(input.recordedAt))
  )
    throw new QaDomainError("QA_INITIAL_INPUT_INVALID");
  if (
    JSON.stringify(input.responseChannelResolution.requesterPrincipal) !==
    JSON.stringify(input.originalRequesterRef)
  )
    throw new QaDomainError("QA_RESPONSE_CHANNEL_REQUESTER_MISMATCH");
  const body = Object.freeze({
    schemaVersion: 1 as const,
    inputRevisionId: input.inputRevisionId,
    version: 1,
    previousRevisionRef: null,
    workspaceId: input.scope.workspaceId,
    projectId: input.scope.projectId,
    workItemId: input.workItemId,
    definitionRef: Object.freeze({ key: "qa.validation" as const, version: "1.0.0" as const }),
    acceptedDraftRef: structuredClone(input.acceptedDraftRef),
    externalRequestRef: structuredClone(input.externalRequestRef),
    operationalBindingRef: structuredClone(input.operationalBindingRef),
    originalRequesterRef: structuredClone(input.originalRequesterRef),
    title: input.title,
    requestKind: input.requestKind,
    ...structuredClone(input.semanticInput),
    blockersDeclared: input.blockersDeclared,
    blockers: structuredClone(input.semanticInput.blockers ?? []),
    dependenciesDeclared: input.dependenciesDeclared,
    dependencies: structuredClone(input.semanticInput.dependencies ?? []),
    dataClassificationKey: input.dataClassificationKey,
    responseChannelResolution: structuredClone(input.responseChannelResolution),
    readyEffectGuard: Object.freeze({
      observedState: "NONE" as const,
      expectedAggregateVersion: 1,
    }),
    invalidatedState: Object.freeze({
      readinessAssessmentRefs: Object.freeze([] as const),
      waiverRefs: Object.freeze([] as const),
      pendingReadyCommandRefs: Object.freeze([] as const),
    }),
    changeReasonCode: "INITIAL_CONFIRMED_DRAFT" as const,
    recordedBy: structuredClone(input.recordedBy),
    authorizationBasisHash: qaAggregateSnapshotHash(input.authorizationBasis as never),
    recordedAt: input.recordedAt,
    correlationId: input.correlationId,
    ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
  });
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}

export function qaRequestInputRevisionRef(revision: QaRequestInputRevision) {
  return Object.freeze({
    id: revision.inputRevisionId,
    version: revision.version,
    contentHash: revision.contentHash,
  });
}
