import type { DataSource } from "typeorm";

type Row = Record<string, unknown>;
export class TypeOrmReconciliationCursorRepository {
  constructor(private readonly source: DataSource) {}
  async claim(
    id: string,
    owner: string,
    now: Date,
    leaseMs: number,
  ): Promise<
    Readonly<{ token: number; watermark: Readonly<{ updatedAt: string; externalKey: string }> }>
  > {
    return await this.source.transaction(async (manager) => {
      const rows = (await manager.query(
        "SELECT * FROM reconciliation_cursors WHERE id=$1 FOR UPDATE",
        [id],
      )) as Row[];
      const row = rows[0];
      if (!row) throw new Error("RECONCILIATION_CURSOR_NOT_FOUND");
      if (row.lease_until && new Date(String(row.lease_until)) > now && row.lease_owner !== owner)
        throw new Error("RECONCILIATION_CURSOR_LEASED");
      const token = Number(row.lease_token) + 1;
      await manager.query(
        "UPDATE reconciliation_cursors SET lease_owner=$2,lease_token=$3,lease_until=$4,resource_version=resource_version+1 WHERE id=$1",
        [id, owner, token, new Date(now.getTime() + leaseMs)],
      );
      return Object.freeze({
        token,
        watermark: Object.freeze({
          updatedAt: new Date(String(row.watermark_updated_at)).toISOString(),
          externalKey: String(row.watermark_external_key),
        }),
      });
    });
  }
  async commit(
    id: string,
    token: number,
    complete: boolean,
    watermark: Readonly<{ updatedAt: string; externalKey: string }>,
  ): Promise<void> {
    const rows = (await this.source.query(
      complete
        ? "UPDATE reconciliation_cursors SET watermark_updated_at=$3,watermark_external_key=$4,last_success_at=clock_timestamp(),lease_owner=NULL,lease_until=NULL,resource_version=resource_version+1 WHERE id=$1 AND lease_token=$2 RETURNING id"
        : "UPDATE reconciliation_cursors SET lease_owner=NULL,lease_until=NULL,resource_version=resource_version+1 WHERE id=$1 AND lease_token=$2 RETURNING id",
      complete ? [id, token, watermark.updatedAt, watermark.externalKey] : [id, token],
    )) as Row[];
    if (rows.length !== 1) throw new Error("RECONCILIATION_CURSOR_FENCE_REJECTED");
  }
}
