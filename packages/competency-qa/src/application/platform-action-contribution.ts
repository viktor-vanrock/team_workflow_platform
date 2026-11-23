import type { QaPlatformAction } from "./exact-action-port.ts";
import {
  executeReadinessWaiverAction,
  QA_DOR_WAIVER_ACTION_KIND,
  type QaDorWaiverActionSubject,
} from "./readiness-waiver-action.ts";

export function createQaReadinessWaiverActionContribution(
  input: Readonly<{
    now: () => string;
    roleFor: (approverId: string, workspaceId: string, projectId: string) => Promise<string>;
  }>,
) {
  return Object.freeze({
    key: "qa.readiness.dor-waiver-handler",
    order: 2100,
    matches: (action: QaPlatformAction) => action.kind === QA_DOR_WAIVER_ACTION_KIND,
    execute: async (
      action: QaPlatformAction<QaDorWaiverActionSubject>,
      context: Readonly<{
        workspaceId: string;
        projectId: string;
        approverId: string;
        authorizationBasisHash: string;
      }>,
    ) =>
      executeReadinessWaiverAction(action.candidate, {
        scope: { workspaceId: context.workspaceId, projectId: context.projectId },
        approverId: context.approverId,
        role: await input.roleFor(context.approverId, context.workspaceId, context.projectId),
        authorizationBasisHash: context.authorizationBasisHash as `sha256:${string}`,
        decidedAt: input.now(),
      }),
  });
}
