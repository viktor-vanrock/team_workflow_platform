import type { DataSource } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import type { EventEnvelope } from "@awp/platform-core";

type Row = Record<string, unknown>;
type SerializedEnvelope = Omit<EventEnvelope, "occurredAt" | "recordedAt"> &
  Readonly<{ occurredAt: string; recordedAt: string }>;
function parseEnvelope(value: unknown): EventEnvelope {
  const parsed = (typeof value === "string" ? JSON.parse(value) : value) as SerializedEnvelope;
  return {
    ...parsed,
    occurredAt: new Date(parsed.occurredAt),
    recordedAt: new Date(parsed.recordedAt),
  };
}
export class TypeOrmEventOutboxRepository {
  constructor(private readonly source: DataSource) {}
  async append(envelope: EventEnvelope): Promise<void> {
    await this.source.query(
      "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'READY',$7)",
      [
        envelope.eventId,
        envelope.workspaceId,
        envelope.projectId,
        envelope.eventType,
        JSON.stringify(envelope),
        sha256(envelope as unknown as JsonValue),
        envelope.recordedAt,
      ],
    );
  }
  async ready(): Promise<readonly EventEnvelope[]> {
    const rows = (await this.source.query(
      "SELECT envelope FROM event_outbox WHERE state='READY' ORDER BY created_at,id",
    )) as Row[];
    return rows.map((row) => parseEnvelope(row.envelope));
  }
  async acknowledge(id: string): Promise<void> {
    await this.source.query("UPDATE event_outbox SET state='ACKNOWLEDGED' WHERE id=$1", [id]);
  }
}
