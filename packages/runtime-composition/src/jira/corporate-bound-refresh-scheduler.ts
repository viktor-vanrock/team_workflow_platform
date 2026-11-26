import { randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import { sha256 } from "@awp/platform-contracts";

import type { RuntimeEnvironment } from "../config/environment.ts";
import type { CorporateConnectorGrant } from "../pilot/connector-authority.ts";

/** Schedules read-only refreshes exclusively for deployment-pinned Jira connections. */
export function createCorporateJiraBoundRefreshScheduler(
  input: Readonly<{
    source: DataSource;
    environment: RuntimeEnvironment;
    grants: readonly CorporateConnectorGrant[];
  }>,
) {
  const deployment = input.environment.deployment;
  if (
    !input.source.isInitialized ||
    input.environment.profile !== "non-local" ||
    input.environment.environmentScope !== "NON_PROD" ||
    !deployment
  )
    throw new Error("CORPORATE_JIRA_REFRESH_SCOPE_REQUIRED");
  const pins = input.grants
    .filter(
      ({ binding }) =>
        binding.provider === "JIRA" &&
        binding.workspaceId === deployment.workspaceId &&
        deployment.projectIds.includes(binding.projectId),
    )
    .map(({ binding }) => ({
      workspaceId: binding.workspaceId,
      projectId: binding.projectId,
      connectionId: binding.connectionRef.id,
      connectionVersion: binding.connectionRef.version,
      connectionHash: binding.connectionRef.contentHash,
    }));
  if (
    pins.length !== deployment.projectIds.length ||
    new Set(pins.map((pin) => pin.projectId)).size !== pins.length
  )
    throw new Error("CORPORATE_JIRA_REFRESH_PINS_REQUIRED");
  return {
    async run(now = new Date()) {
      if (!Number.isFinite(now.getTime())) throw new Error("CORPORATE_JIRA_REFRESH_TIME_INVALID");
      return await input.source.transaction("READ COMMITTED", async (manager) => {
        const rows = (await manager.query(
          `SELECT b.id,b.workspace_id,b.project_id,b.connection_header_id,b.external_entity_id
          FROM operational_bindings b
          JOIN jsonb_to_recordset($2::jsonb) AS allowed("workspaceId" uuid,"projectId" uuid,"connectionId" text,"connectionVersion" integer,"connectionHash" text)
            ON allowed."workspaceId"=b.workspace_id AND allowed."projectId"=b.project_id
              AND allowed."connectionId"=b.connection_header_id AND allowed."connectionId"=b.connection_ref->>'id'
              AND allowed."connectionVersion"=(b.connection_ref->>'version')::integer
              AND (NOT (b.connection_ref ? 'contentHash') OR allowed."connectionHash"=b.connection_ref->>'contentHash')
          JOIN connection_headers h ON h.workspace_id=b.workspace_id AND h.id::text=b.connection_header_id AND h.current_published_version=allowed."connectionVersion"
          JOIN connection_revisions c ON c.workspace_id=h.workspace_id AND c.header_id=h.id AND c.version=h.current_published_version
            AND c.status='PUBLISHED' AND c.content_hash=allowed."connectionHash"
          WHERE b.external_entity_type='REQUEST' AND b.adapter_family='jira-cloud-v3'
            AND (b.last_observed_at IS NULL OR b.last_observed_at<=$1::timestamptz-interval '60 seconds')
            AND NOT EXISTS (SELECT 1 FROM event_outbox o WHERE o.workspace_id=b.workspace_id AND o.project_id=b.project_id
              AND o.event_type='jira.authoritative-read.requested.v1' AND o.state IN ('READY','LEASED')
              AND o.envelope->>'connectionId'=b.connection_header_id AND o.envelope->>'externalEntityId'=b.external_entity_id)
          ORDER BY b.last_observed_at NULLS FIRST,b.id LIMIT 50 FOR UPDATE OF b SKIP LOCKED`,
          [now, JSON.stringify(pins)],
        )) as readonly Record<string, unknown>[];
        for (const binding of rows) {
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
        return rows.length;
      });
    },
  };
}
