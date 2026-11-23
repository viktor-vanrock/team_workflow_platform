import type {
  PackAuditDelta,
  PackDomainEventDelta,
  SchemaReference,
} from "@awp/platform-contracts";

import type {
  QaAutomationAttemptRecord,
  QaAutomationAttemptResult,
  QaAutomationAttemptStatusRevision,
} from "../domain/automation-attempt.ts";
import {
  assertQaVerifiedHuman,
  type QaActor,
  type QaContentHash,
  QaDomainError,
  qaScopeFromContext,
  type QaWorkspaceContext,
} from "../domain/primitives.ts";
import { qaAdditiveEventTypes, type QaEventType, qaEventTypes } from "../manifest.ts";
import type { QaAutomationRetryDecision } from "./automation-retry-policy.ts";
import {
  type QaQueueFactChangedRef,
  type QaQueueFactKind,
  sortQaQueueFactRefs,
} from "./queue-facts.ts";

export interface QaSerializedActor {
  readonly type: string;
  readonly principalId: string;
  readonly issuer?: string;
  readonly subject?: string;
  readonly serviceKey?: string;
}

export interface QaDomainEventEnvelope<TPayload = unknown> {
  readonly envelopeVersion: 1;
  readonly eventId: string;
  readonly eventType: QaEventType;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly producer: "competency-qa";
  readonly producerVersion: "1.0.0";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly entityVersion: number;
  readonly correlationId: string;
  readonly causationId: string;
  readonly actor: QaSerializedActor;
  readonly dataClassificationKey: string;
  readonly payloadVersion: 1;
  readonly payloadSchemaRef: SchemaReference;
  readonly payload: TPayload;
}

export interface BuildQaDomainEventInput<TPayload> {
  readonly context: QaWorkspaceContext;
  readonly eventId: string;
  readonly eventType: QaEventType;
  readonly entityType: string;
  readonly entityId: string;
  readonly entityVersion: number;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly dataClassificationKey: string;
  readonly payloadSchemaRef: SchemaReference;
  readonly payload: TPayload;
}

function serializeActor(actor: QaActor): QaSerializedActor {
  if (actor.kind === "HUMAN") {
    const human = assertQaVerifiedHuman({
      actor,
      scope: { kind: "WORKSPACE", workspaceId: "actor-validation" },
      correlationId: "actor-validation",
      causationId: "actor-validation",
    });
    return Object.freeze({
      type: "HUMAN",
      principalId: human.principalId,
      issuer: human.issuer,
      subject: human.subject,
    });
  }
  if (actor.kind === "SERVICE") {
    const serviceKey = (actor as Readonly<{ serviceKey?: unknown }>).serviceKey;
    if (typeof serviceKey !== "string" || serviceKey.length === 0) {
      throw new QaDomainError("QA_EVENT_ACTOR_INVALID");
    }
    return Object.freeze({
      type: "SERVICE",
      principalId: actor.principalId,
      serviceKey,
    });
  }
  throw new QaDomainError("QA_EVENT_ACTOR_INVALID");
}

