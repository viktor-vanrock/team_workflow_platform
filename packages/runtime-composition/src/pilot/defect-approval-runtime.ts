import type { DataSource } from "typeorm";

import {
  qaAggregateSnapshotHash,
  type QaAuthorizationBasis,
  type QaHumanActor,
  type QaScope,
} from "@awp/competency-qa/node";
import {
  type Approval,
  approveExternalCommand,
  type ConnectorCommand,
  consumeEffectAuthorization,
  defaultClassificationCatalog,
  recomputeExactApprovalSubjectHash,
  validateApprovalSnapshot,
  validateConnectorCommandSnapshot,
} from "@awp/platform-core";
import { TypeOrmCommandRepository } from "@awp/platform-persistence-typeorm";

import { currentQaDefectCommandAuthority } from "./defect-command-authority.ts";
import type { DurableQaDefectPublicationRuntime } from "./defect-publication-runtime.ts";

export interface QaDefectApprovalAuthority extends QaScope {
  authorize(permission: string): Promise<
    Readonly<{
      actor: QaHumanActor;
      basis: QaAuthorizationBasis;
      scope: QaScope;
      classificationCeiling: string;
    }>
  >;
}
export interface QaDefectApprovalRuntime {
  approve(
    authority: QaDefectApprovalAuthority,
    workItemId: string,
    approvalId: string,
  ): Promise<
    Readonly<{ approvalId: string; commandId: string; defectDraftId: string; state: string }>
  >;
}
type Row = Readonly<Record<string, unknown>>;
const rows = (value: unknown): readonly Row[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Row[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const hash = (value: unknown) => qaAggregateSnapshotHash(value as never);
const denied = () => new Error("QA_DEFECT_APPROVAL_DENIED");
const parseApproval = (value: unknown): Approval => {
  const stored = json<Approval>(value);
  return {
    ...stored,
    expiresAt: new Date(stored.expiresAt),
    createdAt: new Date(stored.createdAt),
    ...(stored.decision
      ? { decision: { ...stored.decision, decidedAt: new Date(stored.decision.decidedAt) } }
      : {}),
    ...(stored.consumedAt ? { consumedAt: new Date(stored.consumedAt) } : {}),
    ...(stored.invalidatedAt ? { invalidatedAt: new Date(stored.invalidatedAt) } : {}),
  };
};

/** Approval releases only the durable outbox. Provider invocation belongs to an authorized worker. */
export class DurableQaDefectApprovalRuntime implements QaDefectApprovalRuntime {
  constructor(
    private readonly source: DataSource,
    private readonly publication: DurableQaDefectPublicationRuntime,
  ) {}
  async approve(authority: QaDefectApprovalAuthority, workItemId: string, approvalId: string) {
    await this.authorize(authority);
    return this.source.transaction("READ COMMITTED", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `qa-defect:${authority.workspaceId}:${authority.projectId}:${workItemId}`,
      ]);
      const [locked] = rows(
        await manager.query(
          `SELECT a.* FROM approvals a JOIN connector_commands c ON c.id=a.action_id AND c.workspace_id=a.workspace_id AND c.project_id=a.project_id
        JOIN qa_defect_drafts d ON d.command_ref->>'id'=c.id::text AND d.workspace_id=c.workspace_id AND d.project_id=c.project_id
        WHERE a.workspace_id=$1 AND a.project_id=$2 AND a.id=$3 AND d.work_item_id=$4 FOR UPDATE OF a,c`,
          [authority.workspaceId, authority.projectId, approvalId, workItemId],
        ),
      );
      if (!locked) throw denied();
      const current = await this.authorize(authority);
      const approval = parseApproval(locked.subject);
      const now = new Date();
      if (
        approval.subjectHash !== locked.subject_hash ||
        recomputeExactApprovalSubjectHash(approval) !== approval.subjectHash ||
        approval.workspaceId !== authority.workspaceId ||
        approval.projectId !== authority.projectId ||
        approval.id !== approvalId ||
        approval.decisionStatus !== locked.decision_state ||
        approval.effectAuthorizationStatus !== locked.effect_authorization_state ||
        approval.resourceVersion !== Number(locked.row_version) ||
        approval.decisionStatus !== "PENDING" ||
        !Number.isFinite(approval.expiresAt.getTime()) ||
        approval.expiresAt <= now ||
        approval.requiredPermission !== "connector.effect.approve" ||
        approval.initiatorId === current.actor.principalId
      )
        throw denied();
      const commands = new TypeOrmCommandRepository(this.source);
      const command = await commands.get(
        authority.workspaceId,
        authority.projectId,
        String(locked.action_id),
        manager,
      );
      if (
        !command ||
        command.actor.kind !== "HUMAN" ||
        command.approvalId !== approval.id ||
        command.source.sourceWorkItemId !== workItemId ||
        approval.action.actionKind !== "EXTERNAL_COMMAND" ||
        approval.action.actionId !== command.id ||
        approval.action.commandType !== command.commandType ||
        approval.action.capabilityKey !== command.capability.key ||
        approval.action.capabilityVersion !== command.capability.exactContractVersion ||
        approval.action.operation !== command.capability.operation ||
        approval.initiatorId !== command.actor.principalId ||
        hash(approval.initiator) !== hash(command.actor) ||
        approval.effectIdempotencyKey !== command.effectIdempotencyKey ||
        approval.targetHash !== command.targetHash ||
        approval.payloadHash !== command.payloadHash ||
        hash(approval.target) !== hash(command.target) ||
        hash(approval.expectedState) !== hash(command.expectedExternalState) ||
        hash(approval.bindingRef) !== hash(command.bindingRef) ||
        hash(approval.profileRefs) !== hash([command.profileRef])
      )
        throw denied();
      if (
        !defaultClassificationCatalog.permits(
          defaultClassificationCatalog.reference(current.classificationCeiling),
          defaultClassificationCatalog.reference(command.dataClassificationKey),
        )
      )
        throw denied();
      await this.publication.assertCommandCurrent(
        manager,
        command,
        currentQaDefectCommandAuthority(
          this.source,
          command,
          command.actor,
          command.dataClassificationKey,
        ),
      );
      const approver = await currentQaDefectCommandAuthority(
        this.source,
        authority,
        current.actor,
        command.dataClassificationKey,
      ).authorize(approval.requiredPermission);
      const fresh = await this.authorize(authority);
      if (hash(fresh.actor) !== hash(current.actor)) throw denied();
      const decisionAt = new Date();
      const approved = approveExternalCommand(command, approval, {
        approverId: fresh.actor.principalId,
        approverRole: approver.roleKey,
        authorizationBasis: fresh.basis,
        authorizationBasisHash: hash(fresh.basis),
        now: decisionAt,
      });
      const consumed = await consumeEffectAuthorization(approved.approval, {
        subjectHash: recomputeExactApprovalSubjectHash(approved.approval),
        approverAuthorized: true,
        now: decisionAt,
      });
      if (consumed.effectAuthorizationStatus !== "CONSUMED") throw denied();
      const next: ConnectorCommand = { ...approved.command, effectAuthorizationStatus: "CONSUMED" };
      validateApprovalSnapshot(consumed);
      validateConnectorCommandSnapshot(next);
      await commands.save(next, command.rowVersion, manager);
      const [changed] = rows(
        await manager.query(
          "UPDATE approvals SET subject=$4,decision_state=$5,effect_authorization_state=$6,approver_id=$7,row_version=$8 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND row_version=$9 AND subject_hash=$10 RETURNING id",
          [
            authority.workspaceId,
            authority.projectId,
            approvalId,
            JSON.stringify(consumed),
            consumed.decisionStatus,
            consumed.effectAuthorizationStatus,
            fresh.actor.principalId,
            consumed.resourceVersion,
            Number(locked.row_version),
            approval.subjectHash,
          ],
        ),
      );
      const [outbox] = rows(
        await manager.query(
          "UPDATE command_outbox SET state='READY',available_at=clock_timestamp(),lease_until=NULL,next_republish_at=NULL WHERE workspace_id=$1 AND project_id=$2 AND command_id=$3 AND state='HELD' RETURNING command_id",
          [authority.workspaceId, authority.projectId, command.id],
        ),
      );
      const [draft] = rows(
        await manager.query(
          "UPDATE qa_defect_drafts SET state='AUTHORIZED',resource_version=resource_version+1,updated_at=clock_timestamp() WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 AND command_ref->>'id'=$4 AND state='AWAITING_APPROVAL' RETURNING defect_draft_id",
          [authority.workspaceId, authority.projectId, workItemId, command.id],
        ),
      );
      if (!changed || !outbox || !draft) throw denied();
      await manager.query(
        "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES(gen_random_uuid(),$1,$2,$3,$4,'qa.defect.approve','ACCEPTED','QA_DEFECT_APPROVED',$5,$6,$7,$8,$9)",
        [
          authority.workspaceId,
          authority.projectId,
          decisionAt,
          fresh.actor,
          command.correlationId,
          command.causationId,
          fresh.basis,
          command.dataClassificationKey,
          {
            commandId: command.id,
            approvalId,
            defectDraftId: draft.defect_draft_id,
            subjectHash: approval.subjectHash,
          },
        ],
      );
      return {
        approvalId,
        commandId: command.id,
        defectDraftId: String(draft.defect_draft_id),
        state: "QUEUED",
      };
    });
  }
  private async authorize(authority: QaDefectApprovalAuthority) {
    const decision = await authority.authorize("approval.decide");
    const effect = await authority.authorize("connector.effect.approve");
    for (const value of [decision, effect]) {
      if (
        value.actor.kind !== "HUMAN" ||
        hash(value.actor) !== hash(decision.actor) ||
        value.scope.workspaceId !== authority.workspaceId ||
        value.scope.projectId !== authority.projectId ||
        value.basis.kind !== "PROJECT" ||
        !value.basis.membershipRef ||
        !value.basis.roleAssignmentRefs.length ||
        !value.basis.entitlementRefs.length
      )
        throw denied();
    }
    return effect;
  }
}
