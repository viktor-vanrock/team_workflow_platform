import type { PackOwnedTransaction } from "@awp/competency-sdk";

import type { QaIntakeConfirmationWriter } from "../application/on-qa-request-confirmed.ts";
import { QaDomainError, type QaScope } from "../domain/primitives.ts";
import type { QaRequestExtension } from "../domain/qa-request.ts";
import { QaRequestInputRepository } from "./qa-request-input.repository.ts";
import type { QaQueryExecutor } from "./repository-helpers.ts";

type Row = Readonly<{ content: unknown; contentHash: string }>;
function rows<T>(value: unknown): readonly T[] {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly T[];
}
function json<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

export class QaRequestRepository {
  constructor(private readonly source: QaQueryExecutor) {}

  async byWorkItem(scope: QaScope, workItemId: string): Promise<QaRequestExtension | undefined> {
    const result = await this.source.query(
      `SELECT content,content_hash AS "contentHash" FROM qa_request_extensions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3`,
      [scope.workspaceId, scope.projectId, workItemId],
    );
    const row = rows<Row>(result)[0];
    return row === undefined ? undefined : json<QaRequestExtension>(row.content);
  }

  async confirmedBacklog(scope: QaScope): Promise<readonly QaRequestExtension[]> {
    const result = await this.source.query(
      `SELECT content FROM qa_request_extensions WHERE workspace_id=$1 AND project_id=$2 ORDER BY created_at,extension_id`,
      [scope.workspaceId, scope.projectId],
    );
    return Object.freeze(
      rows<Readonly<{ content: unknown }>>(result).map((row) =>
        json<QaRequestExtension>(row.content),
      ),
    );
  }

  async insert(executor: QaQueryExecutor, extension: QaRequestExtension): Promise<boolean> {
    const existingResult = await executor.query(
      `SELECT content_hash AS "contentHash" FROM qa_request_extensions WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 FOR UPDATE`,
      [extension.workspaceId, extension.projectId, extension.workItemId],
    );
    const existing = rows<Readonly<{ contentHash: string }>>(existingResult)[0];
    if (existing) {
      if (existing.contentHash !== extension.contentHash)
        throw new QaDomainError("QA_REQUEST_CONFIRMATION_CONFLICT");
      return true;
    }
    await executor.query(
      `
INSERT INTO qa_request_extensions(
  extension_id,workspace_id,project_id,work_item_id,current_input_revision_id,current_input_version,current_input_content_hash,
  project_context_id,project_context_version,project_context_content_hash,dor_rule_set_ref,dod_rule_set_ref,evidence_policy_ref,
  risk_review_policy_ref,adjudicative_aggregate_hash,completion_dispatch_guard,resource_version,content_hash,content,created_by,
  created_at,updated_at,correlation_id
) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        extension.extensionId,
        extension.workspaceId,
        extension.projectId,
        extension.workItemId,
        extension.currentRequestInputRevisionRef.id,
        extension.currentRequestInputRevisionRef.version,
        extension.currentRequestInputRevisionRef.contentHash,
        extension.projectContextRef.id,
        extension.projectContextRef.version,
        extension.projectContextRef.contentHash,
        extension.dorRuleSetRef,
        extension.dodRuleSetRef,
        extension.evidencePolicyRef,
        extension.riskReviewPolicyRef,
        extension.adjudicativeAggregateHash,
        extension.completionDispatchGuard,
        extension.resourceVersion,
        extension.contentHash,
        extension,
        extension.createdBy,
        extension.createdAt,
        extension.updatedAt,
        extension.correlationId,
      ],
    );
    return false;
  }
}

export class QaTypeOrmIntakeConfirmationWriter implements QaIntakeConfirmationWriter {
  async persist(
    transaction: PackOwnedTransaction,
    input: Parameters<QaIntakeConfirmationWriter["persist"]>[1],
  ) {
    const executor = transaction.native as Partial<QaQueryExecutor>;
    if (typeof executor.query !== "function")
      throw new QaDomainError("QA_PACK_TRANSACTION_REQUIRED");
    const queryExecutor = executor as QaQueryExecutor;
    const inputReplayed = await new QaRequestInputRepository(queryExecutor).insert(
      queryExecutor,
      input.initialInput,
    );
    const extensionReplayed = await new QaRequestRepository(queryExecutor).insert(
      queryExecutor,
      input.extension,
    );
    if (inputReplayed !== extensionReplayed)
      throw new QaDomainError("QA_CONFIRMATION_PARTIAL_REPLAY_FORBIDDEN");
    return Object.freeze({ replayed: inputReplayed });
  }
}
