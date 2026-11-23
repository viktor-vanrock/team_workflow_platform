import { randomUUID } from "node:crypto";

import type { EntityManager } from "typeorm";

import type {
  QaFindingClassification,
  QaFindingDispositionDecision,
  QaFindingSeverity,
} from "../domain/finding.ts";
import {
  qaAggregateSnapshotHash,
  type QaContentHash,
  QaDomainError,
  type QaHumanActor,
} from "../domain/primitives.ts";

type Row = Readonly<Record<string, unknown>>;
const rows = (value: unknown): readonly Row[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Row[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

export interface QaFindingScope {
  readonly workspaceId: string;
  readonly projectId: string;
}
export interface FrozenFindingRef {
  readonly id: string;
  readonly version: number;
  readonly contentHash: QaContentHash;
  readonly findingId: string;
  readonly membershipIds: readonly string[];
  readonly observationIds: readonly string[];
  readonly classification: QaFindingClassification;
  readonly dispositionDecision: QaFindingDispositionDecision;
}

const allowed: Readonly<Record<QaFindingClassification, readonly QaFindingDispositionDecision[]>> =
  {
    PRODUCT: ["CREATE_DEFECT", "DEFERRED", "WAIVED"],
    INFRA: ["NOT_A_BUG", "DEFERRED", "WAIVED"],
    INCONCLUSIVE: ["DEFERRED", "WAIVED"],
    DUPLICATE: ["DUPLICATE"],
    ACCEPTED_RISK: ["ACCEPTED_RISK"],
  };

export class TypeOrmFindingRepository {
  constructor(private readonly manager: EntityManager) {}

  async create(
    input: Readonly<{
      scope: QaFindingScope;
      workItemId: string;
      sessionId: string;
      observationId: string;
      actor: QaHumanActor;
      at: string;
      findingId?: string;
      membershipId?: string;
    }>,
  ) {
    await this.#lockSession(input.scope, input.sessionId);
    const observation = rows(
      await this.manager.query(
        "SELECT o.*,s.state AS session_state,s.target_hash FROM qa_observations o JOIN qa_test_sessions s ON s.session_id=o.session_id AND s.workspace_id=o.workspace_id AND s.project_id=o.project_id WHERE o.observation_id=$1 AND o.workspace_id=$2 AND o.project_id=$3 AND o.session_id=$4 AND o.work_item_id=$5 AND NOT EXISTS(SELECT 1 FROM qa_observations successor WHERE successor.corrects_observation_id=o.observation_id) FOR UPDATE OF o,s",
        [
          input.observationId,
          input.scope.workspaceId,
          input.scope.projectId,
          input.sessionId,
          input.workItemId,
        ],
      ),
    )[0];
    if (!observation) throw new QaDomainError("QA_OBSERVATION_NOT_FOUND");
    if (observation.session_state !== "REVIEW_REQUIRED")
      throw new QaDomainError("QA_FINDING_SESSION_STATE_INVALID");
    if (observation.kind !== "NEGATIVE" && observation.kind !== "AMBIGUOUS")
      throw new QaDomainError("QA_FINDING_OBSERVATION_KIND_INVALID");
    const findingId = input.findingId ?? randomUUID();
    const membershipId = input.membershipId ?? randomUUID();
    const content = {
      findingId,
      workspaceId: input.scope.workspaceId,
      projectId: input.scope.projectId,
      workItemId: input.workItemId,
      sessionId: input.sessionId,
      observationIds: [input.observationId],
      evidenceRefs: json<readonly unknown[]>(observation.artifact_ids),
      state: "DRAFT",
      resourceVersion: 1,
      createdBy: input.actor,
      createdAt: input.at,
      updatedAt: input.at,
    };
    await this.manager.query(
      "INSERT INTO qa_findings(finding_id,workspace_id,project_id,work_item_id,session_id,state,created_by,created_at,resource_version,content) VALUES($1,$2,$3,$4,$5,'DRAFT',$6,$7,1,$8)",
      [
        findingId,
        input.scope.workspaceId,
        input.scope.projectId,
        input.workItemId,
        input.sessionId,
        JSON.stringify(input.actor),
        input.at,
        JSON.stringify(content),
      ],
    );
    await this.manager.query(
      "INSERT INTO qa_finding_observations(membership_id,workspace_id,project_id,work_item_id,session_id,finding_id,observation_id,state,assigned_by,assigned_at,resource_version) VALUES($1,$2,$3,$4,$5,$6,$7,'ACTIVE',$8,$9,1)",
      [
        membershipId,
        input.scope.workspaceId,
        input.scope.projectId,
        input.workItemId,
        input.sessionId,
        findingId,
        input.observationId,
        JSON.stringify(input.actor),
        input.at,
      ],
    );
    return Object.freeze({
      ...content,
      findingId,
      membershipId,
      activeMembershipSetHash: await this.#membershipHash(input.scope, findingId),
    });
  }

  async list(scope: QaFindingScope, workItemId: string): Promise<readonly Row[]> {
    return rows(
      await this.manager.query(
        "SELECT content||jsonb_build_object('findingId',finding_id,'state',state,'resourceVersion',resource_version) AS finding FROM qa_findings WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY created_at,finding_id",
        [scope.workspaceId, scope.projectId, workItemId],
      ),
    ).map((row) => json<Row>(row.finding));
  }

  async memberships(
    scope: QaFindingScope,
    findingId: string,
  ): Promise<
    Readonly<{
      findingId: string;
      activeMembershipSetHash: QaContentHash;
      memberships: readonly Row[];
    }>
  > {
    const memberships = rows(
      await this.manager.query(
        'SELECT membership_id AS "membershipId",observation_id AS "observationId",state,assigned_by AS "assignedBy",assigned_at AS "assignedAt",released_by AS "releasedBy",released_at AS "releasedAt",release_reason AS "releaseReason",resource_version AS "resourceVersion" FROM qa_finding_observations WHERE workspace_id=$1 AND project_id=$2 AND finding_id=$3 ORDER BY assigned_at,membership_id',
        [scope.workspaceId, scope.projectId, findingId],
      ),
    );
    if (!memberships.length) throw new QaDomainError("QA_FINDING_NOT_FOUND");
    return Object.freeze({
      findingId,
      activeMembershipSetHash: await this.#membershipHash(scope, findingId),
      memberships: Object.freeze(memberships),
    });
  }

  async assign(
    input: Readonly<{
      scope: QaFindingScope;
      findingId: string;
      observationId: string;
      membershipId?: string;
      actor: QaHumanActor;
      reason?: string;
      at: string;
    }>,
  ) {
    const finding = await this.#finding(input.scope, input.findingId, true);
    await this.#lockSession(input.scope, String(finding.session_id));
    if (finding.state === "FROZEN") throw new QaDomainError("QA_FINDING_FROZEN");
    const observation = rows(
      await this.manager.query(
        "SELECT observation_id,session_id,work_item_id,kind FROM qa_observations o WHERE observation_id=$1 AND workspace_id=$2 AND project_id=$3 AND session_id=$4 AND work_item_id=$5 AND NOT EXISTS(SELECT 1 FROM qa_observations s WHERE s.corrects_observation_id=o.observation_id)",
        [
          input.observationId,
          input.scope.workspaceId,
          input.scope.projectId,
          finding.session_id,
          finding.work_item_id,
        ],
      ),
    )[0];
    if (!observation || !["NEGATIVE", "AMBIGUOUS"].includes(String(observation.kind)))
      throw new QaDomainError("QA_FINDING_OBSERVATION_INVALID");
    await this.#resetForMembershipChange(
      finding,
      input.actor,
      input.reason ?? "MEMBERSHIP_CHANGED",
      input.at,
    );
    const membershipId = input.membershipId ?? randomUUID();
    await this.manager.query(
      "INSERT INTO qa_finding_observations(membership_id,workspace_id,project_id,work_item_id,session_id,finding_id,observation_id,state,assigned_by,assigned_at,resource_version) VALUES($1,$2,$3,$4,$5,$6,$7,'ACTIVE',$8,$9,1)",
      [
        membershipId,
        input.scope.workspaceId,
        input.scope.projectId,
        finding.work_item_id,
        finding.session_id,
        input.findingId,
        input.observationId,
        JSON.stringify(input.actor),
        input.at,
      ],
    );
    if (finding.state === "DRAFT")
      await this.manager.query(
        "UPDATE qa_findings SET resource_version=resource_version+1,content=content||jsonb_build_object('resourceVersion',resource_version+1,'updatedAt',$1::text) WHERE finding_id=$2",
        [input.at, input.findingId],
      );
    return await this.memberships(input.scope, input.findingId);
  }

  async release(
    input: Readonly<{
      scope: QaFindingScope;
      findingId: string;
      membershipId: string;
      actor: QaHumanActor;
      reason: string;
      at: string;
    }>,
  ) {
    const finding = await this.#finding(input.scope, input.findingId, true);
    await this.#lockSession(input.scope, String(finding.session_id));
    if (finding.state === "FROZEN") throw new QaDomainError("QA_FINDING_FROZEN");
    await this.#resetForMembershipChange(finding, input.actor, input.reason, input.at);
    const changed = rows(
      await this.manager.query(
        "UPDATE qa_finding_observations SET state='RELEASED',released_by=$1,released_at=$2,release_reason=$3,resource_version=resource_version+1 WHERE membership_id=$4 AND workspace_id=$5 AND project_id=$6 AND finding_id=$7 AND state='ACTIVE' RETURNING membership_id",
        [
          JSON.stringify(input.actor),
          input.at,
          input.reason,
          input.membershipId,
          input.scope.workspaceId,
          input.scope.projectId,
          input.findingId,
        ],
      ),
    );
    if (!changed[0]) throw new QaDomainError("QA_FINDING_MEMBERSHIP_NOT_ACTIVE");
    if (finding.state === "DRAFT")
      await this.manager.query(
        "UPDATE qa_findings SET resource_version=resource_version+1,content=content||jsonb_build_object('resourceVersion',resource_version+1,'updatedAt',$1::text) WHERE finding_id=$2",
        [input.at, input.findingId],
      );
    return await this.memberships(input.scope, input.findingId);
  }

  async classify(
    input: Readonly<{
      scope: QaFindingScope;
      findingId: string;
      classification: QaFindingClassification;
      severity: QaFindingSeverity;
      summary: string;
      reason: string;
      policyRef: Readonly<{ key: string; version: string }>;
      actor: QaHumanActor;
      at: string;
    }>,
  ) {
    const finding = await this.#finding(input.scope, input.findingId, true);
    await this.#lockSession(input.scope, String(finding.session_id));
    if (finding.state === "FROZEN") throw new QaDomainError("QA_FINDING_FROZEN");
    const membership = await this.memberships(input.scope, input.findingId);
    const activeIds = membership.memberships
      .filter(({ state }) => state === "ACTIVE")
      .map(({ membershipId }) => String(membershipId))
      .sort();
    if (!activeIds.length || !input.summary.trim() || !input.reason.trim())
      throw new QaDomainError("QA_FINDING_CLASSIFICATION_INVALID");
    const latest = await this.#latestReview(input.scope, input.findingId);
    const version = latest ? Number(latest.version) + 1 : 1;
    const id = randomUUID();
    const target = rows(
      await this.manager.query(
        "SELECT target_hash FROM qa_test_sessions WHERE session_id=$1 AND workspace_id=$2 AND project_id=$3",
        [finding.session_id, input.scope.workspaceId, input.scope.projectId],
      ),
    )[0]!;
    const evidence = rows(
      await this.manager.query(
        "SELECT DISTINCT e.evidence_link_id,e.content_hash FROM qa_finding_observations fo JOIN qa_evidence_artifact_links e ON e.owner_observation_id=fo.observation_id AND e.workspace_id=fo.workspace_id AND e.project_id=fo.project_id WHERE fo.finding_id=$1 AND fo.state='ACTIVE' ORDER BY e.evidence_link_id",
        [input.findingId],
      ),
    );
    const body = {
      id,
      version,
      stage: "CLASSIFIED",
      ...(latest
        ? {
            previousRevisionRef: {
              id: latest.finding_review_revision_id,
              version: Number(latest.version),
              contentHash: latest.content_hash,
            },
          }
        : {}),
      workspaceId: input.scope.workspaceId,
      projectId: input.scope.projectId,
      workItemId: finding.work_item_id,
      sessionId: finding.session_id,
      findingId: input.findingId,
      classification: input.classification,
      severity: input.severity,
      summary: input.summary,
      affectedTargetHash: target.target_hash,
      classificationActor: input.actor,
      classificationReason: input.reason,
      classificationAt: input.at,
      activeMembershipSetHash: membership.activeMembershipSetHash,
      observationMembershipIds: activeIds,
      evidenceRefHash: qaAggregateSnapshotHash(evidence as never),
      policyRef: input.policyRef,
    };
    const contentHash = qaAggregateSnapshotHash(body as never);
    await this.manager.query(
      "INSERT INTO qa_finding_review_revisions(finding_review_revision_id,workspace_id,project_id,work_item_id,session_id,finding_id,version,previous_revision_id,previous_version,previous_content_hash,stage,classification,severity,summary,affected_target_hash,classification_actor,classification_reason,classification_at,active_membership_set_hash,observation_membership_ids,evidence_ref_hash,policy_ref,content_hash,content) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'CLASSIFIED',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)",
      [
        id,
        input.scope.workspaceId,
        input.scope.projectId,
        finding.work_item_id,
        finding.session_id,
        input.findingId,
        version,
        latest?.finding_review_revision_id ?? null,
        latest ? Number(latest.version) : null,
        latest?.content_hash ?? null,
        input.classification,
        input.severity,
        input.summary,
        target.target_hash,
        JSON.stringify(input.actor),
        input.reason,
        input.at,
        membership.activeMembershipSetHash,
        JSON.stringify(activeIds),
        qaAggregateSnapshotHash(evidence as never),
        JSON.stringify(input.policyRef),
        contentHash,
        JSON.stringify({ ...body, contentHash }),
      ],
    );
    await this.manager.query(
      "UPDATE qa_findings SET state='CLASSIFIED',current_review_revision_id=$1,latest_historical_review_revision_id=$1,classification=$2,resource_version=resource_version+1,content=content||jsonb_build_object('state','CLASSIFIED','latestReviewRevisionRef',jsonb_build_object('id',$1::text,'version',$3::int,'contentHash',$4::text),'classification',$2::text,'resourceVersion',resource_version+1,'updatedAt',$5::text) WHERE finding_id=$6",
      [id, input.classification, version, contentHash, input.at, input.findingId],
    );
    return Object.freeze({ ...body, contentHash });
  }

  async dispose(
    input: Readonly<{
      scope: QaFindingScope;
      findingId: string;
      decision: QaFindingDispositionDecision;
      reason: string;
      actor: QaHumanActor;
      at: string;
      duplicateDefectRef?: unknown;
      acceptedRiskActionRef?: unknown;
      waiverActionRef?: unknown;
    }>,
  ) {
    const finding = await this.#finding(input.scope, input.findingId, true);
    await this.#lockSession(input.scope, String(finding.session_id));
    const current = await this.#currentReview(input.scope, input.findingId);
    if (finding.state !== "CLASSIFIED" || !current || current.stage !== "CLASSIFIED")
      throw new QaDomainError("QA_FINDING_CLASSIFICATION_REQUIRED");
    const classification = String(current.classification) as QaFindingClassification;
    if (!allowed[classification].includes(input.decision) || !input.reason.trim())
      throw new QaDomainError("QA_FINDING_DISPOSITION_INVALID");
    if ((input.decision === "DUPLICATE") !== (input.duplicateDefectRef !== undefined))
      throw new QaDomainError("QA_FINDING_DUPLICATE_REF_REQUIRED");
    if (input.decision === "ACCEPTED_RISK" && !input.acceptedRiskActionRef)
      throw new QaDomainError("QA_FINDING_ACCEPTED_RISK_APPROVAL_REQUIRED");
    if (input.decision === "WAIVED" && !input.waiverActionRef)
      throw new QaDomainError("QA_FINDING_WAIVER_APPROVAL_REQUIRED");
    const version = Number(current.version) + 1,
      id = randomUUID();
    const prior = json<Row>(current.content);
    const body = {
      ...prior,
      id,
      version,
      stage: "DISPOSED",
      previousRevisionRef: {
        id: current.finding_review_revision_id,
        version: Number(current.version),
        contentHash: current.content_hash,
      },
      dispositionDecision: input.decision,
      dispositionActor: input.actor,
      dispositionReason: input.reason,
      dispositionAt: input.at,
      ...(input.duplicateDefectRef ? { duplicateDefectRef: input.duplicateDefectRef } : {}),
      ...(input.acceptedRiskActionRef
        ? { acceptedRiskActionRef: input.acceptedRiskActionRef }
        : {}),
      ...(input.waiverActionRef ? { waiverActionRef: input.waiverActionRef } : {}),
    };
    const contentHash = qaAggregateSnapshotHash(body as never);
    await this.manager.query(
      "INSERT INTO qa_finding_review_revisions(finding_review_revision_id,workspace_id,project_id,work_item_id,session_id,finding_id,version,previous_revision_id,previous_version,previous_content_hash,stage,classification,severity,summary,affected_target_hash,classification_actor,classification_reason,classification_at,disposition_decision,disposition_actor,disposition_reason,disposition_at,duplicate_defect_ref,accepted_risk_action_ref,waiver_action_ref,active_membership_set_hash,observation_membership_ids,evidence_ref_hash,policy_ref,content_hash,content) SELECT $1,workspace_id,project_id,work_item_id,session_id,finding_id,$2,finding_review_revision_id,version,content_hash,'DISPOSED',classification,severity,summary,affected_target_hash,classification_actor,classification_reason,classification_at,$3,$4,$5,$6,$7,$8,$9,active_membership_set_hash,observation_membership_ids,evidence_ref_hash,policy_ref,$10,$11 FROM qa_finding_review_revisions WHERE finding_review_revision_id=$12",
      [
        id,
        version,
        input.decision,
        JSON.stringify(input.actor),
        input.reason,
        input.at,
        input.duplicateDefectRef ? JSON.stringify(input.duplicateDefectRef) : null,
        input.acceptedRiskActionRef ? JSON.stringify(input.acceptedRiskActionRef) : null,
        input.waiverActionRef ? JSON.stringify(input.waiverActionRef) : null,
        contentHash,
        JSON.stringify({ ...body, contentHash }),
        current.finding_review_revision_id,
      ],
    );
    await this.manager.query(
      "UPDATE qa_findings SET state='DISPOSED',current_review_revision_id=$1,latest_historical_review_revision_id=$1,resource_version=resource_version+1,content=content||jsonb_build_object('state','DISPOSED','latestReviewRevisionRef',jsonb_build_object('id',$1::text,'version',$2::int,'contentHash',$3::text),'dispositionDecision',$4::text,'dispositionReason',$5::text,'disposedBy',$6::jsonb,'disposedAt',$7::text,'resourceVersion',resource_version+1,'updatedAt',$7::text) WHERE finding_id=$8",
      [
        id,
        version,
        contentHash,
        input.decision,
        input.reason,
        JSON.stringify(input.actor),
        input.at,
        input.findingId,
      ],
    );
    return Object.freeze({ ...body, contentHash });
  }

  async freezeSession(
    scope: QaFindingScope,
    sessionId: string,
    at: string,
  ): Promise<readonly FrozenFindingRef[]> {
    await this.#lockSession(scope, sessionId);
    await this.manager.query("SELECT qa_assert_session_reviewable($1)", [sessionId]);
    const findings = rows(
      await this.manager.query(
        "SELECT f.*,r.* FROM qa_findings f JOIN qa_finding_review_revisions r ON r.finding_review_revision_id=f.current_review_revision_id WHERE f.workspace_id=$1 AND f.project_id=$2 AND f.session_id=$3 ORDER BY f.finding_id FOR UPDATE OF f,r",
        [scope.workspaceId, scope.projectId, sessionId],
      ),
    );
    const frozen: FrozenFindingRef[] = [];
    for (const row of findings) {
      const activeRows = rows(
        await this.manager.query(
          "SELECT membership_id,observation_id FROM qa_finding_observations WHERE workspace_id=$1 AND project_id=$2 AND finding_id=$3 AND state='ACTIVE' ORDER BY membership_id",
          [scope.workspaceId, scope.projectId, row.finding_id],
        ),
      );
      const active = activeRows.map(({ membership_id }) => String(membership_id));
      const observationIds = activeRows.map(({ observation_id }) => String(observation_id)).sort();
      // The persisted review hash is canonical over membership+observation pairs; compare via repository helper.
      if (
        (await this.#membershipHash(scope, String(row.finding_id))) !==
        row.active_membership_set_hash
      )
        throw new QaDomainError("QA_FINDING_MEMBERSHIP_STALE");
      const id = randomUUID(),
        version = Number(row.version) + 1,
        prior = json<Row>(row.content);
      const body = {
        ...prior,
        id,
        version,
        stage: "FROZEN",
        previousRevisionRef: {
          id: row.finding_review_revision_id,
          version: Number(row.version),
          contentHash: row.content_hash,
        },
        frozenAt: at,
      };
      const contentHash = qaAggregateSnapshotHash(body as never);
      await this.manager.query(
        "INSERT INTO qa_finding_review_revisions(finding_review_revision_id,workspace_id,project_id,work_item_id,session_id,finding_id,version,previous_revision_id,previous_version,previous_content_hash,stage,classification,severity,summary,affected_target_hash,classification_actor,classification_reason,classification_at,disposition_decision,disposition_actor,disposition_reason,disposition_at,duplicate_defect_ref,accepted_risk_action_ref,waiver_action_ref,frozen_at,active_membership_set_hash,observation_membership_ids,evidence_ref_hash,policy_ref,content_hash,content) SELECT $1,workspace_id,project_id,work_item_id,session_id,finding_id,$2,finding_review_revision_id,version,content_hash,'FROZEN',classification,severity,summary,affected_target_hash,classification_actor,classification_reason,classification_at,disposition_decision,disposition_actor,disposition_reason,disposition_at,duplicate_defect_ref,accepted_risk_action_ref,waiver_action_ref,$3,active_membership_set_hash,observation_membership_ids,evidence_ref_hash,policy_ref,$4,$5 FROM qa_finding_review_revisions WHERE finding_review_revision_id=$6",
        [
          id,
          version,
          at,
          contentHash,
          JSON.stringify({ ...body, contentHash }),
          row.finding_review_revision_id,
        ],
      );
      await this.manager.query(
        "UPDATE qa_findings SET state='FROZEN',current_review_revision_id=$1,latest_historical_review_revision_id=$1,frozen_review_revision_id=$1,frozen_membership_set_hash=$2,frozen_at=$3::timestamptz,resource_version=resource_version+1,content=content||jsonb_build_object('state','FROZEN','latestReviewRevisionRef',jsonb_build_object('id',$1::text,'version',$4::int,'contentHash',$5::text),'frozenReviewRevisionRef',jsonb_build_object('id',$1::text,'version',$4::int,'contentHash',$5::text),'frozenMembershipSetHash',$2::text,'frozenAt',$3::timestamptz::text,'resourceVersion',resource_version+1,'updatedAt',$3::timestamptz::text) WHERE finding_id=$6",
        [id, row.active_membership_set_hash, at, version, contentHash, row.finding_id],
      );
      frozen.push(
        Object.freeze({
          id,
          version,
          contentHash,
          findingId: String(row.finding_id),
          membershipIds: Object.freeze(active),
          observationIds: Object.freeze(observationIds),
          classification: String(row.classification) as QaFindingClassification,
          dispositionDecision: String(row.disposition_decision) as QaFindingDispositionDecision,
        }),
      );
    }
    return Object.freeze(frozen);
  }

  async #lockSession(scope: QaFindingScope, sessionId: string): Promise<void> {
    await this.manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `qa-session:${scope.workspaceId}:${scope.projectId}:${sessionId}`,
    ]);
  }
  async #finding(scope: QaFindingScope, findingId: string, lock = false): Promise<Row> {
    const found = rows(
      await this.manager.query(
        `SELECT * FROM qa_findings WHERE workspace_id=$1 AND project_id=$2 AND finding_id=$3${lock ? " FOR UPDATE" : ""}`,
        [scope.workspaceId, scope.projectId, findingId],
      ),
    )[0];
    if (!found) throw new QaDomainError("QA_FINDING_NOT_FOUND");
    return found;
  }
  async #latestReview(scope: QaFindingScope, findingId: string): Promise<Row | undefined> {
    return rows(
      await this.manager.query(
        "SELECT * FROM qa_finding_review_revisions WHERE workspace_id=$1 AND project_id=$2 AND finding_id=$3 ORDER BY version DESC LIMIT 1",
        [scope.workspaceId, scope.projectId, findingId],
      ),
    )[0];
  }
  async #currentReview(scope: QaFindingScope, findingId: string): Promise<Row | undefined> {
    return rows(
      await this.manager.query(
        "SELECT r.* FROM qa_findings f JOIN qa_finding_review_revisions r ON r.finding_review_revision_id=f.current_review_revision_id WHERE f.workspace_id=$1 AND f.project_id=$2 AND f.finding_id=$3",
        [scope.workspaceId, scope.projectId, findingId],
      ),
    )[0];
  }
  async #membershipHash(scope: QaFindingScope, findingId: string): Promise<QaContentHash> {
    const set = rows(
      await this.manager.query(
        'SELECT membership_id AS "membershipId",observation_id AS "observationId" FROM qa_finding_observations WHERE workspace_id=$1 AND project_id=$2 AND finding_id=$3 AND state=\'ACTIVE\' ORDER BY membership_id',
        [scope.workspaceId, scope.projectId, findingId],
      ),
    );
    return qaAggregateSnapshotHash(set as never);
  }
  async #resetForMembershipChange(
    finding: Row,
    actor: QaHumanActor,
    reason: string,
    at: string,
  ): Promise<void> {
    if (finding.state !== "CLASSIFIED" && finding.state !== "DISPOSED") return;
    await this.manager.query(
      "UPDATE qa_findings SET state='DRAFT',current_review_revision_id=NULL,classification=NULL,resource_version=resource_version+1,content=(content-'latestReviewRevisionRef'-'classification'-'dispositionDecision'-'dispositionReason'-'disposedBy'-'disposedAt')||jsonb_build_object('state','DRAFT','resourceVersion',resource_version+1,'updatedAt',$1::text,'resetReason',$2::text,'resetBy',$3::jsonb) WHERE finding_id=$4",
      [at, reason, JSON.stringify(actor), finding.finding_id],
    );
  }
}