export function buildQaDomainEvent<TPayload>(
  input: BuildQaDomainEventInput<TPayload>,
): QaDomainEventEnvelope<TPayload> {
  if (!new Set<string>([...qaEventTypes, ...qaAdditiveEventTypes]).has(input.eventType))
    throw new QaDomainError("QA_EVENT_TYPE_UNDECLARED");
  if (
    input.entityVersion < 1 ||
    input.eventId.length === 0 ||
    input.entityType.length === 0 ||
    input.entityId.length === 0 ||
    input.dataClassificationKey.length === 0 ||
    input.payloadSchemaRef.version !== 1 ||
    !(
      input.payloadSchemaRef.id.startsWith("urn:awp:schemas:qa:event-payload:") ||
      input.payloadSchemaRef.id.startsWith("urn:awp:schemas:004:events:") ||
      input.payloadSchemaRef.id.startsWith("urn:awp:schemas:005:events:") ||
      input.payloadSchemaRef.id.startsWith("urn:awp:schemas:006:")
    )
  ) {
    throw new QaDomainError("QA_EVENT_ENVELOPE_INVALID");
  }
  const occurredAt = Date.parse(input.occurredAt);
  const recordedAt = Date.parse(input.recordedAt);
  if (Number.isNaN(occurredAt) || Number.isNaN(recordedAt) || recordedAt < occurredAt) {
    throw new QaDomainError("QA_EVENT_TIME_INVALID");
  }
  const scope = qaScopeFromContext(input.context);
  return Object.freeze({
    envelopeVersion: 1,
    eventId: input.eventId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    recordedAt: input.recordedAt,
    producer: "competency-qa",
    producerVersion: "1.0.0",
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    entityType: input.entityType,
    entityId: input.entityId,
    entityVersion: input.entityVersion,
    correlationId: input.context.correlationId,
    causationId: input.context.causationId,
    actor: serializeActor(input.context.actor),
    dataClassificationKey: input.dataClassificationKey,
    payloadVersion: 1,
    payloadSchemaRef: input.payloadSchemaRef,
    payload: structuredClone(input.payload),
  });
}

export function qaDomainEventDelta<TPayload>(
  envelope: QaDomainEventEnvelope<TPayload>,
): PackDomainEventDelta {
  return Object.freeze({
    eventType: envelope.eventType,
    entityId: envelope.entityId,
    payload: envelope,
  });
}

const deniedAuditKey =
  /authorization|cookie|secret|token|password|payload|body|locator|object[_-]?key|credential|evidence|prompt|foreign|cross[_-]?project|other[_-]?project/iu;
const deniedAuditValue =
  /(?:bearer\s+[a-z0-9._~+/-]+=*|secretref:\/\/|s3:\/\/|https?:\/\/[^\s/@]+:[^\s/@]+@|eyJ[a-z0-9_-]{12,}\.)/iu;
const allowedAuditKey =
  /^(?:operation|reason|latencyMs|[A-Za-z][A-Za-z0-9]*(?:Id|Ref|Hash|Count|Version|Code|State|Status|Outcome|Kind|Type))$/u;

export function redactQaAuditAttributes(
  input: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string | number | boolean | null>> {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (deniedAuditKey.test(key) || !allowedAuditKey.test(key)) continue;
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      output[key] = value;
    } else if (typeof value === "string" && !deniedAuditValue.test(value)) {
      output[key] = value;
    }
  }
  return Object.freeze(output);
}

export function buildQaAuditDelta(
  input: Readonly<{
    action: string;
    outcome: PackAuditDelta["outcome"];
    reasonCode: string;
    attributes?: Readonly<Record<string, unknown>>;
    classificationHash?: QaContentHash;
  }>,
): PackAuditDelta {
  if (input.action.length === 0 || input.reasonCode.length === 0) {
    throw new QaDomainError("QA_AUDIT_DELTA_INVALID");
  }
  return Object.freeze({
    action: input.action,
    outcome: input.outcome,
    reasonCode: input.reasonCode,
    attributes: redactQaAuditAttributes({
      ...(input.attributes ?? {}),
      ...(input.classificationHash === undefined
        ? {}
        : { classificationHash: input.classificationHash }),
    }),
  });
}

const automationAttemptEventSchema = Object.freeze({
  id: "urn:awp:schemas:005:events:automation-attempt-created:v1",
  version: 1,
  digest: "sha256:07101908cc07a63d2194ea3f3df52cccb4738835ea0b4fd2ad41b7a8dafb1faa",
} satisfies SchemaReference);

