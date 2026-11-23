import type { EntityManager } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import type { AuthorizedProjectQueryToken, ResourceScope } from "@awp/platform-core";

import { ScopedRepositoryBase } from "./scoped-repository-base.ts";

type Row = Record<string, unknown>;

const rowsOf = <T>(value: unknown): readonly T[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw?.[0]) ? raw[0] : raw) as readonly T[];
};

export function queueEntryInputFingerprint(
  input: Readonly<{
    sourceRefs: readonly unknown[];
    sourceSetHash: string;
    policyFacetRef: unknown;
    controlRef?: unknown;
    derivationRuleRef: unknown;
  }>,
): string {
  return sha256({
    sourceRefs: input.sourceRefs,
    sourceSetHash: input.sourceSetHash,
    policyFacetRef: input.policyFacetRef,
    controlRef: input.controlRef ?? null,
    derivationRuleRef: input.derivationRuleRef,
  } as JsonValue);
}

export class QueueProjectionRepository extends ScopedRepositoryBase {
  async currentRevisionAuthorized(
    token: AuthorizedProjectQueryToken,
    projectId: string,
    queueEntryId: string,
  ): Promise<Row | undefined> {
    token.assert(projectId, 0, "READ");
    return this.currentRevision(
      { kind: "PROJECT", workspaceId: token.workspaceId, projectId },
      queueEntryId,
    );
  }

  async currentRevision(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    queueEntryId: string,
  ): Promise<Row | undefined> {
    const rows = await this.projectRows<Row>(
      scope,
      "SELECT r.* FROM queue_entry_heads h JOIN queue_entry_revisions r ON r.workspace_id=h.workspace_id AND r.project_id=h.project_id AND r.queue_entry_revision_id=h.current_revision_id WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.queue_entry_id=$3 AND h.suppressed_by_work_item_id IS NULL",
      [queueEntryId],
    );
    return rows[0];
  }

  async currentActiveGenerationRevision(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    queueEntryId: string,
  ): Promise<Row | undefined> {
    const rows = await this.projectRows<Row>(
      scope,
      `SELECT revision.*
         FROM queue_entry_heads head
         JOIN queue_entry_revisions revision
           ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id
          AND revision.queue_entry_revision_id=head.current_revision_id
         JOIN queue_projection_generations generation
           ON generation.workspace_id=revision.workspace_id AND generation.generation_id=revision.generation_id
        WHERE head.workspace_id=$1 AND head.project_id=$2 AND head.queue_entry_id=$3
          AND head.suppressed_by_work_item_id IS NULL AND generation.state='ACTIVE'`,
      [queueEntryId],
    );
    return rows[0];
  }

  async revisionHistory(
    scope: Extract<ResourceScope, { kind: "PROJECT" }>,
    queueEntryId: string,
  ): Promise<readonly Row[]> {
    return this.projectRows<Row>(
      scope,
      "SELECT * FROM queue_entry_revisions WHERE workspace_id=$1 AND project_id=$2 AND queue_entry_id=$3 ORDER BY revision_number",
      [queueEntryId],
    );
  }

  async ensureHead(
    input: Readonly<{
      scope: Extract<ResourceScope, { kind: "PROJECT" }>;
      queueEntryId: string;
      subject: Readonly<
        | { kind: "CANDIDATE"; candidateId: string }
        | { kind: "DRAFT"; draftId: string }
        | { kind: "WORK_ITEM"; workItemId: string }
      >;
      createdAt: string;
    }>,
  ): Promise<Readonly<{ created: boolean; resourceVersion: number }>> {
    const candidateId = input.subject.kind === "CANDIDATE" ? input.subject.candidateId : null;
    const draftId = input.subject.kind === "DRAFT" ? input.subject.draftId : null;
    const workItemId = input.subject.kind === "WORK_ITEM" ? input.subject.workItemId : null;
    const rows = rowsOf<Readonly<{ inserted: boolean; resource_version: string | number }>>(
      await this.source.query(
        `WITH inserted AS (
         INSERT INTO queue_entry_heads(queue_entry_id,workspace_id,project_id,subject_kind,candidate_id,draft_id,work_item_id,current_revision_id,resource_version,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,NULL,0,$8,$8)
         ON CONFLICT(workspace_id,project_id,queue_entry_id) DO NOTHING
         RETURNING true AS inserted,resource_version
       )
       SELECT inserted,resource_version FROM inserted
       UNION ALL
       SELECT false,resource_version FROM queue_entry_heads
        WHERE workspace_id=$2 AND project_id=$3 AND queue_entry_id=$1 AND NOT EXISTS(SELECT 1 FROM inserted)`,
        [
          input.queueEntryId,
          input.scope.workspaceId,
          input.scope.projectId,
          input.subject.kind,
          candidateId,
          draftId,
          workItemId,
          input.createdAt,
        ],
      ),
    );
    if (rows.length !== 1) throw new Error("QUEUE_ENTRY_HEAD_CONFLICT");
    return Object.freeze({
      created: rows[0]!.inserted,
      resourceVersion: Number(rows[0]!.resource_version),
    });
  }

