import type { DataSource } from "typeorm";

import type { ResourceScope } from "@awp/platform-core";

import type { DummyRequest } from "../domain/dummy-request.ts";

type Row = Record<string, unknown>;
export interface DummyRequestRepository {
  insert(scope: Extract<ResourceScope, { kind: "PROJECT" }>, request: DummyRequest): Promise<void>;
  getByWorkItem(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    workItemId: string,
  ): Promise<DummyRequest | undefined>;
}

export class TypeOrmDummyRequestRepository implements DummyRequestRepository {
  constructor(private readonly dataSource: DataSource) {}
  async insert(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    request: DummyRequest,
  ): Promise<void> {
    if (request.workspaceId !== scope.workspaceId || request.projectId !== scope.projectId)
      throw new Error("CROSS_SCOPE_DUMMY_REQUEST");
    await this.dataSource.query(
      "INSERT INTO dummy_requests(id,workspace_id,project_id,work_item_id,sample_name,message,history,row_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        request.id,
        scope.workspaceId,
        scope.projectId,
        request.workItemId,
        request.sampleName,
        request.message,
        JSON.stringify(request.history),
        request.rowVersion,
        request.createdAt,
      ],
    );
  }
  async getByWorkItem(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    workItemId: string,
  ): Promise<DummyRequest | undefined> {
    const rows = (await this.dataSource.query(
      "SELECT * FROM dummy_requests WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3",
      [scope.workspaceId, scope.projectId, workItemId],
    )) as Row[];
    const row = rows[0];
    return row
      ? {
          id: String(row.id),
          workspaceId: String(row.workspace_id),
          projectId: String(row.project_id),
          workItemId: String(row.work_item_id),
          sampleName: String(row.sample_name),
          message: String(row.message),
          history: (Array.isArray(row.history) ? row.history : []) as DummyRequest["history"],
          rowVersion: Number(row.row_version),
          createdAt: new Date(String(row.created_at)),
        }
      : undefined;
  }
}
