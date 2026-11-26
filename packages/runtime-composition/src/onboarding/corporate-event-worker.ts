import type { DataSource } from "typeorm";

import { createProjectEventEnvelope, type ProjectEventEnvelope } from "@awp/platform-core";

/** Processes only the deployment's projects; inbox and acknowledgement commit together. */
export function createCorporateOnboardingEventWorker(
  source: DataSource,
  scope: Readonly<{ workspaceId: string; projectIds: readonly string[] }>,
) {
  if (
    !source.isInitialized ||
    !scope.workspaceId ||
    !scope.projectIds.length ||
    new Set(scope.projectIds).size !== scope.projectIds.length
  )
    throw new Error("CORPORATE_ONBOARDING_EVENT_SCOPE_REQUIRED");
  return {
    async run() {
      return await source.transaction(async (manager) => {
        const rows = (await manager.query(
          `SELECT id,workspace_id,project_id,event_type,envelope FROM event_outbox
          WHERE state='READY' AND workspace_id=$1 AND project_id=ANY($2::uuid[])
            AND event_type IN ('PROJECT_REGISTERED','PROJECT_ENTITLEMENTS_CHANGED','PROJECT_ONBOARDING_CHANGED','PROJECT_BINDING_CHANGED','PROJECT_OPERATIONAL_STATE_CHANGED')
          ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 100`,
          [scope.workspaceId, [...scope.projectIds]],
        )) as readonly {
          id: string;
          workspace_id: string;
          project_id: string;
          event_type: string;
          envelope: ProjectEventEnvelope | string;
        }[];
        let applied = 0,
          duplicates = 0,
          quarantined = 0;
        for (const row of rows) {
          let event: ProjectEventEnvelope | undefined;
          try {
            event =
              typeof row.envelope === "string"
                ? (JSON.parse(row.envelope) as ProjectEventEnvelope)
                : row.envelope;
            const { contentHash, ...payload } = event.payload;
            const expected = createProjectEventEnvelope(payload);
            if (
              event.schemaVersion !== 1 ||
              event.partitionKey !== expected.partitionKey ||
              contentHash !== expected.payload.contentHash ||
              payload.eventId !== row.id ||
              payload.eventType !== row.event_type ||
              payload.scope.workspaceId !== row.workspace_id ||
              payload.scope.projectId !== row.project_id
            )
              throw new Error("CORPORATE_ONBOARDING_EVENT_INVALID");
          } catch {
            await manager.query(
              "UPDATE event_outbox SET state='DEAD',envelope=envelope||jsonb_build_object('quarantineReason','EVENT_ENVELOPE_INVALID') WHERE id=$1 AND workspace_id=$2 AND project_id=$3",
              [row.id, row.workspace_id, row.project_id],
            );
            quarantined++;
            continue;
          }
          const existing = (await manager.query(
            "SELECT message_hash FROM consumer_inbox WHERE consumer_key='project-onboarding-projection' AND message_id=$1",
            [row.id],
          )) as readonly { message_hash: string }[];
          if (existing.length && existing[0]!.message_hash !== event.payload.contentHash) {
            await manager.query(
              "UPDATE event_outbox SET state='DEAD',envelope=envelope||jsonb_build_object('quarantineReason','EVENT_REPLAY_HASH_MISMATCH') WHERE id=$1 AND workspace_id=$2 AND project_id=$3",
              [row.id, row.workspace_id, row.project_id],
            );
            quarantined++;
            continue;
          }
          if (existing.length) duplicates++;
          else {
            await manager.query(
              "INSERT INTO consumer_inbox(consumer_key,message_id,message_hash,processed_at) VALUES('project-onboarding-projection',$1,$2,clock_timestamp()) ON CONFLICT(consumer_key,message_id) DO NOTHING",
              [row.id, event.payload.contentHash],
            );
            applied++;
          }
          await manager.query(
            "UPDATE event_outbox SET state='ACKNOWLEDGED' WHERE id=$1 AND workspace_id=$2 AND project_id=$3 AND state='READY'",
            [row.id, row.workspace_id, row.project_id],
          );
        }
        return { applied, duplicates, quarantined };
      });
    },
  };
}
