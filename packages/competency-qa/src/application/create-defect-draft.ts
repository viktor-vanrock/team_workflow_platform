import { randomUUID } from "node:crypto";

import type { EntityManager } from "typeorm";

import { qaAggregateSnapshotHash, QaDomainError, type QaHumanActor } from "../domain/primitives.ts";

type Row = Readonly<Record<string, unknown>>;
const rows = (value: unknown): readonly Row[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Row[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

export interface QaStoredDefectDraft {
  readonly defectDraftId: string;
  readonly findingId: string;
  readonly version: number;
  readonly state: string;
  readonly resourceVersion: number;
  readonly contentHash: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly provenance: Readonly<Record<string, unknown>>;
  readonly predecessorDraftRef?: Readonly<{ id: string; version: number; contentHash: string }>;
}

export class TypeOrmCreateDefectDraftService {
  constructor(private readonly manager: EntityManager) {}

  async create(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      workItemId: string;
      findingId: string;
      source: "DETERMINISTIC_TEMPLATE" | "MODEL_PROPOSAL" | "DETERMINISTIC_FALLBACK";
      acceptedProposal?: Readonly<Record<string, unknown>>;
      actor: QaHumanActor;
      at: string;
    }>,
  ): Promise<QaStoredDefectDraft> {
    const finding = rows(
      await this.manager.query(
        "SELECT f.*,r.* FROM qa_findings f JOIN qa_finding_review_revisions r ON r.finding_review_revision_id=f.frozen_review_revision_id WHERE f.workspace_id=$1 AND f.project_id=$2 AND f.work_item_id=$3 AND f.finding_id=$4 FOR UPDATE OF f,r",
        [input.workspaceId, input.projectId, input.workItemId, input.findingId],
      ),
    )[0];
    if (!finding) throw new QaDomainError("QA_FROZEN_FINDING_NOT_FOUND");
    if (
      finding.state !== "FROZEN" ||
      finding.stage !== "FROZEN" ||
      finding.classification !== "PRODUCT" ||
      finding.disposition_decision !== "CREATE_DEFECT"
    ) {
      throw new QaDomainError("QA_DEFECT_DRAFT_PRODUCT_CREATE_DEFECT_REQUIRED");
    }
    if (input.acceptedProposal) {
      const proposal = input.acceptedProposal;
      const ref = proposal.frozenFindingReviewRef as
        Readonly<{ id?: string; version?: number; contentHash?: string }> | undefined;
      if (
        proposal.workspaceId !== input.workspaceId ||
        proposal.projectId !== input.projectId ||
        proposal.workItemId !== input.workItemId ||
        proposal.findingId !== input.findingId ||
        !ref ||
        ref.id !== finding.finding_review_revision_id ||
        ref.version !== Number(finding.version) ||
        ref.contentHash !== finding.content_hash ||
        proposal.source !== input.source ||
        typeof proposal.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(proposal.expiresAt)) ||
        Date.parse(proposal.expiresAt) <= Date.parse(input.at)
      )
        throw new QaDomainError("QA_DEFECT_PROPOSAL_STALE_OR_MISMATCHED");
    }
    const predecessor = rows(
      await this.manager.query(
        "SELECT defect_draft_id,version,state,content_hash,defect_link_id FROM qa_defect_drafts WHERE workspace_id=$1 AND project_id=$2 AND finding_id=$3 ORDER BY version DESC LIMIT 1 FOR UPDATE",
        [input.workspaceId, input.projectId, input.findingId],
      ),
    )[0];
    if (
      predecessor &&
      (predecessor.state === "LINKED" ||
        predecessor.state === "REJECTED" ||
        predecessor.defect_link_id)
    )
      throw new QaDomainError("QA_DEFECT_DRAFT_CHAIN_FINAL");
    if (predecessor && predecessor.state !== "FAILED" && predecessor.state !== "INVALIDATED")
      throw new QaDomainError("QA_DEFECT_DRAFT_ACTIVE_HEAD_EXISTS");

    const evidence = rows(
      await this.manager.query(
        `SELECT DISTINCT e.evidence_link_id,e.content_hash,e.artifact_reference_id
       FROM qa_finding_observations fo
       JOIN qa_evidence_artifact_links e ON e.workspace_id=fo.workspace_id AND e.project_id=fo.project_id
        AND (e.owner_observation_id=fo.observation_id OR e.owner_finding_id=fo.finding_id)
       WHERE fo.workspace_id=$1 AND fo.project_id=$2 AND fo.finding_id=$3 AND fo.state='ACTIVE'
       ORDER BY e.evidence_link_id`,
        [input.workspaceId, input.projectId, input.findingId],
      ),
    );
    if (!evidence.length) throw new QaDomainError("QA_DEFECT_DRAFT_EVIDENCE_REQUIRED");
    const review = json<Record<string, unknown>>(finding.content);
    const wording = input.acceptedProposal ?? {};
    const title = String(wording.title ?? `[QA] ${finding.summary}`);
    const description = String(
      wording.description ??
        `${finding.classification_reason}\n\nDisposition: ${finding.disposition_reason}`,
    );
    const steps = Array.isArray(wording.stepsToReproduce)
      ? wording.stepsToReproduce.map(String)
      : json<readonly string[]>(finding.observation_membership_ids).map(
          (id, index) => `${index + 1}. Reproduce observation membership ${id}`,
        );
    const payload = Object.freeze({
      title,
      description,
      stepsToReproduce: Object.freeze(steps),
      expectedOutcome: String(
        wording.expectedOutcome ?? "The validated acceptance outcome is satisfied.",
      ),
      actualOutcome: String(wording.actualOutcome ?? finding.summary),
      severity: String(finding.severity),
      target: Object.freeze({ contentHash: String(finding.affected_target_hash) }),
      evidenceRefs: Object.freeze(
        evidence.map((item) =>
          Object.freeze({
            id: String(item.artifact_reference_id),
            version: "1",
            contentHash: String(item.content_hash),
          }),
        ),
      ),
    });
    if (
      ![payload.title, payload.description, payload.expectedOutcome, payload.actualOutcome].every(
        (value) => value.trim(),
      ) ||
      !steps.length ||
      steps.some((step) => !step.trim())
    ) {
      throw new QaDomainError("QA_DEFECT_DRAFT_WORDING_INVALID");
    }
    const version = predecessor ? Number(predecessor.version) + 1 : 1;
    const defectDraftId = randomUUID();
    const provenance = Object.freeze({
      source:
        input.source === "MODEL_PROPOSAL"
          ? "MODEL_PROPOSAL_ACCEPTED"
          : input.source === "DETERMINISTIC_FALLBACK"
            ? "DETERMINISTIC_FALLBACK_ACCEPTED"
            : "DETERMINISTIC_TEMPLATE",
      templateVersion: "1.0.0",
      ...(input.acceptedProposal
        ? {
            acceptedProposalRef: {
              id: String(input.acceptedProposal.proposalId),
              contentHash: String(input.acceptedProposal.proposalHash),
            },
          }
        : {}),
    });
    const immutable = {
      version,
      findingId: input.findingId,
      frozenFindingReviewRef: {
        id: String(finding.finding_review_revision_id),
        version: Number(finding.version),
        contentHash: String(finding.content_hash),
      },
      payload,
      provenance,
      predecessorDraftRef: predecessor
        ? {
            id: String(predecessor.defect_draft_id),
            version: Number(predecessor.version),
            contentHash: String(predecessor.content_hash),
          }
        : null,
    };
    const contentHash = qaAggregateSnapshotHash(immutable as never);
    await this.manager.query(
      `INSERT INTO qa_defect_drafts(defect_draft_id,workspace_id,project_id,work_item_id,session_id,finding_id,frozen_finding_review_id,version,predecessor_draft_id,predecessor_terminal_state,replacement_reason,state,payload,provenance,content_hash,resource_version,created_by,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'DRAFT',$12,$13,$14,1,$15,$16,$16)`,
      [
        defectDraftId,
        input.workspaceId,
        input.projectId,
        input.workItemId,
        finding.session_id,
        input.findingId,
        finding.finding_review_revision_id,
        version,
        predecessor?.defect_draft_id ?? null,
        predecessor?.state ?? null,
        predecessor ? "Human wording replacement" : null,
        JSON.stringify(payload),
        JSON.stringify(provenance),
        contentHash,
        JSON.stringify(input.actor),
        input.at,
      ],
    );
    void review;
    return Object.freeze({
      defectDraftId,
      findingId: input.findingId,
      version,
      state: "DRAFT",
      resourceVersion: 1,
      contentHash,
      payload,
      provenance,
      ...(predecessor ? { predecessorDraftRef: immutable.predecessorDraftRef! } : {}),
    });
  }

  async reject(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      workItemId: string;
      defectDraftId: string;
      expectedResourceVersion: number;
      expectedContentHash: string;
      reason: string;
      actor: QaHumanActor;
      at: string;
    }>,
  ): Promise<Row> {
    if (!input.reason.trim()) throw new QaDomainError("QA_DEFECT_DRAFT_REJECTION_REASON_REQUIRED");
    const changed = rows(
      await this.manager.query(
        `UPDATE qa_defect_drafts SET state='REJECTED',terminal_from_state=state,rejection_reason=$1,rejected_by=$2,rejected_at=$3,terminal_reason=$1,resource_version=resource_version+1,updated_at=$3
       WHERE workspace_id=$4 AND project_id=$5 AND work_item_id=$6 AND defect_draft_id=$7 AND resource_version=$8 AND content_hash=$9 AND state IN('DRAFT','READY_FOR_APPROVAL') RETURNING *`,
        [
          input.reason,
          JSON.stringify(input.actor),
          input.at,
          input.workspaceId,
          input.projectId,
          input.workItemId,
          input.defectDraftId,
          input.expectedResourceVersion,
          input.expectedContentHash,
        ],
      ),
    )[0];
    if (!changed) throw new QaDomainError("QA_DEFECT_DRAFT_STALE_OR_FINAL");
    return this.#public(changed);
  }

  async draft(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      workItemId: string;
      defectDraftId: string;
    }>,
  ): Promise<Row | undefined> {
    const row = rows(
      await this.manager.query(
        "SELECT * FROM qa_defect_drafts WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND defect_draft_id=$4",
        [input.workspaceId, input.projectId, input.workItemId, input.defectDraftId],
      ),
    )[0];
    return row ? this.#public(row) : undefined;
  }

  #public(row: Row): Row {
    return Object.freeze({
      ...row,
      defectDraftId: String(row.defect_draft_id),
      findingId: String(row.finding_id),
      workItemId: String(row.work_item_id),
      sessionId: String(row.session_id),
      resourceVersion: Number(row.resource_version),
      contentHash: String(row.content_hash),
      payload: json(row.payload),
      provenance: json(row.provenance),
    });
  }
}