  async suppressPrecursor(
    input: Readonly<{
      scope: Extract<ResourceScope, { kind: "PROJECT" }>;
      precursorQueueEntryId: string;
      workItemQueueEntryId: string;
      workItemId: string;
      expectedPrecursorVersion: number;
    }>,
  ): Promise<void> {
    await this.source.transaction("SERIALIZABLE", async (manager) => {
      const target = rowsOf(
        await manager.query(
          "SELECT 1 FROM queue_entry_heads WHERE workspace_id=$1 AND project_id=$2 AND queue_entry_id=$3 AND subject_kind='WORK_ITEM' AND work_item_id=$4 AND suppressed_by_work_item_id IS NULL",
          [
            input.scope.workspaceId,
            input.scope.projectId,
            input.workItemQueueEntryId,
            input.workItemId,
          ],
        ),
      );
      if (target.length !== 1) throw new Error("QUEUE_ENTRY_SUPPRESSION_TARGET_NOT_FOUND");
      const updated = rowsOf(
        await manager.query(
          `UPDATE queue_entry_heads SET suppressed_by_work_item_id=$1,resource_version=resource_version+1,updated_at=clock_timestamp()
          WHERE workspace_id=$2 AND project_id=$3 AND queue_entry_id=$4 AND subject_kind IN('CANDIDATE','DRAFT')
            AND suppressed_by_work_item_id IS NULL AND resource_version=$5 RETURNING queue_entry_id`,
          [
            input.workItemId,
            input.scope.workspaceId,
            input.scope.projectId,
            input.precursorQueueEntryId,
            input.expectedPrecursorVersion,
          ],
        ),
      );
      if (updated.length !== 1) throw new Error("QUEUE_ENTRY_SUPPRESSION_CAS_CONFLICT");
    });
  }

