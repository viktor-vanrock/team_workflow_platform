import { QaDomainError } from "../domain/primitives.ts";
import type { QaRequestRepository } from "../persistence/qa-request.repository.ts";
import type { QaRequestInputRepository } from "../persistence/qa-request-input.repository.ts";
import type {
  QaWorkItemDetailReadContext,
  QaWorkItemDetailSectionContribution,
} from "./qa-work-item-detail.ts";

export function createQaIntakeDetailSection(
  input: Readonly<{
    requests: QaRequestRepository;
    inputs: QaRequestInputRepository;
  }>,
): QaWorkItemDetailSectionContribution {
  return Object.freeze({
    key: "qa.intake",
    order: 2000,
    load: async (context: QaWorkItemDetailReadContext) => {
      const scope = { workspaceId: context.workspaceId, projectId: context.projectId };
      const extension = await input.requests.byWorkItem(scope, context.workItemId);
      if (!extension) throw new QaDomainError("QA_REQUEST_DETAIL_NOT_FOUND");
      const revisions = await input.inputs.history(scope, context.workItemId);
      if (revisions.length === 0) throw new QaDomainError("QA_REQUEST_INPUT_HISTORY_EMPTY");
      return Object.freeze({
        requestExtension: extension,
        requestInputHistory: Object.freeze({
          schemaVersion: 1,
          workspaceId: context.workspaceId,
          projectId: context.projectId,
          workItemId: context.workItemId,
          extensionId: extension.extensionId,
          currentInputRevisionRef: extension.currentRequestInputRevisionRef,
          resourceVersion: extension.resourceVersion,
          revisions,
        }),
      });
    },
  });
}
