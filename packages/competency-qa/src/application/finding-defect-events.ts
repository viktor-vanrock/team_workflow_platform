import type { QaFindingReviewRevision } from "../domain/finding.ts";
import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
} from "../domain/primitives.ts";

export interface QaFindingDecisionEvent {
  readonly eventType: "qa.finding.classified" | "qa.finding.disposed";
  readonly findingId: string;
  readonly sessionId: string;
  readonly reviewRef: Readonly<{ id: string; version: number; contentHash: QaContentHash }>;
  readonly membershipSetHash: QaContentHash;
  readonly decision: string;
  readonly platformActionRef?: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly payloadHash: QaContentHash;
}

export function buildQaFindingDecisionEvent(
  review: QaFindingReviewRevision,
): QaFindingDecisionEvent {
  if (review.stage === "FROZEN") throw new QaDomainError("QA_FINDING_FROZEN_EVENT_FORBIDDEN");
  const actionRef = review.acceptedRiskActionRef ?? review.waiverActionRef;
  if (
    (review.dispositionDecision === "ACCEPTED_RISK" || review.dispositionDecision === "WAIVED") !==
    (actionRef !== undefined)
  ) {
    throw new QaDomainError("QA_FINDING_ACTION_REF_SHAPE_INVALID");
  }
  const body = {
    eventType:
      review.stage === "CLASSIFIED"
        ? ("qa.finding.classified" as const)
        : ("qa.finding.disposed" as const),
    findingId: review.findingId,
    sessionId: review.sessionId,
    reviewRef: { id: review.id, version: review.version, contentHash: review.contentHash },
    membershipSetHash: review.activeMembershipSetHash,
    decision: review.stage === "CLASSIFIED" ? review.classification : review.dispositionDecision!,
    ...(actionRef ? { platformActionRef: actionRef } : {}),
  };
  return Object.freeze({ ...body, payloadHash: qaAggregateSnapshotHash(body as never) });
}
