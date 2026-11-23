import type { QaPlanItem } from "../domain/plan-item.ts";
import type { QaScope } from "../domain/primitives.ts";
import type { QaTestSession } from "../domain/test-session.ts";
import type {
  QaWorkItemDetailReadContext,
  QaWorkItemDetailSectionContribution,
} from "./qa-work-item-detail.ts";

export interface QaSessionDetailReadPort {
  sessions(scope: QaScope, workItemId: string): Promise<readonly QaTestSession[]>;
  planItems(scope: QaScope, workItemId: string): Promise<readonly QaPlanItem[]>;
}
export function createQaSessionDetailSection(
  port: QaSessionDetailReadPort,
): QaWorkItemDetailSectionContribution {
  return Object.freeze({
    key: "qa.sessions",
    order: 300,
    load: async ({ workspaceId, projectId, workItemId }: QaWorkItemDetailReadContext) =>
      Object.freeze({
        sessions: await port.sessions({ workspaceId, projectId }, workItemId),
        planItems: await port.planItems({ workspaceId, projectId }, workItemId),
      }),
  });
}