export function buildQaAutomationAttemptCreatedEvent(
  input: Readonly<{
    context: QaWorkspaceContext;
    eventId: string;
    attempt: QaAutomationAttemptRecord;
  }>,
): QaDomainEventEnvelope<Readonly<Record<string, unknown>>> {
  return buildQaDomainEvent({
    context: input.context,
    eventId: input.eventId,
    eventType: "qa.automation-attempt.created",
    entityType: "automation-attempt",
    entityId: input.attempt.automationAttemptId,
    entityVersion: input.attempt.resourceVersion,
    occurredAt: input.attempt.createdAt,
    recordedAt: input.attempt.createdAt,
    dataClassificationKey: "INTERNAL",
    payloadSchemaRef: automationAttemptEventSchema,
    payload: Object.freeze({
      automationAttemptId: input.attempt.automationAttemptId,
      testSessionId: input.attempt.testSessionId,
      planItemId: input.attempt.planItemId,
      attemptNo: input.attempt.attemptNo,
      reason: input.attempt.reason,
      ...(input.attempt.predecessorAttemptId === undefined
        ? {}
        : { predecessorAttemptId: input.attempt.predecessorAttemptId }),
      requestHash: input.attempt.requestHash,
      targetSnapshotHash: input.attempt.targetSnapshotHash,
      configurationPinSetHash: input.attempt.configurationPinSetHash,
    }),
  });
}

const automationRetryDecidedEventSchema = Object.freeze({
  id: "urn:awp:schemas:005:events:automation-retry-decided:v1",
  version: 1,
  digest: "sha256:8873dbc4628de33dd5c5e4a6dff3a8fdeb87a3cde27d0623cb8981c41aea2f0b",
} satisfies SchemaReference);

export function buildQaAutomationRetryDecidedEvent(
  input: Readonly<{
    context: QaWorkspaceContext;
    eventId: string;
    decision: QaAutomationRetryDecision;
  }>,
): QaDomainEventEnvelope<Readonly<Record<string, unknown>>> {
  return buildQaDomainEvent({
    context: input.context,
    eventId: input.eventId,
    eventType: "qa.automation-retry.decided",
    entityType: "automation-attempt",
    entityId: input.decision.automationAttemptId,
    entityVersion: 1,
    occurredAt: input.decision.decidedAt,
    recordedAt: input.decision.decidedAt,
    dataClassificationKey: "INTERNAL",
    payloadSchemaRef: automationRetryDecidedEventSchema,
    payload: Object.freeze({
      automationAttemptId: input.decision.automationAttemptId,
      decision: input.decision.decision,
      policyHash: input.decision.policyHash,
      reasonCode: input.decision.reasonCode,
      ...(input.decision.successorAttemptId === undefined
        ? {}
        : { successorAttemptId: input.decision.successorAttemptId }),
      decidedAt: input.decision.decidedAt,
    }),
  });
}

const automationAttemptStatusObservedEventSchema = Object.freeze({
  id: "urn:awp:schemas:005:events:automation-attempt-status-observed:v1",
  version: 1,
  digest: "sha256:f239157329bf9ec812c482866c1e0276c3bbab58826b58a78cacc829a304ba82",
} satisfies SchemaReference);

export function buildQaAutomationAttemptStatusObservedEvent(
  input: Readonly<{
    context: QaWorkspaceContext;
    eventId: string;
    attempt: QaAutomationAttemptRecord;
    revision: QaAutomationAttemptStatusRevision;
  }>,
): QaDomainEventEnvelope<Readonly<Record<string, unknown>>> {
  return buildQaDomainEvent({
    context: input.context,
    eventId: input.eventId,
    eventType: "qa.automation-attempt.status-observed",
    entityType: "automation-attempt",
    entityId: input.attempt.automationAttemptId,
    entityVersion: input.attempt.resourceVersion,
    occurredAt: input.revision.observedAt,
    recordedAt: input.revision.recordedAt,
    dataClassificationKey: "INTERNAL",
    payloadSchemaRef: automationAttemptStatusObservedEventSchema,
    payload: Object.freeze({
      automationAttemptId: input.attempt.automationAttemptId,
      revisionNo: input.revision.revisionNo,
      status: input.revision.status,
      source: input.revision.source,
      ...(input.revision.externalPipelineId === undefined
        ? {}
        : { externalPipelineId: input.revision.externalPipelineId }),
      externalJobIds: input.revision.externalJobIds,
      observationHash: input.revision.observationHash,
      observedAt: input.revision.observedAt,
    }),
  });
}

