import type { DataSource, EntityManager } from "typeorm";

import {
  type AuthorizedProjectQueryToken,
  type CompleteOperationalObservation,
  type ConnectorCommand,
  type ProjectionReduction,
  reduceOperationalProjection,
  type TargetLaneClaim,
  validateConnectorCommandSnapshot,
} from "@awp/platform-core";

import { TypeOrmCommandRepository } from "./command.repository.ts";

type Row = Record<string, unknown>;
function returnedRows(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  if (Array.isArray(value[0])) return value[0] as Row[];
  return value.filter(
    (candidate): candidate is Row =>
      !!candidate && typeof candidate === "object" && !Array.isArray(candidate),
  );
}
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

export interface ConfirmedOperationalProjectionRecord {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly workTypeKey: string;
  readonly workTypeVersion: string;
  readonly projectionId: string;
  readonly revision: number;
  readonly authorityFieldsHash: `sha256:${string}`;
  readonly externalRevisionToken: string;
  readonly observedAt: string;
  readonly confirmedAt: string;
  readonly freshness: "CURRENT" | "STALE" | "UNKNOWN";
  readonly mappingRef: Readonly<{ id: string; version: number }>;
  readonly snapshot: CompleteOperationalObservation;
}

export class TypeOrmOperationalAuthorityRepository {
  constructor(private readonly source: DataSource) {}
  async confirmedProjectionForWorkItemAuthorized(
    token: AuthorizedProjectQueryToken,
    projectId: string,
    workItemId: string,
  ): Promise<ConfirmedOperationalProjectionRecord | undefined> {
    token.assert(projectId, 0, "READ");
    return this.confirmedProjectionForWorkItem(
      { workspaceId: token.workspaceId, projectId },
      workItemId,
    );
  }
  /**
   * Reads the exact confirmed authority revision. The mutable Work Item state is
   * intentionally absent from this query and can never become queue authority.
   */
  async confirmedProjectionForWorkItem(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    workItemId: string,
    executor?: EntityManager,
  ): Promise<ConfirmedOperationalProjectionRecord | undefined> {
    const rows = returnedRows(
      await (executor ?? this.source).query(
        `SELECT w.id AS work_item_id,d.work_type_key,d.definition_version,
              b.workspace_id,b.project_id,
              CASE WHEN b.sync_state NOT IN ('SYNCED','CONFLICT') OR b.fresh_until<=clock_timestamp()
                   THEN 'STALE' ELSE b.freshness_state END AS freshness_state,
              p.id AS projection_id,p.revision,p.authority_fields_hash,
              p.external_revision_token,p.authority_snapshot,p.configuration_refs,
              p.observed_at,p.applied_at
         FROM work_items w
         JOIN work_type_definitions d ON d.id=w.work_type_definition_id
         JOIN operational_bindings b
           ON b.workspace_id=w.workspace_id AND b.project_id=w.project_id
          AND b.id=w.operational_binding_id AND b.work_item_id=w.id
         JOIN operational_projection_revisions p
           ON p.workspace_id=b.workspace_id AND p.project_id=b.project_id
          AND p.binding_id=b.id AND p.id=b.current_projection_revision_id
        WHERE w.workspace_id=$1 AND w.project_id=$2 AND w.id=$3`,
        [scope.workspaceId, scope.projectId, workItemId],
      ),
    );
    const row = rows[0];
    if (!row) return undefined;
    const snapshot = json<CompleteOperationalObservation>(row.authority_snapshot);
    const configuration = json<Readonly<{ mappingRef: Readonly<{ id: string; version: number }> }>>(
      row.configuration_refs,
    );
    if (
      String(row.workspace_id) !== scope.workspaceId ||
      String(row.project_id) !== scope.projectId ||
      String(row.work_item_id) !== workItemId
    ) {
      throw new Error("OPERATIONAL_PROJECTION_SCOPE_MISMATCH");
    }
    const semanticHash = String(row.authority_fields_hash);
    if (!/^sha256:[a-f0-9]{64}$/u.test(semanticHash))
      throw new Error("OPERATIONAL_PROJECTION_HASH_INVALID");
    const observedAt = (
      row.observed_at instanceof Date ? row.observed_at : new Date(String(row.observed_at))
    ).toISOString();
    const confirmedAt = (
      row.applied_at instanceof Date ? row.applied_at : new Date(String(row.applied_at))
    ).toISOString();
    return Object.freeze({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      workItemId,
      workTypeKey: String(row.work_type_key),
      workTypeVersion: String(row.definition_version),
      projectionId: String(row.projection_id),
      revision: Number(row.revision),
      authorityFieldsHash: semanticHash as `sha256:${string}`,
      externalRevisionToken: String(row.external_revision_token),
      observedAt,
      confirmedAt,
      freshness: String(row.freshness_state) as ConfirmedOperationalProjectionRecord["freshness"],
      mappingRef: Object.freeze({ ...configuration.mappingRef }),
      snapshot: Object.freeze({ ...snapshot }),
    });
  }
  async bindingByExternalIdentity(
    connectionHeaderId: string,
    externalEntityType: string,
    externalEntityId: string,
  ): Promise<Row | undefined> {
    const rows = (await this.source.query(
      "SELECT * FROM operational_bindings WHERE connection_header_id=$1 AND external_entity_type=$2 AND external_entity_id=$3",
      [connectionHeaderId, externalEntityType, externalEntityId],
    )) as Row[];
    return rows[0];
  }
  async reduceObservation(
    manager: EntityManager,
    scope: Readonly<{ workspaceId: string; projectId: string; bindingId: string }>,
    observation: CompleteOperationalObservation,
    observationHash: string,
    correlationId: string,
    causationId: string,
  ): Promise<ProjectionReduction> {
    const rows = (await manager.query(
      "SELECT * FROM operational_projection_revisions WHERE workspace_id=$1 AND project_id=$2 AND binding_id=$3 ORDER BY revision DESC LIMIT 1 FOR UPDATE",
      [scope.workspaceId, scope.projectId, scope.bindingId],
    )) as Row[];
    const row = rows[0];
    const current = row
      ? {
          ...json<CompleteOperationalObservation>(row.authority_snapshot),
          revision: Number(row.revision),
          appliedAt: new Date(String(row.applied_at)).toISOString(),
        }
      : undefined;
    const reduction = reduceOperationalProjection(current, observation);
    if (reduction.disposition !== "APPLIED" || !reduction.projection) return reduction;
    const projectionId = crypto.randomUUID();
    await manager.query(
      "INSERT INTO operational_projection_revisions(id,workspace_id,project_id,binding_id,revision,observation_id,observation_source,configuration_refs,external_entity_id,external_display_key,external_web_url,external_revision_token,authority_fields_hash,observation_hash,provider_updated_at,provider_changelog_id,authority_snapshot,observed_at,applied_at,correlation_id,causation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)",
      [
        projectionId,
        scope.workspaceId,
        scope.projectId,
        scope.bindingId,
        reduction.projection.revision,
        observation.observationId,
        observation.source,
        JSON.stringify({
          profileRef: observation.profileRef,
          mappingRef: observation.mappingRef,
          connectionRef: observation.connectionRef,
        }),
        observation.externalEntityId,
        observation.externalDisplayKey,
        observation.externalWebUrl ?? null,
        observation.externalRevisionToken,
        observation.authorityFieldsHash,
        observationHash,
        observation.providerUpdatedAt,
        observation.providerChangelogId ?? null,
        JSON.stringify(observation),
        observation.observedAt,
        reduction.projection.appliedAt,
        correlationId,
        causationId,
      ],
    );
    await manager.query(
      "UPDATE operational_bindings SET current_projection_revision_id=$4,current_external_display_key=$5,current_external_revision_token=$6,sync_state='SYNCED',freshness_state='CURRENT',last_observed_at=$7,updated_at=$7,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [
        scope.workspaceId,
        scope.projectId,
        scope.bindingId,
        projectionId,
        observation.externalDisplayKey,
        observation.externalRevisionToken,
        observation.observedAt,
      ],
    );
    return reduction;
  }
  async claimTargetLane(
    manager: EntityManager,
    key: Readonly<{
      connectionHeaderId: string;
      externalEntityType: string;
      externalEntityId: string;
    }>,
    commandId: string,
    effectId: string,
    now: Date,
    leaseMs: number,
  ): Promise<TargetLaneClaim> {
    const rows = (await manager.query(
      "SELECT * FROM connector_target_execution_lanes WHERE connection_header_id=$1 AND external_entity_type=$2 AND external_entity_id=$3 FOR UPDATE",
      [key.connectionHeaderId, key.externalEntityType, key.externalEntityId],
    )) as Row[];
    const row = rows[0];
    if (
      row &&
      row.state !== "RELEASED" &&
      (String(row.active_command_id) !== commandId ||
        String(row.effect_id) !== effectId ||
        new Date(String(row.lease_expires_at)) > now)
    )
      throw new Error("TARGET_LANE_OCCUPIED");
    const token = Number(row?.lease_token ?? 0) + 1;
    const expires = new Date(now.getTime() + leaseMs);
    await manager.query(
      "INSERT INTO connector_target_execution_lanes(connection_header_id,external_entity_type,external_entity_id,active_command_id,effect_id,lease_token,lease_expires_at,attempt,state,resource_version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,'CLAIMED',1,$8,$8) ON CONFLICT(connection_header_id,external_entity_type,external_entity_id) DO UPDATE SET active_command_id=$4,effect_id=$5,lease_token=$6,lease_expires_at=$7,attempt=connector_target_execution_lanes.attempt+1,state='CLAIMED',resource_version=connector_target_execution_lanes.resource_version+1,updated_at=$8",
      [
        key.connectionHeaderId,
        key.externalEntityType,
        key.externalEntityId,
        commandId,
        effectId,
        token,
        expires,
        now,
      ],
    );
    return Object.freeze({
      laneKey: `${key.connectionHeaderId}:${key.externalEntityType}:${key.externalEntityId}`,
      commandId,
      effectId,
      fencingToken: token,
      leaseExpiresAt: expires,
      state: "CLAIMED",
    });
  }
  async terminalizeCommand(
    manager: EntityManager,
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      commandId: string;
      approvalId: string;
      connectionHeaderId: string;
      externalEntityType: string;
      externalEntityId: string;
      fencingToken: number;
      outcome: "CONFIRMED" | "CONFLICT" | "AMBIGUOUS";
      result: unknown;
      appendConflict?: () => Promise<void>;
    }>,
  ): Promise<void> {
    const commandState: ConnectorCommand["status"] =
      input.outcome === "CONFIRMED"
        ? "CONFIRMED"
        : input.outcome === "CONFLICT"
          ? "CONFLICT"
          : "FAILED";
    const laneState = input.outcome === "AMBIGUOUS" ? "AWAITING_RECONCILIATION" : "RELEASED";
    const lane = returnedRows(
      await manager.query(
        "UPDATE connector_target_execution_lanes SET state=$5,lease_expires_at=NULL,updated_at=clock_timestamp(),resource_version=resource_version+1 WHERE connection_header_id=$1 AND external_entity_type=$2 AND external_entity_id=$3 AND lease_token=$4 AND active_command_id=$6 RETURNING lease_token",
        [
          input.connectionHeaderId,
          input.externalEntityType,
          input.externalEntityId,
          input.fencingToken,
          laneState,
          input.commandId,
        ],
      ),
    );
    if (lane.length !== 1) throw new Error("TARGET_LANE_FENCE_REJECTED");
    const approvals = (await manager.query(
      "SELECT id FROM approvals WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND decision_state='APPROVED' AND effect_authorization_state='CONSUMED' FOR UPDATE",
      [input.workspaceId, input.projectId, input.approvalId],
    )) as Row[];
    if (approvals.length !== 1) throw new Error("APPROVAL_TERMINALIZATION_CONFLICT");
    const repository = new TypeOrmCommandRepository(this.source);
    const command = await repository.get(
      input.workspaceId,
      input.projectId,
      input.commandId,
      manager,
    );
    if (!command || command.status !== "DISPATCHED" || command.outboxStatus !== "ACKNOWLEDGED")
      throw new Error("COMMAND_TERMINALIZATION_CONFLICT");
    const terminalResult: ConnectorCommand["terminalResult"] =
      input.outcome === "CONFIRMED"
        ? { outcome: "SUCCEEDED", receipt: input.result }
        : input.outcome === "CONFLICT"
          ? { outcome: "CONFLICT", receipt: input.result }
          : { outcome: "FAILED", code: "AMBIGUOUS_EXTERNAL_RESULT", receipt: input.result };
    const commandWithoutLease = { ...command };
    delete commandWithoutLease.executionLeaseExpiresAt;
    const next: ConnectorCommand = {
      ...commandWithoutLease,
      status: commandState,
      outboxStatus: input.outcome === "CONFIRMED" ? "ACKNOWLEDGED" : "DEAD",
      terminalResult,
      updatedAt: new Date(),
      rowVersion: command.rowVersion + 1,
    };
    validateConnectorCommandSnapshot(next);
    await repository.save(next, command.rowVersion, manager);
    await manager.query(
      "UPDATE command_outbox SET state=$4,lease_until=NULL,next_republish_at=NULL WHERE workspace_id=$1 AND project_id=$2 AND command_id=$3",
      [
        input.workspaceId,
        input.projectId,
        input.commandId,
        input.outcome === "CONFIRMED" ? "ACKNOWLEDGED" : "DEAD",
      ],
    );
    if (input.outcome === "CONFLICT") await input.appendConflict?.();
  }
}
