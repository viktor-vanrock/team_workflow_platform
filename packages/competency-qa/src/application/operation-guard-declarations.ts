import type { QaMutationClass } from "./qa-adjudicative-mutation-guard.ts";

export interface QaOperationGuardDeclaration {
  readonly operationId: string;
  readonly classification: QaMutationClass;
}

const aggregateMutationOperationIds = Object.freeze([
  "confirmQaIntakeDraft",
  "reviseQaRequestInputs",
  "evaluateQaReadiness",
  "confirmQaReadiness",
  "requestQaWaiver",
  "publishRequiredSessionPlanRevision",
  "createQaSession",
  "transitionQaSession",
  "createQaPlanItem",
  "updateQaPlanItemBeforeSessionStart",
  "startManualAttempt",
  "completeManualAttempt",
  "recordQaObservation",
  "recordQaPlanItemResultRevision",
  "reviewQaSessionAndPublishEvidence",
  "createQaFinding",
  "assignQaObservationToFinding",
  "releaseQaObservationFromFinding",
  "classifyQaFinding",
  "disposeQaFinding",
  "createQaDefectDraft",
  "publishQaDefectDraft",
  "rejectQaDefectDraft",
  "createQaVerdict",
  "supersedeQaVerdictBeforeDone",
  "signQaVerdict",
  "evaluateQaDefinitionOfDone",
  "createQaCompletionCandidate",
] as const);

export const qaOperationGuardDeclarations: readonly QaOperationGuardDeclaration[] = Object.freeze([
  ...aggregateMutationOperationIds.map((operationId) =>
    Object.freeze({ operationId, classification: "AGGREGATE_MUTATION" as const }),
  ),
  Object.freeze({
    operationId: "requestQaDefectDraftWordingProposal",
    classification: "READ_ONLY" as const,
  }),
  Object.freeze({
    operationId: "requestQaFinalClose",
    classification: "COMPLETION_SELF_TRANSITION" as const,
  }),
  Object.freeze({
    operationId: "createQaPostCloseManifestRevision",
    classification: "POST_CLOSE_CLERICAL_CORRECTION" as const,
  }),
]);

export function qaOperationGuardClass(operationId: string): QaMutationClass {
  const declaration = qaOperationGuardDeclarations.find(
    (candidate) => candidate.operationId === operationId,
  );
  if (!declaration) throw new Error(`QA_OPERATION_GUARD_DECLARATION_MISSING:${operationId}`);
  return declaration.classification;
}
