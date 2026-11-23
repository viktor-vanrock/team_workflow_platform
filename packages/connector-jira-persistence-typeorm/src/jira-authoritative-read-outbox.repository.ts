import type { DataSource, EntityManager } from "typeorm";

const eventType = "jira.authoritative-read.requested.v1";

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

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("JIRA_AUTHORITATIVE_READ_RECOVERY_LIMIT_INVALID");
  }
}

function asDate(value: unknown): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
}

export interface JiraAuthoritativeReadOutboxClaim {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly envelope: unknown;
  readonly leaseOwner: string;
  readonly leaseToken: string;
  readonly leaseUntil: Date;
  readonly attemptCount: number;
}

export type JiraAuthoritativeReadOutboxMutation<T> = (manager: EntityManager) => Promise<T>;

/**
 * PostgreSQL authority for Jira webhook invalidation delivery.
 *
 * The provider payload remains only a hint. A claim schedules the authoritative
 * read, and its fencing token prevents an expired worker from committing a
 * projection after another process has reclaimed the row.
 */
export class TypeOrmJiraAuthoritativeReadOutboxRepository {
  constructor(private readonly source: DataSource) {}

  async claim(
    now: Date,
    leaseUntil: Date,
    leaseOwner: string,
  ): Promise<JiraAuthoritativeReadOutboxClaim | undefined> {
    assertDate(now, "JIRA_AUTHORITATIVE_READ_CLAIM_TIME_INVALID");
    assertDate(leaseUntil, "JIRA_AUTHORITATIVE_READ_LEASE_INVALID");
    if (leaseUntil <= now || leaseOwner.length === 0) {
      throw new Error("JIRA_AUTHORITATIVE_READ_LEASE_INVALID");
    }
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const rows = returned(
        await manager.query(
          `WITH candidate AS (
           SELECT id
             FROM event_outbox
            WHERE event_type=$1
              AND (
                (state='READY' AND (lease_until IS NULL OR lease_until<=$2))
                OR (state='LEASED' AND lease_until IS NOT NULL AND lease_until<=$2)
              )
            ORDER BY CASE WHEN state='READY' THEN created_at ELSE lease_until END,id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         UPDATE event_outbox outbox
            SET state='LEASED',
                lease_owner=$3,
                lease_token=outbox.lease_token+1,
                lease_until=$4,
                attempt_count=outbox.attempt_count+1
           FROM candidate
          WHERE outbox.id=candidate.id
         RETURNING outbox.id,outbox.workspace_id,outbox.project_id,outbox.envelope,
                   outbox.lease_owner,outbox.lease_token,outbox.lease_until,
                   outbox.attempt_count`,
          [eventType, now, leaseOwner, leaseUntil],
        ),
      );
      return rows[0] ? this.#claim(rows[0]) : undefined;
    });
  }

  async recoverExpired(now: Date, limit = 50): Promise<number> {
    assertDate(now, "JIRA_AUTHORITATIVE_READ_RECOVERY_TIME_INVALID");
    assertLimit(limit);
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const rows = returned(
        await manager.query(
          `WITH expired AS (
           SELECT id
             FROM event_outbox
            WHERE event_type=$1
              AND state='LEASED'
              AND lease_until IS NOT NULL
              AND lease_until<=$2
            ORDER BY lease_until,id
            FOR UPDATE SKIP LOCKED
            LIMIT $3
         )
         UPDATE event_outbox outbox
            SET state='READY',lease_owner=NULL,lease_until=NULL
           FROM expired
          WHERE outbox.id=expired.id
         RETURNING outbox.id`,
          [eventType, now, limit],
        ),
      );
      return rows.length;
    });
  }

  async complete<T>(
    claim: JiraAuthoritativeReadOutboxClaim,
    now: Date,
    mutate: JiraAuthoritativeReadOutboxMutation<T>,
  ): Promise<T> {
    assertDate(now, "JIRA_AUTHORITATIVE_READ_COMPLETION_TIME_INVALID");
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      await this.#lockCurrentLease(manager, claim, now);
      const result = await mutate(manager);
      const rows = returned(
        await manager.query(
          `UPDATE event_outbox
            SET state='ACKNOWLEDGED',lease_owner=NULL,lease_until=NULL
          WHERE id=$1 AND workspace_id=$2 AND project_id=$3
            AND event_type=$4 AND state='LEASED'
            AND lease_owner=$5 AND lease_token=$6
          RETURNING id`,
          [
            claim.id,
            claim.workspaceId,
            claim.projectId,
            eventType,
            claim.leaseOwner,
            claim.leaseToken,
          ],
        ),
      );
      if (rows.length !== 1) {
        throw new Error("JIRA_AUTHORITATIVE_READ_LEASE_CONFLICT");
      }
      return result;
    });
  }

  async release(
    claim: JiraAuthoritativeReadOutboxClaim,
    retryAt?: Date,
    mutate?: JiraAuthoritativeReadOutboxMutation<void>,
  ): Promise<boolean> {
    if (retryAt) assertDate(retryAt, "JIRA_AUTHORITATIVE_READ_RETRY_TIME_INVALID");
    return await this.source.transaction("READ COMMITTED", async (manager) => {
      const rows = returned(
        await manager.query(
          `UPDATE event_outbox
          SET state='READY',lease_owner=NULL,lease_until=$7
        WHERE id=$1 AND workspace_id=$2 AND project_id=$3
          AND event_type=$4 AND state='LEASED'
          AND lease_owner=$5 AND lease_token=$6
        RETURNING id`,
          [
            claim.id,
            claim.workspaceId,
            claim.projectId,
            eventType,
            claim.leaseOwner,
            claim.leaseToken,
            retryAt ?? null,
          ],
        ),
      );
      if (rows.length !== 1) return false;
      await mutate?.(manager);
      return true;
    });
  }

  async #lockCurrentLease(
    manager: QueryExecutor,
    claim: JiraAuthoritativeReadOutboxClaim,
    now: Date,
  ): Promise<void> {
    const rows = returned(
      await manager.query(
        `SELECT id
         FROM event_outbox
        WHERE id=$1 AND workspace_id=$2 AND project_id=$3
          AND event_type=$4 AND state='LEASED'
          AND lease_owner=$5 AND lease_token=$6
          AND lease_until IS NOT NULL AND lease_until>$7
        FOR UPDATE`,
        [
          claim.id,
          claim.workspaceId,
          claim.projectId,
          eventType,
          claim.leaseOwner,
          claim.leaseToken,
          now,
        ],
      ),
    );
    if (rows.length !== 1) {
      throw new Error("JIRA_AUTHORITATIVE_READ_LEASE_CONFLICT");
    }
  }

  #claim(row: Row): JiraAuthoritativeReadOutboxClaim {
    const leaseUntil = asDate(row.lease_until);
    if (
      String(row.lease_owner).length === 0 ||
      String(row.lease_token) === "0" ||
      !Number.isFinite(leaseUntil.getTime())
    ) {
      throw new Error("JIRA_AUTHORITATIVE_READ_CLAIM_CONFLICT");
    }
    return Object.freeze({
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      projectId: String(row.project_id),
      envelope: row.envelope,
      leaseOwner: String(row.lease_owner),
      leaseToken: String(row.lease_token),
      leaseUntil,
      attemptCount: Number(row.attempt_count),
    });
  }
}
