import { randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import { sha256 } from "@awp/platform-contracts";

/** A durable read per due binding; missed webhooks are recovered without importing new work. */
export class JiraBoundRefreshScheduler {
  constructor(
    private readonly source: DataSource,
    private readonly endpoint: string,
  ) {}

  async run(now = new Date()): Promise<number> {
    return await this.source.transaction("READ COMMITTED", async (manager) => {
      const [lock] = await manager.query<readonly { acquired: boolean }[]>(
        "SELECT pg_try_advisory_xact_lock(hashtext('jira-bound-refresh-scheduler')) AS acquired",
      );
      if (!lock?.acquired) return 0;
      const due = await manager.query<readonly Record<string, unknown>[]>(
        `SELECT b.id,b.workspace_id,b.project_id,b.connection_header_id,b.external_entity_id
         FROM operational_bindings b
         JOIN connection_revisions c ON c.workspace_id=b.workspace_id
           AND c.header_id::text=b.connection_header_id AND c.version=(b.connection_ref->>'version')::integer
           AND c.status='PUBLISHED'
         WHERE b.external_entity_type='REQUEST' AND b.adapter_family='jira-cloud-v3'
           AND c.content->>'endpoint'=$2 AND c.content->>'environmentScope'='LOCAL'
           AND (b.last_observed_at IS NULL OR b.last_observed_at <= $1::timestamptz-interval '60 seconds')
           AND NOT EXISTS (
             SELECT 1 FROM event_outbox o WHERE o.workspace_id=b.workspace_id AND o.project_id=b.project_id
               AND o.event_type='jira.authoritative-read.requested.v1' AND o.state IN ('READY','LEASED')
               AND o.envelope->>'connectionId'=b.connection_header_id
               AND o.envelope->>'externalEntityId'=b.external_entity_id
           )
         ORDER BY b.last_observed_at NULLS FIRST,b.id
         LIMIT 50 FOR UPDATE OF b SKIP LOCKED`,
        [now, this.endpoint],
      );
      for (const binding of due) {
        const id = randomUUID();
        const envelope = {
          kind: "BOUND_POLL",
          connectionId: String(binding.connection_header_id),
          externalEntityId: String(binding.external_entity_id),
          receiptIdentity: id,
        };
        await manager.query(
          `INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at)
           VALUES($1,$2,$3,'jira.authoritative-read.requested.v1',$4,$5,'READY',$6)`,
          [id, binding.workspace_id, binding.project_id, envelope, sha256(envelope), now],
        );
      }
      return due.length;
    });
  }
}
