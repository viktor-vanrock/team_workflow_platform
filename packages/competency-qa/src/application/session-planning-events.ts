import type { QaWorkspaceContext } from "../domain/primitives.ts";
import type { QaTestSession } from "../domain/test-session.ts";
import { qaSchemaReferences } from "../manifest.ts";
import { buildQaAuditDelta, buildQaDomainEvent, qaDomainEventDelta } from "./domain-events.ts";

const schema = Object.freeze({
  id: "urn:awp:schemas:qa:event-payload:test-session:v1",
  version: 1,
  digest: qaSchemaReferences.events.digest,
});
export function qaSessionStateChangedEvent(
  input: Readonly<{
    context: QaWorkspaceContext;
    eventId: string;
    previousState: string | null;
    session: QaTestSession;
    occurredAt: string;
    classificationKey: string;
  }>,
) {
  if (
    (input.session.state === "BLOCKED" || input.session.state === "CANCELLED") &&
    !input.session.stateReason
  )
    throw new Error("QA_SESSION_REASON_REQUIRED");
  return qaDomainEventDelta(
    buildQaDomainEvent({
      context: input.context,
      eventId: input.eventId,
      eventType: "qa.test-session.state-changed",
      entityType: "qa-test-session",
      entityId: input.session.id,
      entityVersion: input.session.resourceVersion,
      occurredAt: input.occurredAt,
      recordedAt: input.occurredAt,
      dataClassificationKey: input.classificationKey,
      payloadSchemaRef: schema,
      payload: {
        workItemId: input.session.workItemId,
        previousState: input.previousState,
        state: input.session.state,
        structureRevision: input.session.structureRevision,
        structureHash: input.session.structureHash,
        readyAgainstStructureHash: input.session.readyAgainstStructureHash,
        targetHash: input.session.targetSnapshot.contentHash,
        scopeHash: input.session.scopeSnapshot.contentHash,
        blockedFrom: input.session.blockedFrom ?? null,
        cancelledFrom: input.session.cancelledFrom ?? null,
        reasonCode:
          input.session.resetReason ??
          (input.session.state === "BLOCKED"
            ? "HUMAN_BLOCKED"
            : input.session.state === "CANCELLED"
              ? "HUMAN_CANCELLED"
              : null),
      },
    }),
  );
}

export function qaSessionPlanningAudit(previous: QaTestSession, next: QaTestSession) {
  const legal = new Set([
    "PLANNED→PLANNED",
    "PLANNED→READY",
    "READY→RUNNING",
    "RUNNING→REVIEW_REQUIRED",
    "PLANNED→BLOCKED",
    "READY→BLOCKED",
    "RUNNING→BLOCKED",
    "REVIEW_REQUIRED→BLOCKED",
    "BLOCKED→READY",
    "BLOCKED→RUNNING",
    "BLOCKED→REVIEW_REQUIRED",
    "PLANNED→CANCELLED",
    "READY→CANCELLED",
    "RUNNING→CANCELLED",
    "BLOCKED→CANCELLED",
    "READY→PLANNED",
  ]);
  const pair = `${previous.state}→${next.state}`;
  if (!legal.has(pair)) throw new Error("QA_SESSION_AUDIT_TRANSITION_INVALID");
  return buildQaAuditDelta({
    action: "qa.session.transition",
    outcome: "SUCCEEDED",
    reasonCode:
      next.resetReason ??
      (next.state === "BLOCKED"
        ? "HUMAN_BLOCKED"
        : next.state === "CANCELLED"
          ? "HUMAN_CANCELLED"
          : "STATE_TRANSITION"),
    attributes: {
      sessionId: next.id,
      workItemId: next.workItemId,
      previousState: previous.state,
      targetState: next.state,
      structureHash: next.structureHash,
      targetHash: next.targetSnapshot.contentHash,
      scopeHash: next.scopeSnapshot.contentHash,
      predecessorStage: next.blockedFrom ?? next.cancelledFrom ?? previous.state,
    },
  });
}

export function qaSessionPlannedAudit(session: QaTestSession) {
  return buildQaAuditDelta({
    action: "qa.session.plan",
    outcome: "SUCCEEDED",
    reasonCode: session.parentSessionId ? "LINKED_REPLACEMENT_PLANNED" : "SESSION_PLANNED",
    attributes: {
      sessionId: session.id,
      workItemId: session.workItemId,
      planRef: session.planRevisionRef.id,
      requirementRef: session.requirementRef.id,
      structureHash: session.structureHash,
      targetHash: session.targetSnapshot.contentHash,
      scopeHash: session.scopeSnapshot.contentHash,
    },
  });
}
