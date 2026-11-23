import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
} from "../domain/primitives.ts";
import {
  assertQaDorSemanticInput,
  type QaDorSemanticInput,
  type QaRequestInputRevision,
  qaRequestInputRevisionRef,
  type QaResponseChannelResolution,
} from "../domain/qa-request-input-revision.ts";

function exact(
  expected: { id: string; version: number; contentHash: QaContentHash },
  actual: { id: string; version: number; contentHash: QaContentHash },
): boolean {
  return (
    expected.id === actual.id &&
    expected.version === actual.version &&
    expected.contentHash === actual.contentHash
  );
}

export function buildRevisedQaRequestInput(
  input: Readonly<{
    current: QaRequestInputRevision;
    expectedCurrentRef: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
    revisionId: string;
    semanticInput: QaDorSemanticInput;
    changeReasonCode: "MISSING_INFO_SUPPLIED" | "REQUESTER_CORRECTION";
    reason: string;
    actor: QaHumanActor;
    authorizationBasisHash: QaContentHash;
    recordedAt: string;
    correlationId: string;
    responseChannelResolution?: QaResponseChannelResolution;
    readyDispatchState: "NONE" | "FAILED" | "DISPATCHED" | "CONFIRMED";
    hasSessions: boolean;
    invalidatedState?: QaRequestInputRevision["invalidatedState"];
  }>,
): QaRequestInputRevision {
  if (!exact(input.expectedCurrentRef, qaRequestInputRevisionRef(input.current)))
    throw new QaDomainError("QA_REQUEST_INPUT_STALE");
  if (input.readyDispatchState === "DISPATCHED")
    throw new QaDomainError("QA_READINESS_DISPATCH_IN_FLIGHT");
  if (input.readyDispatchState === "CONFIRMED")
    throw new QaDomainError("QA_REQUEST_INPUT_FROZEN_READY");
  if (input.hasSessions) throw new QaDomainError("QA_REQUEST_INPUT_FROZEN_SESSION_EXISTS");
  if (input.actor.kind !== "HUMAN") throw new QaDomainError("QA_VERIFIED_HUMAN_REQUIRED");
  if (input.reason.trim().length < 5 || input.reason.length > 500)
    throw new QaDomainError("QA_REQUEST_INPUT_REASON_INVALID");
  assertQaDorSemanticInput(input.semanticInput, input.current.requestKind);
  const semantic: QaDorSemanticInput = {
    ...(input.semanticInput.goal === undefined ? {} : { goal: input.semanticInput.goal }),
    ...(input.semanticInput.scope === undefined ? {} : { scope: input.semanticInput.scope }),
    ...(input.semanticInput.acceptanceOutcome === undefined
      ? {}
      : { acceptanceOutcome: input.semanticInput.acceptanceOutcome }),
    ...(input.semanticInput.sourceRefs === undefined
      ? {}
      : { sourceRefs: structuredClone(input.semanticInput.sourceRefs) }),
    ...(input.semanticInput.blockers === undefined
      ? {}
      : { blockers: structuredClone(input.semanticInput.blockers) }),
    ...(input.semanticInput.dependencies === undefined
      ? {}
      : { dependencies: structuredClone(input.semanticInput.dependencies) }),
    ...(input.semanticInput.requestedTarget === undefined
      ? {}
      : { requestedTarget: structuredClone(input.semanticInput.requestedTarget) }),
    ...(input.semanticInput.requestRisk === undefined
      ? {}
      : { requestRisk: input.semanticInput.requestRisk }),
    ...(input.semanticInput.businessImpact === undefined
      ? {}
      : { businessImpact: input.semanticInput.businessImpact }),
    ...(input.semanticInput.desiredDate === undefined
      ? {}
      : { desiredDate: input.semanticInput.desiredDate }),
    ...(input.semanticInput.checklistRefs === undefined
      ? {}
      : { checklistRefs: structuredClone(input.semanticInput.checklistRefs) }),
    ...(input.semanticInput.roleMetadataRefs === undefined
      ? {}
      : { roleMetadataRefs: structuredClone(input.semanticInput.roleMetadataRefs) }),
    ...(input.semanticInput.defectRef === undefined
      ? {}
      : { defectRef: structuredClone(input.semanticInput.defectRef) }),
    ...(input.semanticInput.previousSessionRef === undefined
      ? {}
      : { previousSessionRef: structuredClone(input.semanticInput.previousSessionRef) }),
    ...(input.semanticInput.sourceBuildRef === undefined
      ? {}
      : { sourceBuildRef: structuredClone(input.semanticInput.sourceBuildRef) }),
  };
  const body = Object.freeze({
    schemaVersion: 1 as const,
    inputRevisionId: input.revisionId,
    version: input.current.version + 1,
    previousRevisionRef: qaRequestInputRevisionRef(input.current),
    workspaceId: input.current.workspaceId,
    projectId: input.current.projectId,
    workItemId: input.current.workItemId,
    definitionRef: structuredClone(input.current.definitionRef),
    acceptedDraftRef: structuredClone(input.current.acceptedDraftRef),
    externalRequestRef: structuredClone(input.current.externalRequestRef),
    operationalBindingRef: structuredClone(input.current.operationalBindingRef),
    originalRequesterRef: structuredClone(input.current.originalRequesterRef),
    title: input.current.title,
    requestKind: input.current.requestKind,
    ...semantic,
    blockersDeclared: input.semanticInput.blockers !== undefined,
    blockers: structuredClone(input.semanticInput.blockers ?? []),
    dependenciesDeclared: input.semanticInput.dependencies !== undefined,
    dependencies: structuredClone(input.semanticInput.dependencies ?? []),
    dataClassificationKey: input.current.dataClassificationKey,
    responseChannelResolution: structuredClone(
      input.responseChannelResolution ?? input.current.responseChannelResolution,
    ),
    readyEffectGuard: Object.freeze({
      observedState: "NONE" as const,
      expectedAggregateVersion: input.current.readyEffectGuard.expectedAggregateVersion + 1,
    }),
    invalidatedState: Object.freeze(
      structuredClone(
        input.invalidatedState ?? {
          readinessAssessmentRefs: [],
          waiverRefs: [],
          pendingReadyCommandRefs: [],
        },
      ),
    ),
    changeReasonCode: input.changeReasonCode,
    changeReason: input.reason,
    recordedBy: structuredClone(input.actor),
    authorizationBasisHash: input.authorizationBasisHash,
    recordedAt: input.recordedAt,
    correlationId: input.correlationId,
  });
  const revision = Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
  if (revision.contentHash === input.current.contentHash)
    throw new QaDomainError("QA_REQUEST_INPUT_NOOP");
  return revision;
}
