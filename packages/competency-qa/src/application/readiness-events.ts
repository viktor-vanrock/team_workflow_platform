import type { QaWorkspaceContext } from "../domain/primitives.ts";
import type { QaRequestInputRevision } from "../domain/qa-request-input-revision.ts";
import type { QaReadinessAssessment } from "../domain/readiness.ts";
import type { QaRequiredSessionPlanRevision } from "../domain/required-session-plan.ts";
import { qaSchemaReferences } from "../manifest.ts";
import { buildQaAuditDelta, buildQaDomainEvent, qaDomainEventDelta } from "./domain-events.ts";

const schema = Object.freeze({
  id: "urn:awp:schemas:qa:event-payload:readiness:v1",
  version: 1,
  digest: qaSchemaReferences.events.digest,
});

export function qaRequestInputRevisedEvent(
  input: Readonly<{
    context: QaWorkspaceContext;
    eventId: string;
    revision: QaRequestInputRevision;
    occurredAt: string;
  }>,
) {
  if (
    !input.revision.changeReason ||
    input.revision.changeReasonCode === "INITIAL_CONFIRMED_DRAFT" ||
    !input.revision.previousRevisionRef
  )
    throw new Error("QA_INPUT_REVISION_REASON_REQUIRED");
  return qaDomainEventDelta(
    buildQaDomainEvent({
      context: input.context,
      eventId: input.eventId,
      eventType: "qa.request.input-revised",
      entityType: "qa-request-input",
      entityId: input.revision.inputRevisionId,
      entityVersion: input.revision.version,
      occurredAt: input.occurredAt,
      recordedAt: input.occurredAt,
      dataClassificationKey: input.revision.dataClassificationKey,
      payloadSchemaRef: schema,
      payload: {
        workItemId: input.revision.workItemId,
        inputRevisionRef: {
          id: input.revision.inputRevisionId,
          version: input.revision.version,
          contentHash: input.revision.contentHash,
        },
        previousRevisionRef: input.revision.previousRevisionRef,
        changeReasonCode: input.revision.changeReasonCode,
      },
    }),
  );
}

export function qaReadinessAssessedEvent(
  input: Readonly<{
    context: QaWorkspaceContext;
    eventId: string;
    assessment: QaReadinessAssessment;
    classificationKey: string;
    occurredAt: string;
  }>,
) {
  return qaDomainEventDelta(
    buildQaDomainEvent({
      context: input.context,
      eventId: input.eventId,
      eventType: "qa.readiness.assessed",
      entityType: "qa-readiness",
      entityId: input.assessment.assessmentId,
      entityVersion: input.assessment.version,
      occurredAt: input.occurredAt,
      recordedAt: input.occurredAt,
      dataClassificationKey: input.classificationKey,
      payloadSchemaRef: schema,
      payload: {
        workItemId: input.assessment.workItemId,
        requestInputRevisionRef: input.assessment.requestInputRevisionRef,
        state: input.assessment.state,
        blockerCodes: input.assessment.blockers.map(({ code }) => code),
        inputFingerprint: input.assessment.inputFingerprint,
      },
    }),
  );
}

export function qaRequiredSessionPlanPublishedEvent(
  input: Readonly<{
    context: QaWorkspaceContext;
    eventId: string;
    revision: QaRequiredSessionPlanRevision;
    classificationKey: string;
    occurredAt: string;
  }>,
) {
  return qaDomainEventDelta(
    buildQaDomainEvent({
      context: input.context,
      eventId: input.eventId,
      eventType: "qa.required-session-plan.published",
      entityType: "qa-required-session-plan",
      entityId: input.revision.id,
      entityVersion: input.revision.version,
      occurredAt: input.occurredAt,
      recordedAt: input.occurredAt,
      dataClassificationKey: input.classificationKey,
      payloadSchemaRef: schema,
      payload: {
        workItemId: input.revision.workItemId,
        planRevisionRef: {
          id: input.revision.id,
          version: input.revision.version,
          contentHash: input.revision.contentHash,
        },
        previousRevisionRef: input.revision.previousRevisionRef,
        reasonCode: input.revision.version === 1 ? "INITIAL" : "REVISION",
        requiredCount: input.revision.requirements.filter(
          ({ resolution }) => resolution === "REQUIRED",
        ).length,
      },
    }),
  );
}

export function readinessAudit(
  action: string,
  reasonCode: string,
  attributes: Readonly<Record<string, unknown>>,
) {
  return buildQaAuditDelta({ action, outcome: "SUCCEEDED", reasonCode, attributes });
}
