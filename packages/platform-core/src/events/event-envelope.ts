import type { ActorReference, SchemaReference } from "../shared/primitives.ts";

export interface EventEnvelope<T = unknown> {
  readonly envelopeVersion: 1;
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly producer: string;
  readonly producerVersion: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly entityVersion: number;
  readonly correlationId: string;
  readonly causationId: string;
  readonly actor: ActorReference;
  readonly dataClassificationKey: string;
  readonly payloadVersion: number;
  readonly payloadSchemaRef: SchemaReference;
  readonly payload: T;
}

const instant = (value: Date | string): number =>
  value instanceof Date ? value.getTime() : Date.parse(value);

export function validateEventEnvelope(value: EventEnvelope): void {
  const occurredAt = instant(value.occurredAt);
  const recordedAt = instant(value.recordedAt);
  if (
    value.envelopeVersion !== 1 ||
    value.entityVersion < 1 ||
    value.payloadVersion < 1 ||
    !value.eventId ||
    !value.eventType ||
    !value.workspaceId ||
    !value.projectId ||
    !value.entityType ||
    !value.entityId ||
    !Number.isFinite(occurredAt) ||
    !Number.isFinite(recordedAt) ||
    !value.payloadSchemaRef.id ||
    value.payloadSchemaRef.version !== value.payloadVersion ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.payloadSchemaRef.digest)
  )
    throw new Error("EVENT_ENVELOPE_INVALID");
  if (recordedAt < occurredAt) throw new Error("EVENT_RECORDED_BEFORE_OCCURRED");
}

const entityIdFields = Object.freeze([
  "entityId",
  "queueEntryId",
  "sessionId",
  "invalidationId",
  "decisionId",
  "slaClockId",
  "capacityScopeId",
] as const);
const entityVersionFields = Object.freeze(["entityVersion", "revision", "revisionNumber"] as const);

function assertEqualDuplicate(field: string, envelopeValue: unknown, payloadValue: unknown): void {
  if (payloadValue !== undefined && payloadValue !== envelopeValue) {
    throw new Error(
      `EVENT_${field.replace(/[A-Z]/gu, (letter) => `_${letter}`).toUpperCase()}_MISMATCH`,
    );
  }
}

/**
 * Validates the one canonical envelope before a consumer performs dedupe or
 * sequence advancement. Only fields physically duplicated by a payload bind.
 */
export function validateEventPayloadBinding(value: EventEnvelope): void {
  if (value.payload === null || typeof value.payload !== "object" || Array.isArray(value.payload)) {
    throw new Error("EVENT_PAYLOAD_INVALID");
  }
  const payload = value.payload as Readonly<Record<string, unknown>>;
  assertEqualDuplicate("workspaceId", value.workspaceId, payload.workspaceId);
  assertEqualDuplicate("projectId", value.projectId, payload.projectId);

  const duplicatedEntityId = entityIdFields.find((field) => payload[field] !== undefined);
  if (duplicatedEntityId !== undefined)
    assertEqualDuplicate("entityId", value.entityId, payload[duplicatedEntityId]);
  const duplicatedVersion = entityVersionFields.find((field) => payload[field] !== undefined);
  if (duplicatedVersion !== undefined)
    assertEqualDuplicate("entityVersion", value.entityVersion, payload[duplicatedVersion]);

  const payloadOccurredAt =
    payload.occurredAt ??
    (value.eventType === "queue.projection.updated" ? payload.calculatedAt : undefined);
  if (payloadOccurredAt !== undefined) {
    const envelopeInstant = instant(value.occurredAt);
    const payloadInstant =
      typeof payloadOccurredAt === "string" ? Date.parse(payloadOccurredAt) : Number.NaN;
    if (!Number.isFinite(payloadInstant) || payloadInstant !== envelopeInstant)
      throw new Error("EVENT_OCCURRED_AT_MISMATCH");
  }
  validateEventEnvelope(value);
}
