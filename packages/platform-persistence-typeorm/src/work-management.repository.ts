import type { DataSource } from "typeorm";

import type {
  AuthorizedProjectQueryToken,
  IntakeDraft,
  NormalizedStatus,
  OperationalProjection,
  OperationalProjectionQueryPort,
  ProjectRegistryQueryPort,
  ProjectRegistryStatus,
  WorkItem,
  WorkManagementRepository,
  WorkspaceWorkTypeState,
} from "@awp/platform-core";

import { TypeOrmOperationalAuthorityRepository } from "./operational-authority.repository.ts";

type Row = Record<string, unknown>;
const parse = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

const normalizedStatuses = new Set<NormalizedStatus>([
  "NEW",
  "NEEDS_INFO",
  "READY",
  "PLANNED",
  "IN_PROGRESS",
  "REVIEW",
  "BLOCKED",
  "DONE",
  "CANCELLED",
]);

function normalizedStatus(rawState: string): NormalizedStatus {
  if (normalizedStatuses.has(rawState as NormalizedStatus)) return rawState as NormalizedStatus;
  throw new Error(`OPERATIONAL_PROJECTION_STATE_UNMAPPED:${rawState}`);
}

export class TypeOrmWorkManagementRepository
  implements WorkManagementRepository, ProjectRegistryQueryPort, OperationalProjectionQueryPort
{
  constructor(private readonly dataSource: DataSource) {}

  async projectRegistryStatus(
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectRegistryStatus | undefined> {
    const rows = (await this.dataSource.query(
      "SELECT id,state,row_version FROM projects WHERE workspace_id=$1 AND id=$2",
      [workspaceId, projectId],
    )) as Row[];
    const row = rows[0];
    if (!row) return undefined;
    return Object.freeze({
      workspaceId,
      projectId,
      lifecycleState: row.state === "ACTIVE" ? "ACTIVE" : "INACTIVE",
      // The Core project row is the current local registry revision. Alternate
      // registry adapters can expose NEEDS_REVIEW without importing a Pack.
      verificationState: "CURRENT",
      verificationRef: Object.freeze({ id: String(row.id), version: Number(row.row_version) }),
    });
  }

  async operationalProjection(
    workspaceId: string,
    projectId: string,
    workItemId: string,
  ): Promise<OperationalProjection | undefined> {
    const row = await new TypeOrmOperationalAuthorityRepository(
      this.dataSource,
    ).confirmedProjectionForWorkItem({ workspaceId, projectId }, workItemId);
    if (!row) return undefined;
    const rawExternalState = row.snapshot.rawStatus.name;
    return Object.freeze({
      workspaceId,
      projectId,
      workItemId,
      workTypeKey: row.workTypeKey,
      workTypeVersion: row.workTypeVersion,
      normalizedStatus: normalizedStatus(row.snapshot.normalizedStatus),
      rawExternalState,
      externalVersion: row.externalRevisionToken,
      resourceVersion: row.revision,
      projectionRef: Object.freeze({
        sourceType: "JIRA_OPERATIONAL_PROJECTION_REVISION" as const,
        sourceId: row.projectionId,
        sourceVersion: row.revision,
        semanticHash: row.authorityFieldsHash,
        observedAt: row.observedAt,
        confirmedAt: row.confirmedAt,
      }),
      mappingRef: row.mappingRef,
      freshness: row.freshness,
    });
  }
  async getEnablement(
    workspaceId: string,
    workTypeKey: string,
  ): Promise<WorkspaceWorkTypeState | undefined> {
    const rows = (await this.dataSource.query(
      `SELECT e.*,d.work_type_key,d.definition_version,d.definition_hash,d.intake_schema
      FROM workspace_work_types e JOIN work_type_definitions d ON d.id=e.active_definition_id
      WHERE e.workspace_id=$1 AND e.work_type_key=$2`,
      [workspaceId, workTypeKey],
    )) as Row[];
    const row = rows[0];
    if (!row) return undefined;
    const schema = parse<{
      readonly id: string;
      readonly version: number;
      readonly digest: `sha256:${string}`;
    }>(row.intake_schema);
    return {
      workspaceId: String(row.workspace_id),
      workTypeKey: String(row.work_type_key),
      definition: {
        id: String(row.active_definition_id),
        key: String(row.work_type_key),
        version: String(row.definition_version),
        definitionHash: String(row.definition_hash) as `sha256:${string}`,
        intakeSchemaRef: schema,
      },
      intakeState: row.intake_state === "ENABLED" ? "ENABLED" : "DISABLED",
      rowVersion: Number(row.row_version),
      changedBy: String(row.changed_by),
      changedAt: new Date(String(row.changed_at)),
      reason: String(row.reason),
    };
  }
  async saveEnablement(
    state: WorkspaceWorkTypeState,
    expectedVersion: number | undefined,
  ): Promise<void> {
    if (expectedVersion === undefined) {
      await this.dataSource.query(
        "INSERT INTO workspace_work_types(id,workspace_id,work_type_key,active_definition_id,intake_state,changed_by,changed_at,reason,row_version) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,1)",
        [
          state.workspaceId,
          state.workTypeKey,
          state.definition.id,
          state.intakeState,
          state.changedBy,
          state.changedAt,
          state.reason,
        ],
      );
      return;
    }
    const result = (await this.dataSource.query(
      "UPDATE workspace_work_types SET active_definition_id=$3,intake_state=$4,changed_by=$5,changed_at=$6,reason=$7,row_version=row_version+1 WHERE workspace_id=$1 AND work_type_key=$2 AND row_version=$8 RETURNING row_version",
      [
        state.workspaceId,
        state.workTypeKey,
        state.definition.id,
        state.intakeState,
        state.changedBy,
        state.changedAt,
        state.reason,
        expectedVersion,
      ],
    )) as Row[];
    if (result.length !== 1) throw new Error("OPTIMISTIC_CONCURRENCY_CONFLICT");
  }
  async insertDraft(draft: IntakeDraft): Promise<void> {
    await this.dataSource.query(
      "INSERT INTO intake_drafts(id,workspace_id,project_id,work_type_definition_id,created_by,state,intake_payload,intake_schema_ref,row_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        draft.id,
        draft.workspaceId,
        draft.projectId,
        draft.definition.id,
        draft.createdBy,
        draft.state,
        JSON.stringify(draft.payload.value),
        JSON.stringify(draft.payload.schemaRef),
        draft.rowVersion,
        draft.createdAt,
      ],
    );
  }
  async getDraft(
    workspaceId: string,
    projectId: string,
    draftId: string,
  ): Promise<IntakeDraft | undefined> {
    const rows = (await this.dataSource.query(
      `SELECT i.*,d.work_type_key,d.definition_version,d.definition_hash,d.intake_schema FROM intake_drafts i
      JOIN work_type_definitions d ON d.id=i.work_type_definition_id WHERE i.workspace_id=$1 AND i.project_id=$2 AND i.id=$3`,
      [workspaceId, projectId, draftId],
    )) as Row[];
    const row = rows[0];
    if (!row) return undefined;
    const schemaRef = parse<IntakeDraft["payload"]["schemaRef"]>(row.intake_schema_ref);
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      projectId: String(row.project_id),
      definition: {
        id: String(row.work_type_definition_id),
        key: String(row.work_type_key),
        version: String(row.definition_version),
        definitionHash: String(row.definition_hash) as `sha256:${string}`,
        intakeSchemaRef: parse(row.intake_schema),
      },
      createdBy: String(row.created_by),
      state: String(row.state) as IntakeDraft["state"],
      payload: { schemaRef, value: parse(row.intake_payload) },
      rowVersion: Number(row.row_version),
      createdAt: new Date(String(row.created_at)),
      ...(row.submitted_at ? { submittedAt: new Date(String(row.submitted_at)) } : {}),
    };
  }
  async submitDraft(
    draft: IntakeDraft,
    workItem: WorkItem,
    expectedVersion: number,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const updated = (await manager.query(
        "UPDATE intake_drafts SET state='SUBMITTED',submitted_at=$4,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND state='DRAFT' AND row_version=$5 RETURNING id",
        [draft.workspaceId, draft.projectId, draft.id, draft.submittedAt, expectedVersion],
      )) as Row[];
      if (updated.length !== 1) throw new Error("OPTIMISTIC_CONCURRENCY_CONFLICT");
      await manager.query(
        "INSERT INTO work_items(id,workspace_id,project_id,work_type_definition_id,source_draft_id,created_by,state,classification_key,row_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          workItem.id,
          workItem.workspaceId,
          workItem.projectId,
          workItem.definition.id,
          workItem.sourceDraftId,
          workItem.createdBy,
          workItem.state,
          workItem.classificationKey,
          workItem.rowVersion,
          workItem.createdAt,
        ],
      );
    });
  }
  async getWorkItem(
    workspaceId: string,
    projectId: string,
    workItemId: string,
  ): Promise<WorkItem | undefined> {
    const rows = (await this.dataSource.query(
      `SELECT w.*,d.work_type_key,d.definition_version,d.definition_hash,d.intake_schema FROM work_items w JOIN work_type_definitions d ON d.id=w.work_type_definition_id WHERE w.workspace_id=$1 AND w.project_id=$2 AND w.id=$3`,
      [workspaceId, projectId, workItemId],
    )) as Row[];
    const row = rows[0];
    return row
      ? {
          id: String(row.id),
          workspaceId: String(row.workspace_id),
          projectId: String(row.project_id),
          definition: {
            id: String(row.work_type_definition_id),
            key: String(row.work_type_key),
            version: String(row.definition_version),
            definitionHash: String(row.definition_hash) as `sha256:${string}`,
            intakeSchemaRef: parse(row.intake_schema),
          },
          sourceDraftId: String(row.source_draft_id),
          createdBy: String(row.created_by),
          state: row.state === "CLOSED" ? "CLOSED" : "OPEN",
          classificationKey: String(row.classification_key),
          rowVersion: Number(row.row_version),
          createdAt: new Date(String(row.created_at)),
        }
      : undefined;
  }

  async getWorkItemAuthorized(
    token: AuthorizedProjectQueryToken,
    projectId: string,
    workItemId: string,
  ): Promise<WorkItem | undefined> {
    token.assert(projectId, 0, "READ");
    return this.getWorkItem(token.workspaceId, projectId, workItemId);
  }
}
