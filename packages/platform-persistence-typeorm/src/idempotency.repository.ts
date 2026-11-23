import type { DataSource, EntityManager } from "typeorm";

import type { ClientRequestIdempotencyRecord, ClientRequestIdentity } from "@awp/platform-core";

type Row = Record<string, unknown>;
const resultRef = (value: unknown): Readonly<{ commandId: string }> =>
  typeof value === "string"
    ? (JSON.parse(value) as Readonly<{ commandId: string }>)
    : (value as Readonly<{ commandId: string }>);
export class TypeOrmIdempotencyRepository {
  constructor(private readonly source: DataSource) {}
  async find(
    identity: ClientRequestIdentity,
    manager: Pick<EntityManager, "query"> = this.source.manager,
  ): Promise<ClientRequestIdempotencyRecord | undefined> {
    const rows = (await manager.query(
      "SELECT * FROM client_request_idempotency WHERE workspace_id=$1 AND project_id=$2 AND actor_id=$3 AND operation=$4 AND client_key=$5",
      [
        identity.workspaceId,
        identity.projectId,
        identity.actorId,
        identity.operation,
        identity.clientKey,
      ],
    )) as Row[];
    const row = rows[0];
    return row
      ? {
          ...identity,
          requestHash: String(row.request_hash),
          commandId: resultRef(row.result_ref).commandId,
          createdAt: new Date(String(row.created_at)),
        }
      : undefined;
  }
  async claim(
    record: ClientRequestIdempotencyRecord,
    manager: Pick<EntityManager, "query"> = this.source.manager,
  ): Promise<void> {
    await manager.query(
      "INSERT INTO client_request_idempotency(workspace_id,project_id,actor_id,operation,client_key,request_hash,result_ref,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        record.workspaceId,
        record.projectId,
        record.actorId,
        record.operation,
        record.clientKey,
        record.requestHash,
        JSON.stringify({ commandId: record.commandId }),
        record.createdAt,
      ],
    );
  }
}
