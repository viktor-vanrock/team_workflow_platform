import type { QaCompletionCandidateAggregate } from "../domain/completion.ts";
import type { QaDodAssessment } from "../domain/dod.ts";
import type { QaPostCloseCorrectionMarker } from "../domain/post-close-correction.ts";
import { QaDomainError, type QaWorkspaceContext } from "../domain/primitives.ts";
import type { QaVerdictAggregate } from "../domain/verdict.ts";
import { qaSchemaReferences } from "../manifest.ts";
import { buildQaAuditDelta, buildQaDomainEvent, qaDomainEventDelta } from "./domain-events.ts";

const schema = Object.freeze({
  id: "urn:awp:schemas:qa:event-payload:verdict-completion:v1",
  version: 1,
  digest: qaSchemaReferences.events.digest,
});

interface EventBase {
  readonly context: QaWorkspaceContext;
  readonly eventId: string;
  readonly classificationKey: string;
  readonly occurredAt: string;
}

export function qaVerdictSignedEvent(input: EventBase & Readonly<{ verdict: QaVerdictAggregate }>) {
  const required = input.verdict.effectiveRisk === "ORDINARY" ? 1 : 2;
  if (input.verdict.state !== "SIGNED" || input.verdict.signatures.length !== required) {
    throw new QaDomainError("QA_VERDICT_SIGNATURE_CARDINALITY_INVALID");
  }
  return qaDomainEventDelta(
    buildQaDomainEvent({
      ...input,
      eventType: "qa.verdict.signed",
      entityType: "qa-verdict",
      entityId: input.verdict.verdictId,
      entityVersion: input.verdict.version,
      recordedAt: input.occurredAt,
      dataClassificationKey: input.classificationKey,
      payloadSchemaRef: schema,
      payload: {
        workItemId: input.verdict.workItemId,
        requiredSessionPlanRef: input.verdict.requiredSessionPlanRef,
        verdictId: input.verdict.verdictId,
        version: input.verdict.version,
        verdict: input.verdict.verdict,
        effectiveRisk: input.verdict.effectiveRisk,
        contentHash: input.verdict.contentHash,
        signatureIds: input.verdict.signatures.map(({ signatureId }) => signatureId),
        aggregateSnapshotHash: input.verdict.aggregateSnapshotHash,
      },
    }),
  );
}

export function qaDodAssessedEvent(input: EventBase & Readonly<{ assessment: QaDodAssessment }>) {
  const closes =
    input.assessment.state === "READY_TO_CLOSE" || input.assessment.state === "SATISFIED";
  if (closes && input.assessment.inventory.requiredSessionPlanRef === undefined) {
    throw new QaDomainError("QA_DOD_PLAN_REF_REQUIRED");
  }
  return qaDomainEventDelta(
    buildQaDomainEvent({
      ...input,
      eventType: input.assessment.state === "SATISFIED" ? "qa.dod.satisfied" : "qa.dod.assessed",
      entityType: "qa-dod-assessment",
      entityId: input.assessment.assessmentId,
      entityVersion: input.assessment.version,
      recordedAt: input.occurredAt,
      dataClassificationKey: input.classificationKey,
      payloadSchemaRef: schema,
      payload: {
        workItemId: input.assessment.workItemId,
        state: input.assessment.state,
        assessmentRef: {
          id: input.assessment.assessmentId,
          version: input.assessment.version,
          contentHash: input.assessment.contentHash,
        },
        requiredSessionPlanRef: input.assessment.inventory.requiredSessionPlanRef,
        verdictRef: input.assessment.inventory.verdictRef,
        blockerCodes: input.assessment.blockerCodes,
        aggregateInputHash: input.assessment.aggregateInputHash,
        completionConfirmationRef: input.assessment.completionConfirmationRef,
      },
    }),
  );
}

export function qaPostCloseCorrectionRecordedEvent(
  input: EventBase & Readonly<{ workItemId: string; marker: QaPostCloseCorrectionMarker }>,
) {
  return qaDomainEventDelta(
    buildQaDomainEvent({
      ...input,
      eventType: "qa.post-close-correction.recorded",
      entityType: "qa-post-close-correction",
      entityId: input.marker.markerId,
      entityVersion: input.marker.clericalRevisionRef.version,
      recordedAt: input.occurredAt,
      dataClassificationKey: input.classificationKey,
      payloadSchemaRef: schema,
      payload: {
        workItemId: input.workItemId,
        manifestId: input.marker.manifestId,
        previousRevisionRef: input.marker.previousRevisionRef,
        clericalRevisionRef: input.marker.clericalRevisionRef,
        annotations: input.marker.annotations,
        requester: { type: "HUMAN", principalId: input.marker.actor.principalId },
        permissionKey: "qa.evidence.post-close-correction.record",
        authorizationBasisHash: input.marker.authorizationBasisHash,
      },
    }),
  );
}

export function verdictCompletionAudit(
  input: Readonly<{
    action: string;
    reasonCode: string;
    verdict?: QaVerdictAggregate;
    dod?: QaDodAssessment;
    candidate?: QaCompletionCandidateAggregate;
    marker?: QaPostCloseCorrectionMarker;
  }>,
) {
  return buildQaAuditDelta({
    action: input.action,
    outcome: "SUCCEEDED",
    reasonCode: input.reasonCode,
    attributes: {
      verdictHash: input.verdict?.contentHash,
      signatureCount: input.verdict?.signatures.length,
      dodHash: input.dod?.contentHash,
      candidateHash: input.candidate?.contentHash,
      resultHash: input.candidate?.summary.contentHash,
      markerRef: input.marker?.markerId,
      latestRef: input.marker?.clericalRevisionRef.id,
      adjudicativeRef: input.marker?.previousRevisionRef.id,
    },
  });
}
