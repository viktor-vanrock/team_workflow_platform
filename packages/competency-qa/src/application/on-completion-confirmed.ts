import { buildQaDodAssessment } from "../domain/dod.ts";
import { qaAggregateSnapshotHash, QaDomainError } from "../domain/primitives.ts";
import type { QaCompletionCandidateStore } from "./invalidate-completion-candidate.ts";

export { createQaTypeOrmCompletionConfirmationHook } from "./completion-confirmation-persistence.ts";

export interface QaCompletionConfirmationInput {
  readonly candidateId: string;
  readonly commandId: string;
  readonly summaryContentHash: `sha256:${string}`;
  readonly summaryReceipt: Readonly<{ id: string; contentHash: `sha256:${string}` }>;
  readonly normalizedStatus: "DONE";
  readonly rawExternalState: string;
  readonly externalVersion: string;
  readonly confirmedAt: string;
}

export function confirmQaCompletion(
  store: QaCompletionCandidateStore,
  input: QaCompletionConfirmationInput,
): Readonly<{ replayed: boolean; confirmationId: string }> {
  const candidate = store.candidate(input.candidateId);
  if (
    !candidate ||
    candidate.commandRef?.id !== input.commandId ||
    input.normalizedStatus !== "DONE" ||
    input.summaryContentHash !== candidate.summary.contentHash ||
    input.summaryReceipt.contentHash !== candidate.summary.contentHash
  ) {
    throw new QaDomainError("QA_COMPLETION_CONFIRMATION_MISMATCH");
  }
  const confirmationId = `final-close:${candidate.candidateId}`;
  if (candidate.state === "CONFIRMED") return Object.freeze({ replayed: true, confirmationId });
  if (candidate.state !== "DISPATCHED")
    throw new QaDomainError("QA_COMPLETION_CONFIRMATION_STATE_INVALID");
  const confirmationRef = Object.freeze({
    id: confirmationId,
    version: 1,
    contentHash: qaAggregateSnapshotHash({
      candidateRef: candidate.ref,
      commandId: input.commandId,
      summaryReceipt: input.summaryReceipt,
      rawExternalState: input.rawExternalState,
      externalVersion: input.externalVersion,
    } as never),
  });
  candidate.confirm({
    confirmationRef,
    summaryReceipt: input.summaryReceipt,
    at: input.confirmedAt,
  });
  store.addConfirmation(confirmationRef);
  store.releaseInFlight(candidate);
  store.appendDod(
    buildQaDodAssessment({
      assessmentId: `dod:satisfied:${candidate.candidateId}`,
      version: 1,
      workspaceId: candidate.workspaceId,
      projectId: candidate.projectId,
      workItemId: candidate.workItemId,
      state: "SATISFIED",
      blockerCodes: Object.freeze([]),
      warningCodes: Object.freeze([]),
      inventory: Object.freeze({
        requiredSessionPlanRef: candidate.requiredSessionPlanRef,
        verdictRef: candidate.verdictRef,
        sessionReviewRefs: Object.freeze([]),
        evidenceManifestRefs: candidate.summary.evidenceManifestRefs,
        findingOutcomeRefs: candidate.summary.defectLinkOrDispositionRefs,
        waiverRefs: Object.freeze([]),
      }),
      aggregateInputHash: candidate.aggregateSnapshotHash,
      ruleSetRef: {
        id: "qa.dod.rules",
        version: 1,
        contentHash: qaAggregateSnapshotHash({ id: "qa.dod.rules", version: "1.0.0" } as never),
      },
      riskPolicyRef: {
        id: "qa.risk.policy",
        version: 1,
        contentHash: qaAggregateSnapshotHash({ id: "qa.risk.policy", version: 1 } as never),
      },
      evaluatedBy: "confirmation-hook",
      evaluatedAt: input.confirmedAt,
      completionConfirmationRef: confirmationRef,
    }),
  );
  return Object.freeze({ replayed: false, confirmationId });
}
