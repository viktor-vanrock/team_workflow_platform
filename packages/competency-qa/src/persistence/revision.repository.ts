import type { JsonValue } from "@awp/platform-contracts";

import { QaDomainError, type QaScope } from "../domain/primitives.ts";
import { assertQaSqlIdentifier } from "./migrations/scope-helpers.ts";
import type { QaQueryExecutor } from "./repository-helpers.ts";

export interface QaAppendOnlyRevision<TContent extends JsonValue> {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly version: number;
  readonly contentHash: `sha256:${string}`;
  readonly previousVersion?: number;
  readonly previousContentHash?: `sha256:${string}`;
  readonly content: TContent;
  readonly createdBy: string;
  readonly createdAt: string;
}

interface RevisionRow<TContent extends JsonValue> {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly version: number;
  readonly contentHash: `sha256:${string}`;
  readonly previousVersion: number | null;
  readonly previousContentHash: `sha256:${string}` | null;
  readonly content: TContent;
  readonly createdBy: string;
  readonly createdAt: Date | string;
}

function quoted(value: string): string {
  assertQaSqlIdentifier(value);
  return `"${value}"`;
}

function rows<TResult>(result: unknown): readonly TResult[] {
  const raw = result as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly TResult[];
}

export class QaAppendOnlyRevisionRepository<TContent extends JsonValue> {
  readonly #tableName: string;

  constructor(
    private readonly source: QaQueryExecutor,
    tableName: string,
  ) {
    assertQaSqlIdentifier(tableName);
    this.#tableName = tableName;
  }

  async get(
    scope: QaScope,
    id: string,
    version: number,
  ): Promise<QaAppendOnlyRevision<TContent> | undefined> {
    const result = await this.source.query(
      `${this.#selectSql()}
WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND version = $4`,
      [scope.workspaceId, scope.projectId, id, version],
    );
    const row = rows<RevisionRow<TContent>>(result)[0];
    return row === undefined ? undefined : this.#map(row);
  }

  async history(scope: QaScope, id: string): Promise<readonly QaAppendOnlyRevision<TContent>[]> {
    const result = await this.source.query(
      `${this.#selectSql()}
WHERE workspace_id = $1 AND project_id = $2 AND id = $3
ORDER BY version ASC`,
      [scope.workspaceId, scope.projectId, id],
    );
    return Object.freeze(rows<RevisionRow<TContent>>(result).map((row) => this.#map(row)));
  }

  async insert(
    executor: QaQueryExecutor,
    scope: QaScope,
    revision: QaAppendOnlyRevision<TContent>,
  ): Promise<void> {
    if (revision.workspaceId !== scope.workspaceId || revision.projectId !== scope.projectId) {
      throw new QaDomainError("QA_SCOPE_MISMATCH");
    }
    const hasPrevious =
      revision.previousVersion !== undefined || revision.previousContentHash !== undefined;
    if (
      (revision.version === 1 && hasPrevious) ||
      (revision.version > 1 &&
        (revision.previousVersion !== revision.version - 1 ||
          revision.previousContentHash === undefined))
    ) {
      throw new QaDomainError("QA_REVISION_CHAIN_INVALID");
    }
    await executor.query(
      `
INSERT INTO ${quoted(this.#tableName)} (
  id, workspace_id, project_id, version, content_hash,
  previous_version, previous_content_hash, content, created_by, created_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        revision.id,
        scope.workspaceId,
        scope.projectId,
        revision.version,
        revision.contentHash,
        revision.previousVersion ?? null,
        revision.previousContentHash ?? null,
        revision.content,
        revision.createdBy,
        revision.createdAt,
      ],
    );
  }

  #selectSql(): string {
    return `SELECT id,
       workspace_id AS "workspaceId",
       project_id AS "projectId",
       version,
       content_hash AS "contentHash",
       previous_version AS "previousVersion",
       previous_content_hash AS "previousContentHash",
       content,
       created_by AS "createdBy",
       created_at AS "createdAt"
FROM ${quoted(this.#tableName)}`;
  }

  #map(row: RevisionRow<TContent>): QaAppendOnlyRevision<TContent> {
    const hasPrevious = row.previousVersion !== null || row.previousContentHash !== null;
    if (hasPrevious && (row.previousVersion === null || row.previousContentHash === null)) {
      throw new QaDomainError("QA_REVISION_POINTER_CORRUPT");
    }
    return Object.freeze({
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      version: row.version,
      contentHash: row.contentHash,
      ...(row.previousVersion === null ? {} : { previousVersion: row.previousVersion }),
      ...(row.previousContentHash === null ? {} : { previousContentHash: row.previousContentHash }),
      content: row.content,
      createdBy: row.createdBy,
      createdAt: new Date(row.createdAt).toISOString(),
    });
  }
}
