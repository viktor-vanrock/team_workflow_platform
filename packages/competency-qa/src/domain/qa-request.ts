import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
  type QaScope,
} from "./primitives.ts";
import {
  type QaProjectContext,
  qaProjectContextRef,
  type QaRiskReviewPolicyRef,
} from "./qa-project-context.ts";
import {
  type QaRequestInputRevision,
  qaRequestInputRevisionRef,
} from "./qa-request-input-revision.ts";

export interface QaRequestExtension {
  readonly schemaVersion: 1;
  readonly extensionId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly definitionRef: Readonly<{ key: "qa.validation"; version: "1.0.0" }>;
  readonly currentRequestInputRevisionRef: Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
  readonly latestReadinessAssessmentRef?: Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
  readonly currentRequiredSessionPlanRevisionRef?: Readonly<{
    id: string;
    version: number;
    contentHash: QaContentHash;
  }>;
  readonly projectContextRef: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
  readonly dorRuleSetRef: QaProjectContext["dorRuleSetRef"];
  readonly dodRuleSetRef: QaProjectContext["dodRuleSetRef"];
  readonly evidencePolicyRef: QaProjectContext["evidencePolicyRef"];
  readonly riskReviewPolicyRef: QaRiskReviewPolicyRef;
  readonly adjudicativeAggregateHash: QaContentHash;
  readonly completionDispatchGuard: Readonly<{ state: "OPEN" }>;
  readonly resourceVersion: number;
  readonly contentHash: QaContentHash;
  readonly createdBy: QaHumanActor;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly correlationId: string;
}

export function createQaRequestExtension(
  input: Readonly<{
    extensionId: string;
    scope: QaScope;
    workItemId: string;
    currentInput: QaRequestInputRevision;
    projectContext: QaProjectContext;
    createdBy: QaHumanActor;
    createdAt: string;
    correlationId: string;
  }>,
): QaRequestExtension {
  if (
    input.currentInput.workspaceId !== input.scope.workspaceId ||
    input.currentInput.projectId !== input.scope.projectId ||
    input.currentInput.workItemId !== input.workItemId ||
    input.projectContext.workspaceId !== input.scope.workspaceId ||
    input.projectContext.projectId !== input.scope.projectId
  )
    throw new QaDomainError("QA_REQUEST_EXTENSION_SCOPE_MISMATCH");
  const aggregateHash = qaAggregateSnapshotHash({
    currentRequestInputRevisionRef: qaRequestInputRevisionRef(input.currentInput),
  } as never);
  const body = Object.freeze({
    schemaVersion: 1 as const,
    extensionId: input.extensionId,
    workspaceId: input.scope.workspaceId,
    projectId: input.scope.projectId,
    workItemId: input.workItemId,
    definitionRef: Object.freeze({ key: "qa.validation" as const, version: "1.0.0" as const }),
    currentRequestInputRevisionRef: qaRequestInputRevisionRef(input.currentInput),
    projectContextRef: qaProjectContextRef(input.projectContext),
    dorRuleSetRef: input.projectContext.dorRuleSetRef,
    dodRuleSetRef: input.projectContext.dodRuleSetRef,
    evidencePolicyRef: input.projectContext.evidencePolicyRef,
    riskReviewPolicyRef: input.projectContext.riskReviewPolicyRef,
    adjudicativeAggregateHash: aggregateHash,
    completionDispatchGuard: Object.freeze({ state: "OPEN" as const }),
    resourceVersion: 1 as const,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    correlationId: input.correlationId,
  });
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}
