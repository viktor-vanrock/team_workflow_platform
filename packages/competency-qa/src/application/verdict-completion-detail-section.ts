import type { QaScope } from "../domain/primitives.ts";
import type {
  QaWorkItemDetailReadContext,
  QaWorkItemDetailSectionContribution,
} from "./qa-work-item-detail.ts";

export interface QaVerdictCompletionDetailReadPort {
  verdicts(scope: QaScope, workItemId: string): Promise<readonly unknown[]>;
  verdictSignatures(scope: QaScope, workItemId: string): Promise<readonly unknown[]>;
  dodAssessments(scope: QaScope, workItemId: string): Promise<readonly unknown[]>;
  completionCandidates(scope: QaScope, workItemId: string): Promise<readonly unknown[]>;
  finalCloseConfirmations(scope: QaScope, workItemId: string): Promise<readonly unknown[]>;
  postCloseCorrectionMarkers(scope: QaScope, workItemId: string): Promise<readonly unknown[]>;
}

export function createQaVerdictCompletionDetailSection(
  port: QaVerdictCompletionDetailReadPort,
): QaWorkItemDetailSectionContribution {
  return Object.freeze({
    key: "qa.verdict-completion",
    order: 600,
    load: async ({ workspaceId, projectId, workItemId }: QaWorkItemDetailReadContext) => {
      const scope = { workspaceId, projectId };
      const [
        verdicts,
        verdictSignatures,
        dodAssessments,
        completionCandidates,
        finalCloseConfirmations,
        postCloseCorrectionMarkers,
      ] = await Promise.all([
        port.verdicts(scope, workItemId),
        port.verdictSignatures(scope, workItemId),
        port.dodAssessments(scope, workItemId),
        port.completionCandidates(scope, workItemId),
        port.finalCloseConfirmations(scope, workItemId),
        port.postCloseCorrectionMarkers(scope, workItemId),
      ]);
      return Object.freeze({
        verdicts,
        verdictSignatures,
        dodAssessments,
        completionCandidates,
        finalCloseConfirmations,
        postCloseCorrectionMarkers,
      });
    },
  });
}