  async appendRevision(
    input: Readonly<{
      scope: Extract<ResourceScope, { kind: "PROJECT" }>;
      queueEntryId: string;
      revisionId: string;
      generationId: string;
      expectedResourceVersion: number;
      previousRevisionId?: string;
      semanticHash: string;
      document: Readonly<Record<string, unknown>>;
      activateCurrent?: boolean;
      afterAppend?: (
        manager: EntityManager,
        revision: Readonly<{
          revisionId: string;
          revisionNumber: number;
          semanticHash: string;
          stage: string;
          previous?: Readonly<{
            revisionId: string;
            revisionNumber: number;
            semanticHash: string;
            stage: string;
          }>;
        }>,
      ) => Promise<void>;
    }>,
  ): Promise<
    Readonly<{ outcome: "APPENDED" | "NO_OP_UNCHANGED"; revision: number; semanticHash: string }>
  > {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const heads = (await manager.query(
        "SELECT current_revision_id,resource_version FROM queue_entry_heads WHERE workspace_id=$1 AND project_id=$2 AND queue_entry_id=$3 FOR UPDATE",
        [input.scope.workspaceId, input.scope.projectId, input.queueEntryId],
      )) as Row[];
      const head = heads[0];
      if (!head || Number(head.resource_version) !== input.expectedResourceVersion)
        throw new Error("QUEUE_ENTRY_CAS_CONFLICT");
      const activeCurrent = head.current_revision_id
        ? ((await manager.query(
            "SELECT queue_entry_revision_id,revision_number,semantic_hash,stage FROM queue_entry_revisions WHERE workspace_id=$1 AND project_id=$2 AND queue_entry_revision_id=$3",
            [input.scope.workspaceId, input.scope.projectId, head.current_revision_id],
          )) as Row[])
        : [];
      const shadowCurrent =
        input.activateCurrent === false
          ? ((await manager.query(
              "SELECT queue_entry_revision_id,revision_number,semantic_hash,stage FROM queue_entry_revisions WHERE workspace_id=$1 AND project_id=$2 AND queue_entry_id=$3 AND generation_id=$4 ORDER BY revision_number DESC LIMIT 1",
              [
                input.scope.workspaceId,
                input.scope.projectId,
                input.queueEntryId,
                input.generationId,
              ],
            )) as Row[])
          : [];
      const current = shadowCurrent.length > 0 ? shadowCurrent : activeCurrent;
      if (
        (input.activateCurrent !== false || shadowCurrent.length > 0) &&
        current[0]?.semantic_hash === input.semanticHash
      ) {
        return Object.freeze({
          outcome: "NO_OP_UNCHANGED" as const,
          revision: Number(current[0].revision_number),
          semanticHash: input.semanticHash,
        });
      }
      if ((current[0]?.queue_entry_revision_id ?? undefined) !== input.previousRevisionId)
        throw new Error("QUEUE_ENTRY_PREVIOUS_REVISION_MISMATCH");
      const sequenceRows = (await manager.query(
        "SELECT COALESCE(max(revision_number),0) AS revision_number FROM queue_entry_revisions WHERE workspace_id=$1 AND project_id=$2 AND queue_entry_id=$3",
        [input.scope.workspaceId, input.scope.projectId, input.queueEntryId],
      )) as Row[];
      const revision = Number(sequenceRows[0]?.revision_number ?? 0) + 1;
      const value = input.document;
      if (
        !/^sha256:[a-f0-9]{64}$/u.test(input.semanticHash) ||
        !/^sha256:[a-f0-9]{64}$/u.test(String(value.sourceSetHash)) ||
        !/^sha256:[a-f0-9]{64}$/u.test(String(value.inputFingerprint))
      )
        throw new Error("QUEUE_ENTRY_REVISION_HASH_INVALID");
      const subject = value.subject as Readonly<Record<string, unknown>> | undefined;
      const subjectKind = String(value.subjectKind ?? subject?.kind ?? "");
      await manager.query(
        "INSERT INTO queue_entry_revisions(queue_entry_revision_id,queue_entry_id,generation_id,workspace_id,project_id,revision_number,previous_revision_id,subject_kind,subject_ref,stage,stage_details,stage_reason_codes,operational_facet,qa_facet,control_facet,capacity_facet,sla_facet,ordering_facet,consistency_warnings,freshness,source_refs,source_set_hash,policy_facet_ref,derivation_rule_ref,input_fingerprint,calculated_at,reconciled_at,semantic_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)",
        [
          input.revisionId,
          input.queueEntryId,
          input.generationId,
          input.scope.workspaceId,
          input.scope.projectId,
          revision,
          input.previousRevisionId ?? null,
          subjectKind,
          JSON.stringify(value.subject),
          value.stage,
          JSON.stringify(value.stageDetails),
          JSON.stringify(value.stageReasonCodes),
          JSON.stringify(value.operational),
          JSON.stringify(value.qa),
          JSON.stringify(value.control),
          JSON.stringify(value.capacity),
          JSON.stringify(value.sla),
          JSON.stringify(value.ordering),
          JSON.stringify(value.consistencyWarnings),
          JSON.stringify(value.freshness),
          JSON.stringify(value.sourceRefs),
          value.sourceSetHash,
          JSON.stringify(value.policyFacetRef),
          JSON.stringify(value.derivationRuleRef),
          value.inputFingerprint,
          value.calculatedAt,
          value.reconciledAt ?? null,
          input.semanticHash,
        ],
      );
      if (input.activateCurrent !== false) {
        const updated = rowsOf(
          await manager.query(
            "UPDATE queue_entry_heads SET current_revision_id=$4,resource_version=resource_version+1,updated_at=clock_timestamp() WHERE workspace_id=$1 AND project_id=$2 AND queue_entry_id=$3 AND resource_version=$5 RETURNING queue_entry_id",
            [
              input.scope.workspaceId,
              input.scope.projectId,
              input.queueEntryId,
              input.revisionId,
              input.expectedResourceVersion,
            ],
          ),
        );
        if (updated.length !== 1) throw new Error("QUEUE_ENTRY_CAS_CONFLICT");
      }
      await input.afterAppend?.(
        manager,
        Object.freeze({
          revisionId: input.revisionId,
          revisionNumber: revision,
          semanticHash: input.semanticHash,
          stage: String(value.stage),
          ...(current[0] === undefined
            ? {}
            : {
                previous: Object.freeze({
                  revisionId: String(current[0].queue_entry_revision_id),
                  revisionNumber: Number(current[0].revision_number),
                  semanticHash: String(current[0].semantic_hash),
                  stage: String(current[0].stage),
                }),
              }),
        }),
      );
      return Object.freeze({
        outcome: "APPENDED" as const,
        revision,
        semanticHash: input.semanticHash,
      });
    });
  }

  async activateRevision(
    input: Readonly<{
      scope: Extract<ResourceScope, { kind: "PROJECT" }>;
      queueEntryId: string;
      revisionId: string;
      generationId: string;
      expectedResourceVersion: number;
    }>,
  ): Promise<void> {
    const result = rowsOf(
      await this.source.query(
        `UPDATE queue_entry_heads head
          SET current_revision_id=$1,resource_version=resource_version+1,updated_at=clock_timestamp()
         FROM queue_entry_revisions revision,queue_projection_generations generation
        WHERE head.workspace_id=$2 AND head.project_id=$3 AND head.queue_entry_id=$4 AND head.resource_version=$5
          AND revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id
          AND revision.queue_entry_id=head.queue_entry_id AND revision.queue_entry_revision_id=$1
          AND revision.generation_id=$6 AND generation.workspace_id=head.workspace_id
          AND generation.generation_id=$6 AND generation.state='ACTIVE'
        RETURNING head.queue_entry_id`,
        [
          input.revisionId,
          input.scope.workspaceId,
          input.scope.projectId,
          input.queueEntryId,
          input.expectedResourceVersion,
          input.generationId,
        ],
      ),
    );
    if (result.length !== 1) throw new Error("QUEUE_ENTRY_ACTIVATION_CAS_CONFLICT");
  }
}
