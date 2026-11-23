import type { DataSource, EntityManager } from "typeorm";

type Row = Record<string, unknown>;
type QueryExecutor = Pick<EntityManager, "query">;

function returned(value: unknown): Row[] {
  if (!Array.isArray(value)) {
    if (value && typeof value === "object") {
      const structured = value as Readonly<{
        records?: unknown;
        raw?: unknown;
      }>;
      if (Array.isArray(structured.records)) return returned(structured.records);
      if (Array.isArray(structured.raw)) return returned(structured.raw);
    }
    return [];
  }
  if (Array.isArray(value[0])) return returned(value[0]);
  return value.filter(
    (item): item is Row => item !== null && typeof item === "object" && !Array.isArray(item),
  );
}

function assertDate(value: Date, code: string): void {
  if (!Number.isFinite(value.getTime())) throw new Error(code);
}

function asDate(value: unknown): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("COMMAND_OUTBOX_CLAIM_LIMIT_INVALID");
  }
}

export type CommandOutboxState = "HELD" | "READY" | "LEASED" | "ENQUEUED" | "ACKNOWLEDGED" | "DEAD";

export interface CommandOutboxScope {
  readonly id: string;
  readonly commandId: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

export interface CommandOutboxRecord extends CommandOutboxScope {
  readonly state: CommandOutboxState;
  readonly availableAt: Date;
  readonly leaseUntil?: Date;
  readonly nextRepublishAt?: Date;
  readonly attempts: number;
  readonly envelopeHash: string;
  readonly createdAt: Date;
}

export interface ClaimedCommandOutboxRecord extends CommandOutboxRecord {
  readonly state: "LEASED";
  readonly leaseUntil: Date;
}

/** PostgreSQL authority for reconstructible command delivery generations. */
export class TypeOrmCommandOutboxRepository {
  constructor(private readonly source: DataSource) {}

  async insert(
    value: CommandOutboxRecord,
    manager: Pick<EntityManager, "query"> = this.source,
  ): Promise<void> {
    await manager.query(
      "INSERT INTO command_outbox(id,command_id,workspace_id,project_id,state,available_at,lease_until,next_republish_at,attempts,envelope_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        value.id,
        value.commandId,
        value.workspaceId,
        value.projectId,
        value.state,
        value.availableAt,
        value.leaseUntil ?? null,
        value.nextRepublishAt ?? null,
        value.attempts,
        value.envelopeHash,
        value.createdAt,
      ],
    );
  }

  async get(
    scope: CommandOutboxScope,
    manager: QueryExecutor = this.source.manager,
  ): Promise<CommandOutboxRecord | undefined> {
    const rows = (await manager.query(
      "SELECT * FROM command_outbox WHERE id=$1 AND command_id=$2 AND workspace_id=$3 AND project_id=$4",
      [scope.id, scope.commandId, scope.workspaceId, scope.projectId],
    )) as Row[];
    return rows[0] ? this.#map(rows[0]) : undefined;
  }

  /**
   * Claims READY rows and reconstructs delivery after an expired dispatcher
   * lease or an expired ENQUEUED visibility deadline after an interrupted worker cycle.
   */
  async claim(
    now: Date,
    leaseUntil: Date,
    limit = 50,
  ): Promise<readonly ClaimedCommandOutboxRecord[]> {
    return await this.source.transaction(
      "SERIALIZABLE",
      async (manager) => await this.claimInTransaction(manager, now, leaseUntil, limit),
    );
  }

  async claimInTransaction(
    manager: QueryExecutor,
    now: Date,
    leaseUntil: Date,
    limit = 50,
    capabilityKeys?: readonly string[],
  ): Promise<readonly ClaimedCommandOutboxRecord[]> {
    assertDate(now, "COMMAND_OUTBOX_CLAIM_TIME_INVALID");
    assertDate(leaseUntil, "COMMAND_OUTBOX_LEASE_INVALID");
    assertLimit(limit);
    if (leaseUntil <= now) throw new Error("COMMAND_OUTBOX_LEASE_INVALID");

    if (
      capabilityKeys !== undefined &&
      (capabilityKeys.length === 0 || new Set(capabilityKeys).size !== capabilityKeys.length)
    ) {
      throw new Error("COMMAND_OUTBOX_CAPABILITY_FILTER_INVALID");
    }
    const selected = (await manager.query(
      `SELECT o.*
         FROM command_outbox o
         JOIN connector_commands c
           ON c.id=o.command_id AND c.workspace_id=o.workspace_id AND c.project_id=o.project_id
        WHERE ((o.state='READY' AND o.available_at<=$1)
           OR (o.state='LEASED' AND o.lease_until IS NOT NULL AND o.lease_until<=$1)
           OR (o.state='ENQUEUED' AND o.next_republish_at IS NOT NULL AND o.next_republish_at<=$1))
          AND ($3::text[] IS NULL OR c.capability_key=ANY($3::text[]))
        ORDER BY CASE
          WHEN o.state='READY' THEN o.available_at
          WHEN o.state='LEASED' THEN o.lease_until
          ELSE o.next_republish_at
        END, o.id
        FOR UPDATE OF o SKIP LOCKED
        LIMIT $2`,
      [now, limit, capabilityKeys ? [...capabilityKeys] : null],
    )) as Row[];
    if (selected.length === 0) return Object.freeze([]);

    const ids = selected.map((row) => String(row.id));
    const updated = returned(
      await manager.query(
        "UPDATE command_outbox SET state='LEASED',lease_until=$2,next_republish_at=NULL,attempts=attempts+1 WHERE id=ANY($1::uuid[]) RETURNING *",
        [ids, leaseUntil],
      ),
    );
    const byId = new Map(updated.map((row) => [String(row.id), row]));
    return Object.freeze(
      ids.map((id) => {
        const row = byId.get(id);
        if (!row) throw new Error("COMMAND_OUTBOX_CLAIM_CONFLICT");
        return this.#claimed(row);
      }),
    );
  }

