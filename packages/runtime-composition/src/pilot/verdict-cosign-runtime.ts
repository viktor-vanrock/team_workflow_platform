import { randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import {
  cosignQaVerdict,
  qaAggregateSnapshotHash,
  type QaExactReference,
  type QaHumanActor,
  TypeOrmQaVerdictDodRepository,
} from "@awp/competency-qa/node";
import {
  type Approval,
  consumeEffectAuthorization,
  createExactApproval,
  decideApproval,
  defaultClassificationCatalog,
  recomputeExactApprovalSubjectHash,
} from "@awp/platform-core";

import type { QaCompletionAuthority } from "./completion-runtime.ts";
import { currentQaCommandAuthority } from "./qa-command-authority.ts";
import type { DurableQaVerdictRuntime } from "./verdict-runtime.ts";
import { persistQaVerdictSignatureEvents } from "./verdict-signature-events.ts";

interface Candidate {
  readonly subject: Readonly<{
    workspaceId: string;
    projectId: string;
    workItemId: string;
    verdictRef: QaExactReference;
    primarySignerId: string;
  }>;
  readonly initiator: QaHumanActor;
  readonly expectedResourceVersion: number;
  readonly reason: string;
  readonly expiresAt: string;
}
export interface QaVerdictCosignRequestResult {
  readonly actionId: string;
  readonly approvalId: string;
  readonly candidateHash: string;
  readonly state: "PENDING_APPROVAL";
  readonly replayed: boolean;
}
export interface QaVerdictCosignDecisionResult {
  readonly actionId: string;
  readonly approvalId: string;
  readonly verdictId: string;
  readonly state: "SIGNED";
}
type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => {
  const array = value as unknown[];
  return (Array.isArray(array[0]) ? array[0] : array) as Row[];
};
const hash = (value: unknown) => qaAggregateSnapshotHash(value as never);
const same = (a: unknown, b: unknown) => hash(a) === hash(b);
const denied = () => new Error("QA_VERDICT_COSIGN_DENIED");
const parseApproval = (value: unknown): Approval => {
  const stored = value as Approval;
  return {
    ...stored,
    expiresAt: new Date(stored.expiresAt),
    createdAt: new Date(stored.createdAt),
    ...(stored.decision
      ? { decision: { ...stored.decision, decidedAt: new Date(stored.decision.decidedAt) } }
      : {}),
    ...(stored.consumedAt ? { consumedAt: new Date(stored.consumedAt) } : {}),
  };
};

/** Exact internal action, approval, signature, verdict projection and audit share the request transaction. */
export class DurableQaVerdictCosignRuntime {
  constructor(
    private readonly source: DataSource,
    private readonly verdicts: DurableQaVerdictRuntime,
  ) {}
  async request(
    authority: QaCompletionAuthority,
    workItemId: string,
    verdictId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<QaVerdictCosignRequestResult> {
    await authority.authorize("qa.verdict.sign");
    if (
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1 ||
      typeof reason !== "string" ||
      !reason.trim() ||
      reason.length > 2000
    )
      throw denied();
    return this.source.transaction("READ COMMITTED", async (manager) => {
      const proof = await this.verdicts.currentForCosign(manager, authority, workItemId, verdictId);
      const current = await authority.authorize("qa.verdict.sign");
      if (
        proof.resourceVersion !== expectedVersion ||
        !same(proof.verdict.signatures[0]!.signer, current.actor)
      )
        throw denied();
      if (
        !defaultClassificationCatalog.permits(
          defaultClassificationCatalog.reference(current.classificationCeiling),
          defaultClassificationCatalog.reference(proof.classificationKey),
        )
      )
        throw denied();
      const subject = {
        workspaceId: authority.workspaceId,
        projectId: authority.projectId,
        workItemId,
        verdictRef: proof.verdict.ref,
        primarySignerId: current.actor.principalId,
      };
      const [existing] = rows(
        await manager.query(
          "SELECT p.*,a.id AS approval_id,a.subject,a.subject_hash,a.decision_state FROM platform_actions p JOIN approvals a ON a.action_id=p.id AND a.workspace_id=p.workspace_id AND a.project_id=p.project_id WHERE p.workspace_id=$1 AND p.project_id=$2 AND p.action_kind='qa.verdict.cosign' AND p.candidate_ref->'candidate'->'subject'->'verdictRef'->>'id'=$3 AND p.state='PENDING_APPROVAL' AND a.expires_at>clock_timestamp() FOR UPDATE OF p,a",
          [authority.workspaceId, authority.projectId, verdictId],
        ),
      );
      if (existing) {
        const candidate = (existing.candidate_ref as { candidate: Candidate }).candidate;
        const approval = parseApproval(existing.subject);
        if (
          !same(candidate.subject, subject) ||
          !same(candidate.initiator, current.actor) ||
          candidate.expectedResourceVersion !== expectedVersion ||
          candidate.reason !== reason ||
          hash(candidate) !== existing.candidate_hash ||
          approval.decisionStatus !== "PENDING" ||
          existing.decision_state !== "PENDING" ||
          approval.subjectHash !== existing.subject_hash ||
          recomputeExactApprovalSubjectHash(approval) !== existing.subject_hash
        )
          throw denied();
        if (
          approval.expiresAt.getTime() <= Date.now() ||
          this.approval(
            approval.id,
            String(existing.id),
            candidate,
            proof.bindingRef,
            approval.createdAt,
          ).subjectHash !== approval.subjectHash
        )
          throw denied();
        return {
          actionId: String(existing.id),
          approvalId: String(existing.approval_id),
          candidateHash: existing.candidate_hash,
          state: "PENDING_APPROVAL",
          replayed: true,
        };
      }
      const createdAt = new Date();
      const candidate: Candidate = {
        subject,
        initiator: current.actor,
        expectedResourceVersion: expectedVersion,
        reason,
        expiresAt: new Date(createdAt.getTime() + 15 * 60_000).toISOString(),
      };
      const actionId = randomUUID();
      const approval = this.approval(
        randomUUID(),
        actionId,
        candidate,
        proof.bindingRef,
        createdAt,
      );
      await manager.query(
        "INSERT INTO platform_actions(id,workspace_id,project_id,action_kind,candidate_ref,candidate_hash,state,row_version,created_at) VALUES($1,$2,$3,'qa.verdict.cosign',$4,$5,'PENDING_APPROVAL',1,$6)",
        [
          actionId,
          authority.workspaceId,
          authority.projectId,
          { candidate, initiatorId: current.actor.principalId },
          hash(candidate),
          createdAt,
        ],
      );
      await manager.query(
        "INSERT INTO approvals(id,workspace_id,project_id,action_kind,action_id,subject,subject_hash,decision_state,effect_authorization_state,initiator_id,expires_at,row_version,created_at) VALUES($1,$2,$3,'PLATFORM_ACTION',$4,$5,$6,'PENDING','NOT_AUTHORIZED',$7,$8,1,$9)",
        [
          approval.id,
          authority.workspaceId,
          authority.projectId,
          actionId,
          approval,
          approval.subjectHash,
          current.actor.principalId,
          approval.expiresAt,
          createdAt,
        ],
      );
      return {
        actionId,
        approvalId: approval.id,
        candidateHash: hash(candidate),
        state: "PENDING_APPROVAL",
        replayed: false,
      };
    });
  }
  async approve(
    authority: QaCompletionAuthority,
    workItemId: string,
    verdictId: string,
    approvalId: string,
  ): Promise<QaVerdictCosignDecisionResult> {
    await this.authorize(authority);
    return this.source.transaction("READ COMMITTED", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `qa-request:${authority.workspaceId}:${authority.projectId}:${workItemId}`,
      ]);
      const [stored] = rows(
        await manager.query(
          "SELECT a.*,p.candidate_ref,p.candidate_hash,p.state AS action_state,p.row_version AS action_version,p.action_kind AS platform_kind FROM approvals a JOIN platform_actions p ON p.id=a.action_id AND p.workspace_id=a.workspace_id AND p.project_id=a.project_id WHERE a.workspace_id=$1 AND a.project_id=$2 AND a.id=$3 AND p.candidate_ref->'candidate'->'subject'->>'workItemId'=$4 AND p.candidate_ref->'candidate'->'subject'->'verdictRef'->>'id'=$5 FOR UPDATE OF a,p",
          [authority.workspaceId, authority.projectId, approvalId, workItemId, verdictId],
        ),
      );
      if (
        !stored ||
        stored.platform_kind !== "qa.verdict.cosign" ||
        stored.action_kind !== "PLATFORM_ACTION" ||
        stored.action_state !== "PENDING_APPROVAL" ||
        Number(stored.action_version) !== 1 ||
        stored.decision_state !== "PENDING" ||
        stored.effect_authorization_state !== "NOT_AUTHORIZED"
      )
        throw denied();
      const wrapper = stored.candidate_ref as { candidate: Candidate; initiatorId: string };
      const candidate = wrapper.candidate;
      const approval = parseApproval(stored.subject);
      if (
        candidate.initiator.kind !== "HUMAN" ||
        candidate.initiator.principalId !== wrapper.initiatorId ||
        candidate.subject.workspaceId !== authority.workspaceId ||
        candidate.subject.projectId !== authority.projectId ||
        candidate.subject.workItemId !== workItemId ||
        candidate.subject.verdictRef.id !== verdictId ||
        hash(candidate) !== stored.candidate_hash ||
        approval.id !== approvalId ||
        approval.resourceVersion !== Number(stored.row_version) ||
        approval.subjectHash !== stored.subject_hash ||
        approval.decisionStatus !== "PENDING" ||
        approval.effectAuthorizationStatus !== "NOT_AUTHORIZED" ||
        approval.expiresAt.getTime() <= Date.now() ||
        (stored.expires_at as Date).getTime() !== approval.expiresAt.getTime()
      )
        throw denied();
      const [work] = rows(
        await manager.query(
          "SELECT classification_key FROM work_items WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
          [authority.workspaceId, authority.projectId, workItemId],
        ),
      );
      if (!work) throw denied();
      const proof = await this.verdicts.currentForCosign(
        manager,
        currentQaCommandAuthority(
          this.source,
          authority,
          candidate.initiator,
          String(work.classification_key),
        ),
        workItemId,
        verdictId,
      );
      const expected = this.approval(
        approvalId,
        String(stored.action_id),
        candidate,
        proof.bindingRef,
        approval.createdAt,
      );
      if (
        expected.subjectHash !== approval.subjectHash ||
        recomputeExactApprovalSubjectHash(approval) !== expected.subjectHash ||
        proof.resourceVersion !== candidate.expectedResourceVersion ||
        !same(proof.verdict.ref, candidate.subject.verdictRef) ||
        !same(proof.verdict.signatures[0]!.signer, candidate.initiator) ||
        candidate.subject.primarySignerId !== candidate.initiator.principalId
      )
        throw denied();
      const fresh = await this.authorize(authority);
      if (
        !defaultClassificationCatalog.permits(
          defaultClassificationCatalog.reference(fresh.classificationCeiling),
          defaultClassificationCatalog.reference(proof.classificationKey),
        )
      )
        throw denied();
      const lead = await currentQaCommandAuthority(
        this.source,
        authority,
        fresh.actor,
        proof.classificationKey,
      ).authorize("qa.verdict.cosign");
      if (
        !["qa-lead", "QA_LEAD"].includes(lead.roleKey) ||
        fresh.actor.principalId === candidate.initiator.principalId
      )
        throw denied();
      const now = new Date();
      const consumed = await consumeEffectAuthorization(
        decideApproval(approval, {
          approverId: fresh.actor.principalId,
          approverRole: lead.roleKey,
          authorizationBasis: fresh.basis,
          authorizationBasisHash: hash(fresh.basis),
          now,
        }),
        { subjectHash: expected.subjectHash, approverAuthorized: true, now },
      );
      const verdict = proof.verdict;
      const signature = cosignQaVerdict(verdict, {
        actor: fresh.actor,
        role: "QA_LEAD",
        permission: "qa.verdict.cosign",
        liveAuthorized: true,
        authorizationBasisHash: hash(fresh.basis),
        actionRef: { id: String(stored.action_id), version: 1, contentHash: hash(candidate) },
        expiresAt: candidate.expiresAt,
        now: now.toISOString(),
        subjectMatches: true,
      });
      const repository = new TypeOrmQaVerdictDodRepository(manager);
      await repository.appendSignature(authority, workItemId, verdictId, signature);
      await repository.advanceVerdictProjection(verdict, proof.resourceVersion);
      const [action] = rows(
        await manager.query(
          "UPDATE platform_actions SET state='COMPLETED',result=$4,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND row_version=1 AND state='PENDING_APPROVAL' RETURNING id",
          [
            authority.workspaceId,
            authority.projectId,
            stored.action_id,
            { verdictRef: verdict.ref, signature },
          ],
        ),
      );
      const [updated] = rows(
        await manager.query(
          "UPDATE approvals SET subject=$4,decision_state='APPROVED',effect_authorization_state='CONSUMED',approver_id=$5,row_version=$6 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND row_version=$7 AND subject_hash=$8 RETURNING id",
          [
            authority.workspaceId,
            authority.projectId,
            approvalId,
            consumed,
            fresh.actor.principalId,
            consumed.resourceVersion,
            approval.resourceVersion,
            approval.subjectHash,
          ],
        ),
      );
      if (!action || !updated) throw denied();
      await persistQaVerdictSignatureEvents(
        manager,
        verdict,
        fresh,
        proof.classificationKey,
        approvalId,
      );
      return { actionId: String(stored.action_id), approvalId, verdictId, state: "SIGNED" };
    });
  }
  private approval(
    id: string,
    actionId: string,
    candidate: Candidate,
    bindingRef: { id: string; version: number },
    createdAt: Date,
  ) {
    return createExactApproval({
      id,
      workspaceId: candidate.subject.workspaceId,
      projectId: candidate.subject.projectId,
      initiator: candidate.initiator,
      initiatorId: candidate.initiator.principalId,
      action: { actionKind: "PLATFORM_ACTION", actionId, commandType: "qa.verdict.cosign" },
      target: candidate.subject,
      targetHash: hash(candidate.subject),
      payloadHash: hash(candidate),
      expectedState: candidate,
      bindingRef,
      profileRefs: [],
      requiredPermission: "qa.verdict.cosign",
      separationOfDutyPolicy: "SELF_APPROVAL_FORBIDDEN",
      effectIdempotencyKey: `qa:verdict-cosign:${actionId}`,
      expiresAt: new Date(candidate.expiresAt),
      createdAt,
    });
  }
  private async authorize(authority: QaCompletionAuthority) {
    const cosign = await authority.authorize("qa.verdict.cosign");
    const decision = await authority.authorize("approval.decide");
    if (
      !same(cosign.actor, decision.actor) ||
      cosign.actor.kind !== "HUMAN" ||
      [cosign, decision].some(
        (value) =>
          value.scope.workspaceId !== authority.workspaceId ||
          value.scope.projectId !== authority.projectId,
      )
    )
      throw denied();
    const ceiling = [cosign, decision]
      .map((value) => defaultClassificationCatalog.reference(value.classificationCeiling))
      .sort((a, b) => a.rank - b.rank)[0]!.key;
    return { ...decision, classificationCeiling: ceiling };
  }
}
