import type { DataSource } from "typeorm";

type Row = Readonly<{ body_hash: unknown; inserted: unknown }>;

export interface DurableWebhookReceiptInput {
  readonly connectorKey: string;
  readonly deliveryId: string;
  readonly bodyHash: string;
  readonly rawBody: Uint8Array;
  readonly contentType: string;
  readonly receivedAt: Date;
  readonly verificationResult: string;
  readonly secretKeyVersion?: string;
  readonly retentionUntil: Date;
}

export class TypeOrmWebhookInboxRepository {
  constructor(private readonly source: DataSource) {}

  async record(
    connectorKey: string,
    deliveryId: string,
    bodyHash: string,
    receivedAt: Date,
  ): Promise<"ACCEPTED" | "DUPLICATE"> {
    return await this.recordExact({
      connectorKey,
      deliveryId,
      bodyHash,
      rawBody: new Uint8Array(),
      contentType: "application/json",
      receivedAt,
      verificationResult: "LEGACY_VERIFIED",
      retentionUntil: new Date(receivedAt.getTime() + 86_400_000),
    });
  }

  async recordExact(input: DurableWebhookReceiptInput): Promise<"ACCEPTED" | "DUPLICATE"> {
    return await this.source.transaction(async (manager) => {
      const rows = (await manager.query(
        `WITH inserted AS (
           INSERT INTO webhook_receipts(
             connector_key,delivery_id,body_hash,received_at,raw_body,content_type,
             body_size,verification_result,secret_key_version,retention_until
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT(connector_key,delivery_id) DO NOTHING
           RETURNING body_hash
         )
         SELECT body_hash,true AS inserted FROM inserted
         UNION ALL
         SELECT body_hash,false AS inserted
           FROM webhook_receipts
          WHERE connector_key=$1 AND delivery_id=$2 AND NOT EXISTS(SELECT 1 FROM inserted)
         LIMIT 1`,
        [
          input.connectorKey,
          input.deliveryId,
          input.bodyHash,
          input.receivedAt,
          Buffer.from(input.rawBody),
          input.contentType,
          input.rawBody.byteLength,
          input.verificationResult,
          input.secretKeyVersion ?? null,
          input.retentionUntil,
        ],
      )) as readonly Row[];
      const row = rows[0];
      if (!row || String(row.body_hash) !== input.bodyHash) {
        throw new Error("DELIVERY_HASH_CONFLICT");
      }
      return row.inserted === true ? "ACCEPTED" : "DUPLICATE";
    });
  }
}
