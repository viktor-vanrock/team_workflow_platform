import type { DataSource, EntityManager } from "typeorm";

type Row = Record<string, unknown>;
export class TypeOrmEventConsumerInboxRepository {
  constructor(private readonly source: DataSource) {}
  async claim(
    consumerKey: string,
    messageId: string,
    messageHash: string,
    manager: Pick<EntityManager, "query"> = this.source.manager,
  ): Promise<"CLAIMED" | "DUPLICATE"> {
    const rows = (await manager.query(
      "SELECT message_hash FROM consumer_inbox WHERE consumer_key=$1 AND message_id=$2 FOR UPDATE",
      [consumerKey, messageId],
    )) as Row[];
    if (rows[0]) {
      if (String(rows[0].message_hash) !== messageHash)
        throw new Error("CONSUMER_MESSAGE_HASH_CONFLICT");
      return "DUPLICATE";
    }
    await manager.query(
      "INSERT INTO consumer_inbox(consumer_key,message_id,message_hash,processed_at) VALUES($1,$2,$3,clock_timestamp())",
      [consumerKey, messageId, messageHash],
    );
    return "CLAIMED";
  }
}
