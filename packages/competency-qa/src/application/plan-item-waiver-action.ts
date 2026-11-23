import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaScope,
} from "../domain/primitives.ts";
import {
  defineQaExactActionHandlerContribution,
  type QaPlatformAction,
} from "./exact-action-port.ts";

export interface QaPlanItemWaiverCandidate {
  readonly scope: QaScope;
  readonly workItemId: string;
  readonly sessionId: string;
  readonly planItemId: string;
  readonly initiatorId: string;
  readonly reason: string;
  readonly expiresAt: string;
  readonly subjectHash: QaContentHash;
}

export function createPlanItemWaiverCandidate(
  input: Omit<QaPlanItemWaiverCandidate, "subjectHash">,
): QaPlanItemWaiverCandidate {
  if (
    !input.reason.trim() ||
    input.reason.length > 2_000 ||
    Number.isNaN(Date.parse(input.expiresAt))
  )
    throw new QaDomainError("QA_PLAN_ITEM_WAIVER_INVALID");
  return Object.freeze({
    ...structuredClone(input),
    subjectHash: qaAggregateSnapshotHash(input as never),
  });
}

export function createQaPlanItemWaiverActionContribution(
  input: Readonly<{
    now: () => string;
    roleFor: (principalId: string, workspaceId: string, projectId: string) => Promise<string>;
    persistApproved: (
      candidate: QaPlanItemWaiverCandidate,
      approval: Readonly<{
        approvalId: string;
        approverId: string;
        authorizationBasisHash: string;
      }>,
    ) => Promise<Readonly<{ waiverId: string; contentHash: string }>>;
  }>,
) {
  return defineQaExactActionHandlerContribution<
    QaPlanItemWaiverCandidate,
    Readonly<{ waiverId: string; contentHash: string }>
  >({
    key: "competency-qa.plan-item-waiver@1",
    actionKind: "QA_PLAN_ITEM_WAIVER",
    execute: async (action: QaPlatformAction<QaPlanItemWaiverCandidate>, context) => {
      const candidate = action.candidate;
      if (
        candidate.scope.workspaceId !== context.workspaceId ||
        candidate.scope.projectId !== context.projectId
      )
        throw new QaDomainError("QA_PLAN_ITEM_WAIVER_SCOPE_MISMATCH");
      if (candidate.initiatorId === context.approverId)
        throw new QaDomainError("QA_PLAN_ITEM_WAIVER_DISTINCT_LEAD_REQUIRED");
      if (
        (await input.roleFor(context.approverId, context.workspaceId, context.projectId)) !==
        "QA_LEAD"
      )
        throw new QaDomainError("QA_PLAN_ITEM_WAIVER_LEAD_REQUIRED");
      if (Date.parse(input.now()) >= Date.parse(candidate.expiresAt))
        throw new QaDomainError("QA_PLAN_ITEM_WAIVER_EXPIRED");
      return await input.persistApproved(candidate, {
        approvalId: context.approvalId,
        approverId: context.approverId,
        authorizationBasisHash: context.authorizationBasisHash,
      });
    },
  });
}
