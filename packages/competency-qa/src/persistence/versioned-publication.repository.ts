import type { JsonValue } from "@awp/platform-contracts";

import { QaDomainError, type QaExactReference, type QaScope } from "../domain/primitives.ts";
import type { QaPublicationHeader, QaPublishedVersion } from "../domain/versioned-publication.ts";
import { assertQaSqlIdentifier } from "./migrations/scope-helpers.ts";
import type { QaQueryExecutor } from "./repository-helpers.ts";

interface HeaderRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly currentId: string | null;
  readonly currentVersion: number | null;
  readonly currentContentHash: `sha256:${string}` | null;
  readonly resourceVersion: number;
  readonly frozenAt: Date | string | null;
}

interface VersionRow<TContent extends JsonValue> {
  readonly id: string;
  readonly version: number;
  readonly contentHash: `sha256:${string}`;
  readonly headerId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly previousId: string | null;
  readonly previousVersion: number | null;
  readonly previousContentHash: `sha256:${string}` | null;
  readonly content: TContent;
  readonly publishedBy: JsonValue;
  readonly publishedAt: Date | string;
}

function quoted(value: string): string {
  assertQaSqlIdentifier(value);
  return `"${value}"`;
}

function rows<TResult>(result: unknown): readonly TResult[] {
  const raw = result as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly TResult[];
}

export class QaVersionedPublicationRepository<TContent extends JsonValue> {
  readonly #headerTable: string;
  readonly #versionTable: string;

  constructor(
    private readonly source: QaQueryExecutor,
    tables: Readonly<{ header: string; version: string }>,
  ) {
    assertQaSqlIdentifier(tables.header);
    assertQaSqlIdentifier(tables.version);
    this.#headerTable = tables.header;
    this.#versionTable = tables.version;
  }

  async getHeader(scope: QaScope, headerId: string): Promise<QaPublicationHeader | undefined> {
    const result = await this.source.query(
      `
SELECT id,
       workspace_id AS "workspaceId",
       project_id AS "projectId",
       current_published_version_id AS "currentId",
       current_published_version AS "currentVersion",
       current_published_content_hash AS "currentContentHash",
       resource_version AS "resourceVersion",
       frozen_at AS "frozenAt"
FROM ${quoted(this.#headerTable)}
WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
      [scope.workspaceId, scope.projectId, headerId],
    );
    const row = rows<HeaderRow>(result)[0];
    if (row === undefined) return undefined;
    const currentPublishedVersionRef = this.#reference(
      row.currentId,
      row.currentVersion,
      row.currentContentHash,
    );
    return Object.freeze({
      id: row.id,
      scope: Object.freeze({ workspaceId: row.workspaceId, projectId: row.projectId }),
      ...(currentPublishedVersionRef === undefined ? {} : { currentPublishedVersionRef }),
      resourceVersion: row.resourceVersion,
      ...(row.frozenAt === null ? {} : { frozenAt: new Date(row.frozenAt).toISOString() }),
    });
  }

  async getCurrent(
    scope: QaScope,
    headerId: string,
  ): Promise<QaPublishedVersion<TContent> | undefined> {
    const result = await this.source.query(
      `
SELECT version_row.id,
       version_row.version,
       version_row.content_hash AS "contentHash",
       version_row.header_id AS "headerId",
       version_row.workspace_id AS "workspaceId",
       version_row.project_id AS "projectId",
       version_row.previous_version_id AS "previousId",
       version_row.previous_version AS "previousVersion",
       version_row.previous_content_hash AS "previousContentHash",
       version_row.content,
       version_row.published_by AS "publishedBy",
       version_row.published_at AS "publishedAt"
FROM ${quoted(this.#headerTable)} header
JOIN ${quoted(this.#versionTable)} version_row
  ON version_row.workspace_id = header.workspace_id
 AND version_row.project_id = header.project_id
 AND version_row.header_id = header.id
 AND version_row.id = header.current_published_version_id
WHERE header.workspace_id = $1 AND header.project_id = $2 AND header.id = $3`,
      [scope.workspaceId, scope.projectId, headerId],
    );
    const row = rows<VersionRow<TContent>>(result)[0];
    return row === undefined ? undefined : this.#version(row);
  }

  async insertHeader(executor: QaQueryExecutor, header: QaPublicationHeader): Promise<void> {
    await executor.query(
      `
INSERT INTO ${quoted(this.#headerTable)} (
  id, workspace_id, project_id, resource_version
) VALUES ($1, $2, $3, $4)`,
      [header.id, header.scope.workspaceId, header.scope.projectId, header.resourceVersion],
    );
  }

  async insertVersionAndAdvance(
    executor: QaQueryExecutor,
    expectedHeaderResourceVersion: number,
    version: QaPublishedVersion<TContent>,
  ): Promise<number> {
    await executor.query(
      `
INSERT INTO ${quoted(this.#versionTable)} (
  id, workspace_id, project_id, header_id, version, content_hash,
  previous_version_id, previous_version, previous_content_hash,
  content, published_by, published_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        version.id,
        version.scope.workspaceId,
        version.scope.projectId,
        version.headerId,
        version.version,
        version.contentHash,
        version.previousVersionRef?.id ?? null,
        version.previousVersionRef?.version ?? null,
        version.previousVersionRef?.contentHash ?? null,
        version.content,
        version.publishedBy,
        version.publishedAt,
      ],
    );
    const result = await executor.query(
      `
UPDATE ${quoted(this.#headerTable)}
SET current_published_version_id = $1,
    current_published_version = $2,
    current_published_content_hash = $3,
    resource_version = resource_version + 1
WHERE workspace_id = $4 AND project_id = $5 AND id = $6
  AND resource_version = $7
RETURNING resource_version AS "resourceVersion"`,
      [
        version.id,
        version.version,
        version.contentHash,
        version.scope.workspaceId,
        version.scope.projectId,
        version.headerId,
        expectedHeaderResourceVersion,
      ],
    );
    const row = rows<Readonly<{ resourceVersion: number }>>(result)[0];
    if (row === undefined) throw new QaDomainError("OPTIMISTIC_CONCURRENCY_CONFLICT");
    return row.resourceVersion;
  }

  #reference(
    id: string | null,
    version: number | null,
    contentHash: `sha256:${string}` | null,
  ): QaExactReference | undefined {
    const values = [id, version, contentHash];
    if (values.every((value) => value === null)) return undefined;
    if (id === null || version === null || contentHash === null) {
      throw new QaDomainError("QA_PUBLICATION_POINTER_CORRUPT");
    }
    return Object.freeze({ id, version, contentHash });
  }

  #version(row: VersionRow<TContent>): QaPublishedVersion<TContent> {
    const previousVersionRef = this.#reference(
      row.previousId,
      row.previousVersion,
      row.previousContentHash,
    );
    return Object.freeze({
      id: row.id,
      version: row.version,
      contentHash: row.contentHash,
      headerId: row.headerId,
      scope: Object.freeze({ workspaceId: row.workspaceId, projectId: row.projectId }),
      ...(previousVersionRef === undefined ? {} : { previousVersionRef }),
      content: row.content,
      publishedBy: row.publishedBy as unknown as QaPublishedVersion<TContent>["publishedBy"],
      publishedAt: new Date(row.publishedAt).toISOString(),
    });
  }
}