const automationAttemptCompletedEventSchema = Object.freeze({
  id: "urn:awp:schemas:005:events:automation-attempt-completed:v1",
  version: 1,
  digest: "sha256:2a451d898d26a0c07e7de186531cd76623e2727591977d9ce81ab60c873d6d5c",
} satisfies SchemaReference);

export function buildQaAutomationAttemptCompletedEvent(
  input: Readonly<{
    context: QaWorkspaceContext;
    eventId: string;
    attempt: QaAutomationAttemptRecord;
    result: QaAutomationAttemptResult;
  }>,
): QaDomainEventEnvelope<Readonly<Record<string, unknown>>> {
  return buildQaDomainEvent({
    context: input.context,
    eventId: input.eventId,
    eventType: "qa.automation-attempt.completed",
    entityType: "automation-attempt",
    entityId: input.attempt.automationAttemptId,
    entityVersion: input.attempt.resourceVersion,
    occurredAt: input.result.terminalAt,
    recordedAt: input.result.recordedAt,
    dataClassificationKey: "INTERNAL",
    payloadSchemaRef: automationAttemptCompletedEventSchema,
    payload: Object.freeze({
      automationAttemptId: input.attempt.automationAttemptId,
      testSessionId: input.attempt.testSessionId,
      outcome: input.result.outcome,
      ...(input.result.infrastructureCode === undefined
        ? {}
        : { infrastructureCode: input.result.infrastructureCode }),
      resultHash: input.result.contentHash,
      artifactDescriptorSetHash: input.result.artifactDescriptorSetHash,
      terminalAt: input.result.terminalAt,
    }),
  });
}

const automationArtifactRegisteredEventSchema = Object.freeze({
  id: "urn:awp:schemas:005:events:automation-artifact-registered:v1",
  version: 1,
  digest: "sha256:94f6ac23995addb0d3fa5dd669382e1ae0dc9507c62580d04f6d86905d9f8dc6",
} satisfies SchemaReference);

export function buildQaAutomationArtifactRegisteredEvent(
  input: Readonly<{
    context: QaWorkspaceContext;
    eventId: string;
    automationAttemptId: string;
    artifactReferenceId: string;
    checksum: QaContentHash;
    classification: string;
    expiresAt: string;
    registeredAt: string;
  }>,
): QaDomainEventEnvelope<Readonly<Record<string, unknown>>> {
  return buildQaDomainEvent({
    context: input.context,
    eventId: input.eventId,
    eventType: "qa.automation-artifact.registered",
    entityType: "artifact-reference",
    entityId: input.artifactReferenceId,
    entityVersion: 1,
    occurredAt: input.registeredAt,
    recordedAt: input.registeredAt,
    dataClassificationKey: input.classification,
    payloadSchemaRef: automationArtifactRegisteredEventSchema,
    payload: Object.freeze({
      automationAttemptId: input.automationAttemptId,
      artifactReferenceId: input.artifactReferenceId,
      checksum: input.checksum,
      classification: input.classification,
      expiresAt: input.expiresAt,
      registeredAt: input.registeredAt,
    }),
  });
}

const automationQuarantineChangedEventSchema = Object.freeze({
  id: "urn:awp:schemas:005:events:automation-quarantine-changed:v1",
  version: 1,
  digest: "sha256:cac8ae1b67aac952be1123b4cf1c331ab469c2e9aa0099742ecfaaffa09717b4",
} satisfies SchemaReference);

