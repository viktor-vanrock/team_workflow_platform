import { createHash, randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import { StructuredLogger } from "@awp/platform-runtime-nest";
import {
  loadEnvironment,
  qaJiraLocalSeedRefs,
  QaJiraOperationalActionService,
} from "@awp/runtime-composition";

import type { OperationalAuthorityHandlers } from "../extensions/operational-authority-http-api.ts";

function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
export function createLocalOperationalAuthorityHandlers(
  source: DataSource,
): OperationalAuthorityHandlers {
  if (!["local", "test"].includes(loadEnvironment().profile))
    throw new Error("LOCAL_OPERATIONAL_AUTHORITY_FORBIDDEN");
  const actions = new QaJiraOperationalActionService(source, loadEnvironment());
  return {
    projection: async ({ workspaceId, projectId, workItemId }) => {
      const rows = await source.query<readonly Record<string, unknown>[]>(
        "SELECT b.*,p.revision AS projection_revision,p.authority_snapshot FROM operational_bindings b LEFT JOIN operational_projection_revisions p ON p.id=b.current_projection_revision_id WHERE b.workspace_id=$1 AND b.project_id=$2 AND b.work_item_id=$3",
        [workspaceId, projectId, workItemId],
      );
      const row = rows[0];
      if (!row) return undefined;
      return {
        ...row,
        freshness_state:
          row.sync_state === "SYNCED" || row.sync_state === "CONFLICT"
            ? row.fresh_until
              ? new Date(String(row.fresh_until)).getTime() > Date.now()
                ? "CURRENT"
                : "STALE"
              : "UNKNOWN"
            : "STALE",
      };
    },
    conflicts: async ({ workspaceId, projectId, workItemId }) =>
      source.query<readonly Record<string, unknown>[]>(
        "SELECT c.* FROM operational_sync_conflicts c JOIN operational_bindings b ON b.id=c.binding_id AND b.workspace_id=c.workspace_id AND b.project_id=c.project_id WHERE c.workspace_id=$1 AND c.project_id=$2 AND b.work_item_id=$3 ORDER BY c.detected_at DESC",
        [workspaceId, projectId, workItemId],
      ),
    importDiagnostics: async ({ workspaceId, projectId, state }) =>
      source.query<readonly Record<string, unknown>[]>(
        "SELECT id,state,reason_code,created_at FROM operational_import_intents WHERE workspace_id=$1 AND project_id=$2 AND ($3::text IS NULL OR state=$3) ORDER BY created_at DESC",
        [workspaceId, projectId, state ?? null],
      ),
    reconciliation: async ({ workspaceId, projectId }, lane) => {
      if (lane !== "IMPORT_DISCOVERY" && lane !== "BOUND_REFRESH")
        throw new Error("JIRA_RECONCILIATION_LANE_UNSUPPORTED");
      return await source.transaction("SERIALIZABLE", async (manager) => {
        const configuration = (await manager.query(
          `SELECT p.content_hash AS profile_hash,c.content_hash AS connection_hash
                 FROM connector_profile_revisions p
                 JOIN connection_revisions c ON c.header_id=$5 AND c.version=$6 AND c.status='PUBLISHED' AND c.workspace_id=$1
                WHERE p.header_id=$3 AND p.version=$4 AND p.status='PUBLISHED' AND p.workspace_id=$1
                  AND EXISTS(SELECT 1 FROM integration_validation_reports v WHERE v.workspace_id=$1 AND v.subject_kind='PROFILE' AND v.subject_id=p.header_id AND v.subject_version=p.version AND v.outcome='VALID' AND v.content_hash=p.content_hash)
                  AND EXISTS(SELECT 1 FROM project_integration_binding_revisions b JOIN integration_validation_reports v ON v.workspace_id=b.workspace_id AND v.project_id=b.project_id AND v.subject_kind='BINDING' AND v.subject_id=b.header_id AND v.subject_version=b.version AND v.outcome='VALID' AND v.content_hash=b.content_hash WHERE b.workspace_id=$1 AND b.project_id=$2 AND b.header_id=$7 AND b.version=$8 AND b.status='PUBLISHED')`,
          [
            workspaceId,
            projectId,
            qaJiraLocalSeedRefs.profile.id,
            qaJiraLocalSeedRefs.profile.version,
            qaJiraLocalSeedRefs.connection.id,
            qaJiraLocalSeedRefs.connection.version,
            qaJiraLocalSeedRefs.binding.id,
            qaJiraLocalSeedRefs.binding.version,
          ],
        )) as readonly Readonly<{ profile_hash: string; connection_hash: string }>[];
        const current = configuration[0];
        if (!current) throw new Error("JIRA_RECONCILIATION_CONFIGURATION_INVALID");
        const profileRef = Object.freeze({
          ...qaJiraLocalSeedRefs.profile,
          contentHash: current.profile_hash,
        });
        const connectionRef = Object.freeze({
          ...qaJiraLocalSeedRefs.connection,
          contentHash: current.connection_hash,
        });
        const cursorId = deterministicUuid(
          `jira-reconciliation-cursor:${workspaceId}:${projectId}:${lane}:${profileRef.id}:${profileRef.version}`,
        );
        const runId = randomUUID();
        const correlationId = deterministicUuid(`${runId}:correlation`);
        await manager.query(
          `INSERT INTO reconciliation_cursors(
                 id,workspace_id,project_id,profile_ref,connection_ref,lane,watermark_updated_at,watermark_external_key,
                 overlap_seconds,page_size,max_concurrency,budget_class,next_due_at,resource_version
               ) VALUES($1,$2,$3,$4,$5,$6,'1970-01-01T00:00:00.000Z','',120,100,4,'STANDARD',clock_timestamp(),1)
               ON CONFLICT(id) DO NOTHING`,
          [
            cursorId,
            workspaceId,
            projectId,
            JSON.stringify(profileRef),
            JSON.stringify(connectionRef),
            lane,
          ],
        );
        await manager.query(
          `INSERT INTO reconciliation_runs(
                 id,workspace_id,project_id,cursor_id,profile_ref,connection_ref,lane,start_watermark,state,counts,started_at,correlation_id,resource_version
               ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9,clock_timestamp(),$10,1)`,
          [
            runId,
            workspaceId,
            projectId,
            cursorId,
            JSON.stringify(profileRef),
            JSON.stringify(connectionRef),
            lane,
            JSON.stringify({ updatedAt: "1970-01-01T00:00:00.000Z", externalKey: "" }),
            JSON.stringify({ discovered: 0, applied: 0, duplicate: 0 }),
            correlationId,
          ],
        );
        const envelope = Object.freeze({
          kind: lane,
          runId,
          cursorId,
          connectionId: qaJiraLocalSeedRefs.connection.id,
        });
        const envelopeHash = `sha256:${createHash("sha256").update(JSON.stringify(envelope)).digest("hex")}`;
        await manager.query(
          "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,'jira.authoritative-read.requested.v1',$4,$5,'READY',clock_timestamp())",
          [
            deterministicUuid(`${runId}:outbox`),
            workspaceId,
            projectId,
            JSON.stringify(envelope),
            envelopeHash,
          ],
        );
        return Object.freeze({ status: "QUEUED", runId });
      });
    },
    prepareAction: async ({ authorizations, ...input }) =>
      await actions.prepare({ ...input, actorSubject: authorizations[0]!.actor.subject }),
    decideApproval: async ({ authorizations, ...input }) => {
      try {
        return await actions.decide({ ...input, actorSubject: authorizations[0]!.actor.subject });
      } catch (error) {
        new StructuredLogger().write("error", "api.operation.failed", {
          component: "api",
          operation: "qa.approval",
          outcome: "FAILED",
          reasonCode: "UNEXPECTED_FAILURE",
        });
        throw error;
      }
    },
  };
}
