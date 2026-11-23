import { type JsonValue, sha256 } from "@awp/platform-contracts";

import { type EventEnvelope, validateEventPayloadBinding } from "./event-envelope.ts";

export interface ProcessableEvent {
  readonly eventId: string;
  readonly entityId: string;
  readonly entityVersion: number;
}
export class InMemoryEventInbox {
  readonly messages = new Map<string, string>();
  readonly versions = new Map<string, number>();
  readonly reconciliation: ProcessableEvent[] = [];
  readonly quarantine = new Map<
    string,
    Readonly<{ consumerKey: string; reason: string; event: unknown }>
  >();
}
export async function processEvent(
  inbox: InMemoryEventInbox,
  consumerKey: string,
  event: ProcessableEvent,
): Promise<
  Readonly<{ status: "PROCESSED" | "DUPLICATE" | "STALE" | "GAP_REQUIRES_RECONCILIATION" }>
> {
  const key = `${consumerKey}\0${event.eventId}`;
  const hash = sha256(JSON.parse(JSON.stringify(event)) as JsonValue);
  const existing = inbox.messages.get(key);
  if (existing) {
    if (existing !== hash) throw new Error("CONSUMER_MESSAGE_HASH_CONFLICT");
    return { status: "DUPLICATE" };
  }
  const versionKey = `${consumerKey}\0${event.entityId}`;
  const current = inbox.versions.get(versionKey) ?? 0;
  inbox.messages.set(key, hash);
  if (event.entityVersion > current + 1) {
    inbox.reconciliation.push(structuredClone(event));
    return { status: "GAP_REQUIRES_RECONCILIATION" };
  }
  if (event.entityVersion <= current) return { status: "STALE" };
  inbox.versions.set(versionKey, event.entityVersion);
  return { status: "PROCESSED" };
}

export async function processBoundEvent(
  inbox: InMemoryEventInbox,
  consumerKey: string,
  event: EventEnvelope,
): Promise<Awaited<ReturnType<typeof processEvent>>> {
  try {
    validateEventPayloadBinding(event);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "EVENT_BINDING_INVALID";
    const key = `${consumerKey}\0${event.eventId || "missing-event-id"}`;
    inbox.quarantine.set(
      key,
      Object.freeze({ consumerKey, reason, event: structuredClone(event) }),
    );
    throw error;
  }
  return processEvent(inbox, consumerKey, event);
}

const mutuallyExclusiveEventPairs = Object.freeze([
  Object.freeze(["queue.projection.updated", "queue.control.changed"] as const),
  Object.freeze(["capacity.admission.decided", "capacity.over-limit-detected"] as const),
]);

export function validateMutuallyExclusiveEmission(types: readonly string[]): void {
  const emitted = new Set(types);
  for (const [left, right] of mutuallyExclusiveEventPairs) {
    if (emitted.has(left) && emitted.has(right))
      throw new Error(`EVENT_MUTUALLY_EXCLUSIVE:${left}:${right}`);
  }
}
