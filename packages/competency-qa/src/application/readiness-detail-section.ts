import type { QaScope } from "../domain/primitives.ts";
import type { QaReadinessAssessment } from "../domain/readiness.ts";
import type { QaRequiredSessionPlanHeader } from "../domain/required-session-plan.ts";
import type {
  QaWorkItemDetailReadContext,
  QaWorkItemDetailSectionContribution,
} from "./qa-work-item-detail.ts";

export interface QaReadinessDetailReadPort {
  latest(scope: QaScope, workItemId: string): Promise<QaReadinessAssessment | undefined>;
  assessmentHistory(scope: QaScope, workItemId: string): Promise<readonly QaReadinessAssessment[]>;
  plan(scope: QaScope, workItemId: string): Promise<QaRequiredSessionPlanHeader | undefined>;
  operational(
    scope: QaScope,
    workItemId: string,
  ): Promise<Readonly<{ normalizedStatus: string; syncStage: string }>>;
}

export function createQaReadinessDetailSection(
  port: QaReadinessDetailReadPort,
): QaWorkItemDetailSectionContribution {
  return Object.freeze({
    key: "qa.readiness",
    order: 200,
    load: async ({ workspaceId, projectId, workItemId }: QaWorkItemDetailReadContext) => {
      const scope = { workspaceId, projectId };
      const [latest, assessments, plan, operational] = await Promise.all([
        port.latest(scope, workItemId),
        port.assessmentHistory(scope, workItemId),
        port.plan(scope, workItemId),
        port.operational(scope, workItemId),
      ]);
      return Object.freeze({
        operationalReadiness: latest
          ? Object.freeze({
              assessmentRef: {
                id: latest.assessmentId,
                version: latest.version,
                contentHash: latest.contentHash,
              },
              assessmentState: latest.state,
              ...operational,
            })
          : Object.freeze({
              assessmentRef: null,
              assessmentState: "NOT_EVALUATED",
              ...operational,
            }),
        readinessAssessments: assessments,
        requiredSessionPlanHistory:
          plan ??
          Object.freeze({
            currentRevisionRef: null,
            revisions: Object.freeze([]),
            resourceVersion: 1,
          }),
      });
    },
  });
}