export function buildQaAutomationQuarantineChangedEvent(
  input: Readonly<{
    context: QaWorkspaceContext;
    eventId: string;
    quarantineId: string;
    quarantineRevisionId: string;
    revisionNo: number;
    previousRevisionId?: string;
    previousRevisionHash?: QaContentHash;
    subject: Readonly<Record<string, unknown>>;
    action: "ACTIVATE" | "LIFT";
    effectiveState: "ACTIVE" | "INACTIVE";
    ownerPrincipalId: string;
    reason: string;
    evidenceRefs: readonly string[];
    evidenceSetHash: QaContentHash;
    policyRef: string;
    policyHash: QaContentHash;
    actorPrincipalId: string;
    authorizationBasisHash: QaContentHash;
    expiresAt?: string;
    effectiveAt: string;
    contentHash: QaContentHash;
  }>,
): QaDomainEventEnvelope<Readonly<Record<string, unknown>>> {
  return buildQaDomainEvent({
    context: input.context,
    eventId: input.eventId,
    eventType: "qa.automation-quarantine.changed",
    entityType: "automation-quarantine",
    entityId: input.quarantineId,
    entityVersion: input.revisionNo,
    occurredAt: input.effectiveAt,
    recordedAt: input.effectiveAt,
    dataClassificationKey: "INTERNAL",
    payloadSchemaRef: automationQuarantineChangedEventSchema,
    payload: Object.freeze({
      quarantineId: input.quarantineId,
      quarantineRevisionId: input.quarantineRevisionId,
      revisionNo: input.revisionNo,
      ...(input.previousRevisionId === undefined
        ? {}
        : { previousRevisionId: input.previousRevisionId }),
      ...(input.previousRevisionHash === undefined
        ? {}
        : { previousRevisionHash: input.previousRevisionHash }),
      subject: input.subject,
      action: input.action,
      effectiveState: input.effectiveState,
      ownerPrincipalId: input.ownerPrincipalId,
      reason: input.reason,
      evidenceRefs: input.evidenceRefs,
      evidenceSetHash: input.evidenceSetHash,
      policyRef: input.policyRef,
      policyHash: input.policyHash,
      actorPrincipalId: input.actorPrincipalId,
      authorizationBasisHash: input.authorizationBasisHash,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      effectiveAt: input.effectiveAt,
      contentHash: input.contentHash,
    }),
  });
}

export interface QaQueueFactsChangedPayload {
  readonly schemaVersion: "qa-queue-facts-changed@1.0.0";
  readonly invalidationId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly changedFactKinds: readonly QaQueueFactKind[];
  readonly changedFactRefs: readonly QaQueueFactChangedRef[];
  readonly occurredAt: string;
  readonly semanticHash: QaContentHash;
}

export const qaQueueFactsChangedSchema = Object.freeze({
  id: "urn:awp:schemas:006:qa-queue-facts-changed:v1",
  version: 1,
  digest: "sha256:73db51fe616e5c5e332dfd50dafa1442823ff3c5f7638991e68994c51cdfb0ca",
} satisfies SchemaReference);

export function buildQaQueueFactsChangedEvent(
  input: Readonly<{
    context: QaWorkspaceContext;
    eventId: string;
    headId: string;
    revisionNumber: number;
    dataClassificationKey: string;
    payload: QaQueueFactsChangedPayload;
  }>,
): QaDomainEventEnvelope<QaQueueFactsChangedPayload> {
  const scope = qaScopeFromContext(input.context);
  if (
    input.payload.workspaceId !== scope.workspaceId ||
    input.payload.projectId !== scope.projectId ||
    input.payload.changedFactRefs.length === 0
  )
    throw new QaDomainError("QA_QUEUE_FACT_INVALIDATION_SCOPE_INVALID");
  const changedFactRefs = sortQaQueueFactRefs(input.payload.changedFactRefs);
  const changedFactKinds = Object.freeze(
    [...new Set(changedFactRefs.map(({ factKind }) => factKind))].sort(),
  );
  if (changedFactKinds.join("\n") !== [...input.payload.changedFactKinds].sort().join("\n")) {
    throw new QaDomainError("QA_QUEUE_FACT_INVALIDATION_KIND_MISMATCH");
  }
  return buildQaDomainEvent({
    context: input.context,
    eventId: input.eventId,
    eventType: "qa.queue-facts.changed",
    entityType: "qa-queue-fact-head",
    entityId: input.headId,
    entityVersion: input.revisionNumber,
    occurredAt: input.payload.occurredAt,
    recordedAt: input.payload.occurredAt,
    dataClassificationKey: input.dataClassificationKey,
    payloadSchemaRef: qaQueueFactsChangedSchema,
    payload: Object.freeze({ ...input.payload, changedFactKinds, changedFactRefs }),
  });
}
