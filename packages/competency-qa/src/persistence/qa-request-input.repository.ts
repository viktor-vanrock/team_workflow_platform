import { QaDomainError, type QaScope } from "../domain/primitives.ts";
import type { QaRequestInputRevision } from "../domain/qa-request-input-revision.ts";
import type { QaQueryExecutor } from "./repository-helpers.ts";

function rows<T>(value: unknown): readonly T[] {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly T[];
}
function json<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

export class QaRequestInputRepository {
  constructor(private readonly source: QaQueryExecutor) {}

  async get(
    scope: QaScope,
    workItemId: string,
    version: number,
  ): Promise<QaRequestInputRevision | undefined> {
    const result = await this.source.query(
      `SELECT content FROM qa_request_input_revisions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND version=$4`,
      [scope.workspaceId, scope.projectId, workItemId, version],
    );
    const row = rows<Readonly<{ content: unknown }>>(result)[0];
    return row === undefined ? undefined : json<QaRequestInputRevision>(row.content);
  }

  async history(scope: QaScope, workItemId: string): Promise<readonly QaRequestInputRevision[]> {
    const result = await this.source.query(
      `SELECT content FROM qa_request_input_revisions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY version`,
      [scope.workspaceId, scope.projectId, workItemId],
    );
    return Object.freeze(
      rows<Readonly<{ content: unknown }>>(result).map((row) =>
        json<QaRequestInputRevision>(row.content),
      ),
    );
  }

  async insert(executor: QaQueryExecutor, revision: QaRequestInputRevision): Promise<boolean> {
    const found = await executor.query(
      `SELECT content_hash AS "contentHash" FROM qa_request_input_revisions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND version=$4 FOR UPDATE`,
      [revision.workspaceId, revision.projectId, revision.workItemId, revision.version],
    );
    const existing = rows<Readonly<{ contentHash: string }>>(found)[0];
    if (existing) {
      if (existing.contentHash !== revision.contentHash)
        throw new QaDomainError("QA_REQUEST_INPUT_CONFIRMATION_CONFLICT");
      return true;
    }
    await executor.query(
      `
INSERT INTO qa_request_input_revisions(
  input_revision_id,workspace_id,project_id,work_item_id,version,previous_revision_id,previous_revision_version,previous_content_hash,
  definition_key,definition_version,accepted_draft_id,accepted_draft_version,accepted_draft_content_hash,
  external_request_id,external_request_version,external_request_content_hash,operational_binding_id,operational_binding_version,
  original_requester_ref,title,request_kind,data_classification_key,content_hash,content,recorded_by,authorization_basis_hash,
  recorded_at,correlation_id,causation_id
) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
      [
        revision.inputRevisionId,
        revision.workspaceId,
        revision.projectId,
        revision.workItemId,
        revision.version,
        revision.previousRevisionRef?.id ?? null,
        revision.previousRevisionRef?.version ?? null,
        revision.previousRevisionRef?.contentHash ?? null,
        revision.definitionRef.key,
        revision.definitionRef.version,
        revision.acceptedDraftRef.id,
        revision.acceptedDraftRef.version,
        revision.acceptedDraftRef.contentHash,
        revision.externalRequestRef.id,
        revision.externalRequestRef.version,
        revision.externalRequestRef.contentHash,
        revision.operationalBindingRef.id,
        revision.operationalBindingRef.version,
        revision.originalRequesterRef,
        revision.title,
        revision.requestKind,
        revision.dataClassificationKey,
        revision.contentHash,
        revision,
        revision.recordedBy,
        revision.authorizationBasisHash,
        revision.recordedAt,
        revision.correlationId,
        revision.causationId ?? null,
      ],
    );
    return false;
  }
}
