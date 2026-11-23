import type { EntityManager } from "typeorm";

import type { QaDefectDraftAggregate } from "../domain/defect-publication.ts";
import { QaDomainError } from "../domain/primitives.ts";

type Row = Readonly<Record<string, unknown>>;
const rows = (value: unknown): readonly Row[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Row[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

export class TypeOrmDefectPublicationRepository {
  constructor(private readonly manager: EntityManager) {}
  async saveDraft(draft: QaDefectDraftAggregate, at = draft.createdAt): Promise<void> {
    await this.manager.query(
      "INSERT INTO qa_defect_drafts(defect_draft_id,workspace_id,project_id,work_item_id,session_id,finding_id,frozen_finding_review_id,version,predecessor_draft_id,predecessor_terminal_state,replacement_reason,state,payload,provenance,content_hash,accepted_by,accepted_at,rejection_reason,rejected_by,rejected_at,binding_ref,profile_refs,approval_ref,command_ref,effect_key_hash,defect_link_id,terminal_from_state,invalidation_reason,failure_code,terminal_reason,resource_version,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34)",
      [
        draft.defectDraftId,
        draft.workspaceId,
        draft.projectId,
        draft.workItemId,
        draft.sessionId,
        draft.findingId,
        draft.frozenFindingReviewRef.id,
        draft.version,
        draft.predecessorDraftRef?.id ?? null,
        draft.predecessorDraftRef ? "INVALIDATED" : null,
        draft.predecessorDraftRef ? "Human wording replacement" : null,
        draft.state,
        JSON.stringify(draft.payload),
        JSON.stringify(draft.provenance),
        draft.contentHash,
        draft.acceptedBy ? JSON.stringify(draft.acceptedBy) : null,
        draft.acceptedAt ?? null,
        draft.rejectionReason ?? null,
        null,
        null,
        draft.bindingRef ? JSON.stringify(draft.bindingRef) : null,
        draft.profileRefs ? JSON.stringify(draft.profileRefs) : null,
        draft.approvalRef ? JSON.stringify(draft.approvalRef) : null,
        draft.commandRef ? JSON.stringify(draft.commandRef) : null,
        draft.effectKeyHash ?? null,
        draft.defectLinkId ?? null,
        draft.terminalFromState ?? null,
        draft.invalidationReason ?? null,
        draft.failureCode ?? null,
        draft.terminalReason ?? null,
        draft.resourceVersion,
        JSON.stringify(draft.createdBy),
        draft.createdAt,
        at,
      ],
    );
  }
  async persistProjection(
    draft: QaDefectDraftAggregate,
    expectedResourceVersion: number,
    at: string,
  ): Promise<void> {
    const changed = rows(
      await this.manager.query(
        "UPDATE qa_defect_drafts SET state=$1,accepted_by=$2,accepted_at=$3,rejection_reason=$4,binding_ref=$5,profile_refs=$6,approval_ref=$7,command_ref=$8,effect_key_hash=$9,defect_link_id=$10,terminal_from_state=$11,invalidation_reason=$12,failure_code=$13,terminal_reason=$14,resource_version=$15,updated_at=$16 WHERE defect_draft_id=$17 AND workspace_id=$18 AND project_id=$19 AND resource_version=$20 RETURNING defect_draft_id",
        [
          draft.state,
          draft.acceptedBy ? JSON.stringify(draft.acceptedBy) : null,
          draft.acceptedAt ?? null,
          draft.rejectionReason ?? null,
          draft.bindingRef ? JSON.stringify(draft.bindingRef) : null,
          draft.profileRefs ? JSON.stringify(draft.profileRefs) : null,
          draft.approvalRef ? JSON.stringify(draft.approvalRef) : null,
          draft.commandRef ? JSON.stringify(draft.commandRef) : null,
          draft.effectKeyHash ?? null,
          draft.defectLinkId ?? null,
          draft.terminalFromState ?? null,
          draft.invalidationReason ?? null,
          draft.failureCode ?? null,
          draft.terminalReason ?? null,
          draft.resourceVersion,
          at,
          draft.defectDraftId,
          draft.workspaceId,
          draft.projectId,
          expectedResourceVersion,
        ],
      ),
    );
    if (!changed[0]) throw new QaDomainError("QA_DEFECT_DRAFT_STALE_VERSION");
  }
  async drafts(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    findingId: string,
  ): Promise<readonly Row[]> {
    return rows(
      await this.manager.query(
        "SELECT * FROM qa_defect_drafts WHERE workspace_id=$1 AND project_id=$2 AND finding_id=$3 ORDER BY version",
        [scope.workspaceId, scope.projectId, findingId],
      ),
    ).map((row) =>
      Object.freeze({ ...row, payload: json(row.payload), provenance: json(row.provenance) }),
    );
  }
  async links(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    workItemId: string,
  ): Promise<readonly Row[]> {
    return rows(
      await this.manager.query(
        "SELECT * FROM qa_defect_links WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY linked_at,defect_link_id",
        [scope.workspaceId, scope.projectId, workItemId],
      ),
    );
  }
}
