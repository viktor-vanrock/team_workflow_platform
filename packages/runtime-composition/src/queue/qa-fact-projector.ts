import {
  type LegacyAutomatedSessionReadyTrustedRow,
  replayLegacyAutomatedSessionReadyTrustedRow,
} from "@awp/competency-qa/node";
import { type EventEnvelope, InMemoryEventInbox, processBoundEvent } from "@awp/platform-core";

export interface QaFactProjectorInput {
  readonly transportRecordId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly payload: unknown;
  readonly validationKind: "CANONICAL_ENVELOPE" | "LEGACY_PAYLOAD_ONLY";
}

/** Provider-neutral local projector entry point shared by canonical and legacy replay. */
export class BoundQaFactProjector {
  readonly inbox = new InMemoryEventInbox();
  readonly seenTransportIds = new Map<string, "CANONICAL_ENVELOPE" | "LEGACY_PAYLOAD_ONLY">();

  constructor(private readonly project: (input: QaFactProjectorInput) => Promise<void>) {}

  async consumeCanonical(
    event: EventEnvelope,
  ): Promise<"PROCESSED" | "DUPLICATE" | "STALE" | "GAP_REQUIRES_RECONCILIATION"> {
    if (this.seenTransportIds.get(event.eventId) === "LEGACY_PAYLOAD_ONLY")
      throw new Error("QA_FACT_TRANSPORT_ID_COLLISION");
    const outcome = await processBoundEvent(this.inbox, "qa-fact-projector", event);
    if (outcome.status === "PROCESSED") {
      await this.project(
        Object.freeze({
          transportRecordId: event.eventId,
          workspaceId: event.workspaceId,
          projectId: event.projectId,
          eventType: event.eventType,
          occurredAt:
            event.occurredAt instanceof Date
              ? event.occurredAt.toISOString()
              : String(event.occurredAt),
          payload: event.payload,
          validationKind: "CANONICAL_ENVELOPE",
        }),
      );
      this.seenTransportIds.set(event.eventId, "CANONICAL_ENVELOPE");
    }
    return outcome.status;
  }

  async consumeLegacyReady(
    row: LegacyAutomatedSessionReadyTrustedRow,
  ): Promise<"PROCESSED" | "DUPLICATE"> {
    const seen = this.seenTransportIds.get(row.id);
    if (seen === "CANONICAL_ENVELOPE") throw new Error("QA_FACT_TRANSPORT_ID_COLLISION");
    if (seen === "LEGACY_PAYLOAD_ONLY") return "DUPLICATE";
    await replayLegacyAutomatedSessionReadyTrustedRow(row, async (legacy) => {
      await this.project(
        Object.freeze({
          transportRecordId: legacy.transportRecordId,
          workspaceId: legacy.trustedWorkspaceId,
          projectId: legacy.trustedProjectId,
          eventType: legacy.eventType,
          occurredAt: legacy.createdAt,
          payload: legacy.payload,
          validationKind: legacy.validationKind,
        }),
      );
    });
    this.seenTransportIds.set(row.id, "LEGACY_PAYLOAD_ONLY");
    return "PROCESSED";
  }
}
