import type { QaEvidenceManifestRevision } from "../domain/evidence-manifest.ts";
import type { QaManualAttempt } from "../domain/manual-attempt.ts";
import type { QaObservation } from "../domain/observation.ts";
import type { QaPlanItemResultRevision } from "../domain/plan-item-result.ts";
import type { QaWorkspaceContext } from "../domain/primitives.ts";
import type { QaSessionReview } from "../domain/session-review.ts";
import { qaSchemaReferences } from "../manifest.ts";
import { buildQaAuditDelta, buildQaDomainEvent, qaDomainEventDelta } from "./domain-events.ts";

const schema = Object.freeze({
  id: "urn:awp:schemas:qa:event-payload:manual-review:v1",
  version: 1,
  digest: qaSchemaReferences.events.digest,
});

export function qaPlanItemResultRecordedEvent(
  input: Readonly<{
    context: QaWorkspaceContext;
    eventId: string;
    result: QaPlanItemResultRevision;
    classificationKey: string;
  }>,
) {
  return qaDomainEventDelta(
    buildQaDomainEvent({
      context: input.context,
      eventId: input.eventId,
      eventType: "qa.plan-item.result-recorded",
      entityType: "qa-plan-item-result",
      entityId: input.result.id,
      entityVersion: input.result.version,
      occurredAt: input.result.recordedAt,
      recordedAt: input.result.recordedAt,
      dataClassificationKey: input.classificationKey,
      payloadSchemaRef: schema,
      payload: {
        workItemId: input.result.workItemId,
        sessionId: input.result.sessionId,
        planItemId: input.result.planItemId,
        resultRevisionRef: {
          id: input.result.id,
          version: input.result.version,
          contentHash: input.result.contentHash,
        },
        result: input.result.result,
        attemptCount: input.result.consideredAttemptRefs.length,
        observationCount: input.result.consideredObservationRefs.length,
        evidenceCount: input.result.evidenceLinkIds.length,
        maximumAttemptNo: input.result.maximumAttemptNo,
      },
    }),
  );
}

export function qaEvidenceManifestSignedEvent(
  input: Readonly<{
    context: QaWorkspaceContext;
    eventId: string;
    manifest: QaEvidenceManifestRevision;
    classificationKey: string;
  }>,
) {
  return qaDomainEventDelta(
    buildQaDomainEvent({
      context: input.context,
      eventId: input.eventId,
      eventType: "qa.evidence.manifest-signed",
      entityType: "qa-evidence-manifest",
      entityId: input.manifest.manifestId,
      entityVersion: input.manifest.version,
      occurredAt: input.manifest.reviewedAt,
      recordedAt: input.manifest.reviewedAt,
      dataClassificationKey: input.classificationKey,
      payloadSchemaRef: schema,
      payload: {
        workItemId: input.manifest.workItemId,
        sessionId: input.manifest.sessionId,
        manifestRevisionRef: {
          id: input.manifest.manifestRevisionId,
          version: input.manifest.version,
          contentHash: input.manifest.contentHash,
        },
        kind: input.manifest.kind,
        sessionOutcome: input.manifest.sessionOutcome,
        artifactMemberCount: input.manifest.artifactMembers.length,
      },
    }),
  );
}

export function qaTestSessionReviewedEvent(
  input: Readonly<{
    context: QaWorkspaceContext;
    eventId: string;
    review: QaSessionReview;
    classificationKey: string;
    frozenFindingReviewRefs?: readonly Readonly<{
      id: string;
      version: number;
      contentHash: string;
    }>[];
  }>,
) {
  return qaDomainEventDelta(
    buildQaDomainEvent({
      context: input.context,
      eventId: input.eventId,
      eventType: "qa.test-session.reviewed",
      entityType: "qa-test-session",
      entityId: input.review.sessionId,
      entityVersion: input.review.version,
      occurredAt: input.review.reviewedAt,
      recordedAt: input.review.reviewedAt,
      dataClassificationKey: input.classificationKey,
      payloadSchemaRef: schema,
      payload: {
        workItemId: input.review.workItemId,
        sessionReviewRef: {
          id: input.review.id,
          version: input.review.version,
          contentHash: input.review.contentHash,
        },
        manifestRevisionRef: input.review.adjudicativeManifestRevisionRef,
        sessionOutcome: input.review.sessionOutcome,
        frozenFindingReviewRefs: input.frozenFindingReviewRefs ?? [],
      },
    }),
  );
}

export function manualExecutionAudit(
  input: Readonly<{
    action: string;
    attempt?: QaManualAttempt;
    observation?: QaObservation;
    result?: QaPlanItemResultRevision;
    reasonCode: string;
  }>,
) {
  const source = input.result ?? input.observation ?? input.attempt;
  return buildQaAuditDelta({
    action: input.action,
    outcome: "SUCCEEDED",
    reasonCode: input.reasonCode,
    attributes: source
      ? {
          workItemId: source.workItemId,
          sessionId: source.sessionId,
          planItemId: source.planItemId,
          attemptId:
            "attemptNo" in source ? source.id : "attemptId" in source ? source.attemptId : null,
          resultRevisionId: "consideredAttemptRefs" in source ? source.id : null,
          correctionRef:
            "correctsObservationRef" in source ? (source.correctsObservationRef?.id ?? null) : null,
          cancellationCode:
            "cancellationReason" in source && source.cancellationReason ? "HUMAN_CANCELLED" : null,
        }
      : {},
  });
}
