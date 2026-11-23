import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
  type QaScope,
} from "./primitives.ts";

export interface QaRiskReviewPolicy {
  readonly schemaVersion: 1;
  readonly policyId: string;
  readonly version: number;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly permissionKeys: Readonly<{
    verdictSign: "qa.verdict.sign";
    verdictCosign: "qa.verdict.cosign";
    waiverApprove: "qa.waiver.approve";
    acceptedRiskApprove: "qa.finding.accept-risk";
    finalCloseApprove: "qa.completion.approve";
  }>;
  readonly ordinaryVerdict: Readonly<{ requiredSignerRole: "QA_EXECUTOR"; minimumSignatures: 1 }>;
  readonly elevatedVerdict: Readonly<{
    riskLevels: readonly ["HIGH", "CRITICAL"];
    primarySignerRole: "QA_EXECUTOR";
    coSignerRole: "QA_LEAD";
    distinctActorRequired: true;
  }>;
  readonly waiverReview: Readonly<{
    approverRole: "QA_LEAD";
    distinctActorRequired: true;
    reasonRequired: true;
    expiryRequired: true;
  }>;
  readonly acceptedRiskReview: Readonly<{ approverRole: "QA_LEAD"; distinctActorRequired: true }>;
  readonly finalCloseReview: Readonly<{
    approverRole: "QA_LEAD";
    distinctActorRequired: true;
    liveAuthorizationRecheck: true;
  }>;
  readonly contentHash: QaContentHash;
  readonly createdBy: QaHumanActor;
  readonly publishedBy: QaHumanActor;
  readonly publishedAt: string;
}

export function publishQaRiskReviewPolicy(
  input: Readonly<{
    policyId: string;
    version: number;
    scope: QaScope;
    actor: QaHumanActor;
    publishedAt: string;
  }>,
): QaRiskReviewPolicy {
  if (
    input.policyId.length === 0 ||
    input.version < 1 ||
    Number.isNaN(Date.parse(input.publishedAt))
  ) {
    throw new QaDomainError("QA_RISK_REVIEW_POLICY_INVALID");
  }
  const body = Object.freeze({
    schemaVersion: 1 as const,
    policyId: input.policyId,
    version: input.version,
    workspaceId: input.scope.workspaceId,
    projectId: input.scope.projectId,
    permissionKeys: Object.freeze({
      verdictSign: "qa.verdict.sign" as const,
      verdictCosign: "qa.verdict.cosign" as const,
      waiverApprove: "qa.waiver.approve" as const,
      acceptedRiskApprove: "qa.finding.accept-risk" as const,
      finalCloseApprove: "qa.completion.approve" as const,
    }),
    ordinaryVerdict: Object.freeze({
      requiredSignerRole: "QA_EXECUTOR" as const,
      minimumSignatures: 1 as const,
    }),
    elevatedVerdict: Object.freeze({
      riskLevels: Object.freeze(["HIGH", "CRITICAL"] as const),
      primarySignerRole: "QA_EXECUTOR" as const,
      coSignerRole: "QA_LEAD" as const,
      distinctActorRequired: true as const,
    }),
    waiverReview: Object.freeze({
      approverRole: "QA_LEAD" as const,
      distinctActorRequired: true as const,
      reasonRequired: true as const,
      expiryRequired: true as const,
    }),
    acceptedRiskReview: Object.freeze({
      approverRole: "QA_LEAD" as const,
      distinctActorRequired: true as const,
    }),
    finalCloseReview: Object.freeze({
      approverRole: "QA_LEAD" as const,
      distinctActorRequired: true as const,
      liveAuthorizationRecheck: true as const,
    }),
    createdBy: input.actor,
    publishedBy: input.actor,
    publishedAt: input.publishedAt,
  });
  return Object.freeze({ ...body, contentHash: qaAggregateSnapshotHash(body as never) });
}
