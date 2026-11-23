import type { QaScope } from "../domain/primitives.ts";
import type {
  QaWorkItemDetailReadContext,
  QaWorkItemDetailSectionContribution,
} from "./qa-work-item-detail.ts";

export interface QaFindingDefectDetailReadPort {
  findings(scope: QaScope, workItemId: string): Promise<readonly unknown[]>;
  findingReviewRevisions(scope: QaScope, workItemId: string): Promise<readonly unknown[]>;
  defectDrafts(scope: QaScope, workItemId: string): Promise<readonly unknown[]>;
  defectLinks(scope: QaScope, workItemId: string): Promise<readonly unknown[]>;
}

export function createQaFindingDefectDetailSection(
  port: QaFindingDefectDetailReadPort,
): QaWorkItemDetailSectionContribution {
  return Object.freeze({
    key: "qa.findings-defects",
    order: 500,
    load: async ({ workspaceId, projectId, workItemId }: QaWorkItemDetailReadContext) => {
      const scope = { workspaceId, projectId };
      const [findings, findingReviewRevisions, defectDrafts, defectLinks] = await Promise.all([
        port.findings(scope, workItemId),
        port.findingReviewRevisions(scope, workItemId),
        port.defectDrafts(scope, workItemId),
        port.defectLinks(scope, workItemId),
      ]);
      return Object.freeze({ findings, findingReviewRevisions, defectDrafts, defectLinks });
    },
  });
}