  /** Fenced LEASED -> ENQUEUED transition with a delivery visibility deadline. */
  async acknowledgeEnqueued(
    claim: ClaimedCommandOutboxRecord,
    nextRepublishAt: Date,
    manager: QueryExecutor = this.source.manager,
  ): Promise<CommandOutboxRecord> {
    assertDate(nextRepublishAt, "COMMAND_OUTBOX_VISIBILITY_INVALID");
    const rows = returned(
      await manager.query(
        `UPDATE command_outbox
            SET state='ENQUEUED',lease_until=NULL,next_republish_at=$6
          WHERE id=$1 AND command_id=$2 AND workspace_id=$3 AND project_id=$4
            AND state='LEASED' AND lease_until=$5
          RETURNING *`,
        [
          claim.id,
          claim.commandId,
          claim.workspaceId,
          claim.projectId,
          claim.leaseUntil,
          nextRepublishAt,
        ],
      ),
    );
    if (rows.length !== 1) throw new Error("COMMAND_OUTBOX_LEASE_CONFLICT");
    return this.#map(rows[0]!);
  }

  /** Fenced LEASED -> READY transition after queue publication did not commit. */
  async release(
    claim: ClaimedCommandOutboxRecord,
    availableAt: Date,
    manager: QueryExecutor = this.source.manager,
  ): Promise<CommandOutboxRecord> {
    assertDate(availableAt, "COMMAND_OUTBOX_AVAILABLE_AT_INVALID");
    const rows = returned(
      await manager.query(
        `UPDATE command_outbox
            SET state='READY',available_at=$6,lease_until=NULL,next_republish_at=NULL
          WHERE id=$1 AND command_id=$2 AND workspace_id=$3 AND project_id=$4
            AND state='LEASED' AND lease_until=$5
          RETURNING *`,
        [
          claim.id,
          claim.commandId,
          claim.workspaceId,
          claim.projectId,
          claim.leaseUntil,
          availableAt,
        ],
      ),
    );
    if (rows.length !== 1) throw new Error("COMMAND_OUTBOX_LEASE_CONFLICT");
    return this.#map(rows[0]!);
  }

  /** @deprecated Prefer scoped/fenced acknowledgeEnqueued, release, or TypeOrmCommandDeliveryStore. */
  async mark(id: string, state: CommandOutboxState): Promise<void> {
    await this.source.query(
      "UPDATE command_outbox SET state=$2,lease_until=NULL,next_republish_at=NULL WHERE id=$1",
      [id, state],
    );
  }

  #claimed(row: Row): ClaimedCommandOutboxRecord {
    const value = this.#map(row);
    if (value.state !== "LEASED" || !value.leaseUntil) {
      throw new Error("COMMAND_OUTBOX_CLAIM_CONFLICT");
    }
    return value as ClaimedCommandOutboxRecord;
  }

  #map(row: Row): CommandOutboxRecord {
    return {
      id: String(row.id),
      commandId: String(row.command_id),
      workspaceId: String(row.workspace_id),
      projectId: String(row.project_id),
      state: String(row.state) as CommandOutboxState,
      availableAt: asDate(row.available_at),
      ...(row.lease_until ? { leaseUntil: asDate(row.lease_until) } : {}),
      ...(row.next_republish_at ? { nextRepublishAt: asDate(row.next_republish_at) } : {}),
      attempts: Number(row.attempts),
      envelopeHash: String(row.envelope_hash),
      createdAt: asDate(row.created_at),
    };
  }
}
