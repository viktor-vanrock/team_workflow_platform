import type { DataSource, EntityManager } from "typeorm";

import { qaQueueFactKindFor, type QaQueueFacts } from "../application/queue-facts.ts";
import type { QaScope } from "../domain/primitives.ts";

export interface QaQueueFactRevisionRecord {
  readonly revisionId: string;
  readonly headId: string;
  readonly revisionNumber: number;
  readonly semanticHash: string;
  readonly facts: QaQueueFacts;
}

export interface AppendQaQueueFactsInput {
  readonly scope: QaScope;
  readonly workItemId: string;
  readonly headId: string;
  readonly revisionId: string;
  readonly semanticHash: string;
  readonly facts: QaQueueFacts;
  readonly recordedAt: Date;
  readonly correlationId: string;
  readonly causationId: string;
  readonly afterAppend?: (
    manager: EntityManager,
    record: QaQueueFactRevisionRecord,
  ) => Promise<void>;
}

const rowsOf = <T>(value: unknown): readonly T[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw?.[0]) ? raw[0] : raw) as readonly T[];
};

export class TypeOrmQaQueueFactRepository {
  constructor(private readonly source: DataSource) {}

  async appendIfChanged(input: AppendQaQueueFactsInput): Promise<
    Readonly<{
      changed: boolean;
      record: QaQueueFactRevisionRecord;
    }>
  > {
    if (
      input.scope.workspaceId !== input.facts.workspaceId ||
      input.scope.projectId !== input.facts.projectId ||
      input.workItemId !== input.facts.workItemId ||
      (input.semanticHash !== input.facts.sourceSetHash && input.semanticHash.length === 0)
    )
      throw new Error("QA_QUEUE_FACT_SCOPE_OR_HASH_INVALID");

    return this.source.transaction("SERIALIZABLE", async (manager) => {
      const existingRows = rowsOf<
        Readonly<{
          qa_queue_fact_head_id: string;
          current_revision_id: string;
          current_revision_number: number;
          current_semantic_hash: string;
          resource_version: string | number;
        }>
      >(
        await manager.query(
          `SELECT qa_queue_fact_head_id,current_revision_id,current_revision_number,current_semantic_hash,resource_version
           FROM qa_queue_fact_heads
          WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3
          FOR UPDATE`,
          [input.scope.workspaceId, input.scope.projectId, input.workItemId],
        ),
      );
      const existing = existingRows[0];
      if (existing?.current_semantic_hash === input.semanticHash) {
        const revisionRows = rowsOf<Readonly<{ facts: QaQueueFacts }>>(
          await manager.query(
            `SELECT facts FROM qa_queue_fact_revisions
            WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND qa_queue_fact_revision_id=$4`,
            [
              input.scope.workspaceId,
              input.scope.projectId,
              input.workItemId,
              existing.current_revision_id,
            ],
          ),
        );
        return Object.freeze({
          changed: false,
          record: Object.freeze({
            revisionId: existing.current_revision_id,
            headId: existing.qa_queue_fact_head_id,
            revisionNumber: existing.current_revision_number,
            semanticHash: existing.current_semantic_hash,
            facts: revisionRows[0]?.facts ?? input.facts,
          }),
        });
      }

      const headId = existing?.qa_queue_fact_head_id ?? input.headId;
      const revisionNumber = existing === undefined ? 1 : existing.current_revision_number + 1;
      if (existing === undefined) {
        await manager.query(
          `INSERT INTO qa_queue_fact_heads(qa_queue_fact_head_id,workspace_id,project_id,work_item_id,current_revision_id,current_revision_number,current_semantic_hash,resource_version,created_at,updated_at)
           VALUES($1,$2,$3,$4,$5,1,$6,1,$7,$7)`,
          [
            headId,
            input.scope.workspaceId,
            input.scope.projectId,
            input.workItemId,
            input.revisionId,
            input.semanticHash,
            input.recordedAt,
          ],
        );
      }
      await manager.query(
        `INSERT INTO qa_queue_fact_revisions(qa_queue_fact_revision_id,qa_queue_fact_head_id,workspace_id,project_id,work_item_id,revision_number,previous_revision_id,previous_revision_number,previous_semantic_hash,facts,source_set_hash,semantic_hash,recorded_at,correlation_id,causation_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          input.revisionId,
          headId,
          input.scope.workspaceId,
          input.scope.projectId,
          input.workItemId,
          revisionNumber,
          existing?.current_revision_id ?? null,
          existing?.current_revision_number ?? null,
          existing?.current_semantic_hash ?? null,
          JSON.stringify(input.facts),
          input.facts.sourceSetHash,
          input.semanticHash,
          input.recordedAt,
          input.correlationId,
          input.causationId,
        ],
      );
      await manager.query(
        `DELETE FROM qa_queue_fact_current_indexes WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3`,
        [input.scope.workspaceId, input.scope.projectId, input.workItemId],
      );
      const indexed = input.facts.sourceRefs.flatMap((ref) => {
        const factKind = qaQueueFactKindFor(ref);
        return factKind === undefined ? [] : [{ ref, factKind }];
      });
      for (const [ordinal, value] of indexed.entries()) {
        await manager.query(
          `INSERT INTO qa_queue_fact_current_indexes(qa_queue_fact_head_id,workspace_id,project_id,work_item_id,current_revision_id,fact_kind,fact_id,fact_revision,fact_semantic_hash,ordinal)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            headId,
            input.scope.workspaceId,
            input.scope.projectId,
            input.workItemId,
            input.revisionId,
            value.factKind,
            value.ref.sourceId,
            String(value.ref.sourceVersion),
            value.ref.semanticHash,
            ordinal,
          ],
        );
      }
      if (existing !== undefined) {
        const updated = rowsOf(
          await manager.query(
            `UPDATE qa_queue_fact_heads
              SET current_revision_id=$1,current_revision_number=$2,current_semantic_hash=$3,resource_version=resource_version+1,updated_at=$4
            WHERE workspace_id=$5 AND project_id=$6 AND work_item_id=$7 AND resource_version=$8
            RETURNING qa_queue_fact_head_id`,
            [
              input.revisionId,
              revisionNumber,
              input.semanticHash,
              input.recordedAt,
              input.scope.workspaceId,
              input.scope.projectId,
              input.workItemId,
              existing.resource_version,
            ],
          ),
        );
        if (updated.length !== 1) throw new Error("QA_QUEUE_FACT_CAS_CONFLICT");
      }
      const record = Object.freeze({
        revisionId: input.revisionId,
        headId,
        revisionNumber,
        semanticHash: input.semanticHash,
        facts: input.facts,
      });
      await input.afterAppend?.(manager, record);
      return Object.freeze({ changed: true, record });
    });
  }

  async current(
    scope: QaScope,
    workItemId: string,
  ): Promise<QaQueueFactRevisionRecord | undefined> {
    const rows = rowsOf<
      Readonly<{
        qa_queue_fact_revision_id: string;
        qa_queue_fact_head_id: string;
        revision_number: number;
        semantic_hash: string;
        facts: QaQueueFacts | string;
      }>
    >(
      await this.source.query(
        `SELECT revision.qa_queue_fact_revision_id,revision.qa_queue_fact_head_id,revision.revision_number,revision.semantic_hash,revision.facts
         FROM qa_queue_fact_heads head
         JOIN qa_queue_fact_revisions revision ON revision.qa_queue_fact_revision_id=head.current_revision_id
        WHERE head.workspace_id=$1 AND head.project_id=$2 AND head.work_item_id=$3`,
        [scope.workspaceId, scope.projectId, workItemId],
      ),
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    return Object.freeze({
      revisionId: row.qa_queue_fact_revision_id,
      headId: row.qa_queue_fact_head_id,
      revisionNumber: row.revision_number,
      semanticHash: row.semantic_hash,
      facts: typeof row.facts === "string" ? (JSON.parse(row.facts) as QaQueueFacts) : row.facts,
    });
  }
}
