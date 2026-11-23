import { qaAggregateSnapshotHash, QaDomainError, type QaScope } from "../domain/primitives.ts";
import type { QaQueryExecutor } from "./repository-helpers.ts";

export interface QaStoredDefectProposal extends Readonly<Record<string, unknown>>, QaScope {
  readonly proposalId: string;
  readonly workItemId: string;
  readonly findingId: string;
  readonly frozenFindingReviewRef: Readonly<{ id: string; version: number; contentHash: string }>;
  readonly proposalHash: string;
  readonly generatedAt: string;
  readonly expiresAt: string;
}
export class QaDefectProposalRepository {
  constructor(private readonly source: QaQueryExecutor) {}
  async insert(
    proposal: QaStoredDefectProposal,
    context: Readonly<{
      sessionId: string;
      classificationKey: string;
      createdBy: string;
      authorizationBasisHash: string;
    }>,
  ): Promise<void> {
    this.assertHash(proposal);
    const ref = proposal.frozenFindingReviewRef;
    await this.source.query(
      `INSERT INTO qa_defect_draft_proposals(proposal_id,workspace_id,project_id,work_item_id,session_id,finding_id,review_id,review_version,review_hash,classification_key,created_by,authorization_basis_hash,created_at,expires_at,content,proposal_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        proposal.proposalId,
        proposal.workspaceId,
        proposal.projectId,
        proposal.workItemId,
        context.sessionId,
        proposal.findingId,
        ref.id,
        ref.version,
        ref.contentHash,
        context.classificationKey,
        context.createdBy,
        context.authorizationBasisHash,
        proposal.generatedAt,
        proposal.expiresAt,
        proposal,
        proposal.proposalHash,
      ],
    );
  }
  async get(
    scope: QaScope,
    workItemId: string,
    findingId: string,
    proposalId: string,
  ): Promise<QaStoredDefectProposal | undefined> {
    const rows = (await this.source.query(
      "SELECT content,proposal_hash FROM qa_defect_draft_proposals WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND finding_id=$4 AND proposal_id=$5",
      [scope.workspaceId, scope.projectId, workItemId, findingId, proposalId],
    )) as { content: QaStoredDefectProposal; proposal_hash: string }[];
    const row = rows[0];
    if (!row) return undefined;
    const proposal = row.content;
    if (
      proposal.proposalHash !== row.proposal_hash ||
      proposal.workspaceId !== scope.workspaceId ||
      proposal.projectId !== scope.projectId ||
      proposal.workItemId !== workItemId ||
      proposal.findingId !== findingId ||
      proposal.proposalId !== proposalId
    )
      throw new QaDomainError("QA_DEFECT_PROPOSAL_STALE_OR_MISMATCHED");
    this.assertHash(proposal);
    return proposal;
  }
  private assertHash(proposal: QaStoredDefectProposal): void {
    const body = Object.fromEntries(
      Object.entries(proposal).filter(([key]) => key !== "proposalHash"),
    );
    if (qaAggregateSnapshotHash(body as never) !== proposal.proposalHash)
      throw new QaDomainError("QA_DEFECT_PROPOSAL_STALE_OR_MISMATCHED");
  }
}
