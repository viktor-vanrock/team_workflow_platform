import type { DataSource } from "typeorm";

export interface StoredInteractionReceipt {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly connectionId: string;
  readonly transportKind: string;
  readonly transportAttemptKey: string;
  readonly bodyHash: string;
  readonly normalizedEnvelope: unknown;
  readonly resultRef?: string;
}
export class InMemoryExternalInteractionReceiptRepository {
  readonly #values = new Map<string, StoredInteractionReceipt>();
  claim(
    value: StoredInteractionReceipt,
  ): Readonly<{ value: StoredInteractionReceipt; replayed: boolean }> {
    const key = `${value.connectionId}:${value.transportKind}:${value.transportAttemptKey}`;
    const existing = this.#values.get(key);
    if (existing) {
      if (existing.bodyHash !== value.bodyHash)
        throw new Error("INTERACTION_RECEIPT_BODY_CONFLICT");
      return Object.freeze({ value: structuredClone(existing), replayed: true });
    }
    this.#values.set(key, structuredClone(value));
    return Object.freeze({ value: structuredClone(value), replayed: false });
  }
}
export class TypeOrmExternalInteractionReceiptRepository {
  constructor(readonly source: DataSource) {}
  async claim(
    value: StoredInteractionReceipt,
  ): Promise<Readonly<{ value: StoredInteractionReceipt; replayed: boolean }>> {
    return await this.source.transaction(async (manager) => {
      const rows = (await manager.query(
        `WITH inserted AS (
        INSERT INTO external_interaction_receipts(id,workspace_id,project_id,connection_id,transport_kind,transport_attempt_key,external_delivery_id,body_hash,normalized_envelope,state,result_ref,received_at,retain_until)
        VALUES($1,$2,$3,$4,$5,$6,NULL,$7,$8,'ACCEPTED',$9,clock_timestamp(),clock_timestamp()+interval '24 hours')
        ON CONFLICT(connection_id,transport_kind,transport_attempt_key) DO NOTHING RETURNING *,true AS inserted)
        SELECT *,inserted FROM inserted UNION ALL
        SELECT *,false AS inserted FROM external_interaction_receipts WHERE connection_id=$4 AND transport_kind=$5 AND transport_attempt_key=$6 AND NOT EXISTS(SELECT 1 FROM inserted) LIMIT 1`,
        [
          value.id,
          value.workspaceId,
          value.projectId,
          value.connectionId,
          value.transportKind,
          value.transportAttemptKey,
          value.bodyHash,
          JSON.stringify(value.normalizedEnvelope),
          value.resultRef ?? null,
        ],
      )) as readonly Readonly<Record<string, unknown>>[];
      const row = rows[0];
      if (!row) throw new Error("INTERACTION_RECEIPT_CLAIM_FAILED");
      if (String(row.body_hash) !== value.bodyHash)
        throw new Error("INTERACTION_RECEIPT_BODY_CONFLICT");
      const normalizedEnvelope: unknown =
        typeof row.normalized_envelope === "string"
          ? (JSON.parse(row.normalized_envelope) as unknown)
          : row.normalized_envelope;
      const stored: StoredInteractionReceipt = Object.freeze({
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        projectId: String(row.project_id),
        connectionId: String(row.connection_id),
        transportKind: String(row.transport_kind),
        transportAttemptKey: String(row.transport_attempt_key),
        bodyHash: String(row.body_hash),
        normalizedEnvelope,
        ...(row.result_ref ? { resultRef: String(row.result_ref) } : {}),
      });
      return Object.freeze({ value: stored, replayed: row.inserted !== true });
    });
  }
}
