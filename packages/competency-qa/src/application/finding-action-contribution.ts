import { QaDomainError } from "../domain/primitives.ts";
import {
  defineQaExactActionHandlerContribution,
  type QaPlatformAction,
} from "./exact-action-port.ts";

export type QaFindingActionDecision = "ACCEPTED_RISK" | "WAIVED";
export interface QaFindingActionCandidate {
  readonly scope: Readonly<{ workspaceId: string; projectId: string }>;
  readonly findingId: string;
  readonly findingReviewRef: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly decision: QaFindingActionDecision;
  readonly initiatorId: string;
  readonly reason: string;
  readonly expiresAt: string;
}

export function createQaFindingActionContribution(
  input: Readonly<{
    now: () => string;
    roleFor: (principalId: string, workspaceId: string, projectId: string) => Promise<string>;
    persistApproved: (
      candidate: QaFindingActionCandidate,
      approval: Readonly<{
        approvalId: string;
        approverId: string;
        authorizationBasisHash: string;
      }>,
    ) => Promise<
      Readonly<{ actionRef: Readonly<{ id: string; version: number; contentHash: string }> }>
    >;
  }>,
) {
  return defineQaExactActionHandlerContribution<
    QaFindingActionCandidate,
    Readonly<{ actionRef: Readonly<{ id: string; version: number; contentHash: string }> }>
  >({
    key: "competency-qa.finding-action@1",
    actionKind: "QA_FINDING_ACTION",
    execute: async (action: QaPlatformAction<QaFindingActionCandidate>, context) => {
      const candidate = action.candidate;
      if (
        !candidate ||
        candidate.scope.workspaceId !== context.workspaceId ||
        candidate.scope.projectId !== context.projectId
      )
        throw new QaDomainError("QA_FINDING_ACTION_SCOPE_MISMATCH");
      if (candidate.initiatorId === context.approverId)
        throw new QaDomainError("QA_FINDING_DISTINCT_LEAD_REQUIRED");
      if (
        (await input.roleFor(context.approverId, context.workspaceId, context.projectId)) !==
        "QA_LEAD"
      )
        throw new QaDomainError("QA_FINDING_LEAD_REQUIRED");
      if (Date.parse(input.now()) >= Date.parse(candidate.expiresAt))
        throw new QaDomainError("QA_FINDING_ACTION_EXPIRED");
      if (!candidate.reason.trim()) throw new QaDomainError("QA_FINDING_ACTION_REASON_REQUIRED");
      return await input.persistApproved(candidate, {
        approvalId: context.approvalId,
        approverId: context.approverId,
        authorizationBasisHash: context.authorizationBasisHash,
      });
    },
  });
}
