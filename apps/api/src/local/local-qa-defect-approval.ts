import { randomUUID } from "node:crypto";

import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { DataSource } from "typeorm";

import {
  createQaTypeOrmDefectConfirmationHook,
  qaAggregateSnapshotHash,
  QaDomainError,
} from "@awp/competency-qa/node";
import {
  type Approval,
  approveExternalCommand,
  type ConnectorCommand,
  consumeEffectAuthorization,
  recomputeExactApprovalSubjectHash,
  validateApprovalSnapshot,
  validateConnectorCommandSnapshot,
} from "@awp/platform-core";
import {
  TypeOrmCommandRepository,
  TypeOrmIdentityRepository,
} from "@awp/platform-persistence-typeorm";
import {
  type DurableQaDefectPublicationRuntime,
  loadEnvironment,
  type QaDefectApprovalAuthority,
  type QaDefectApprovalRuntime,
  type QaLocalOperationalBrokerMap,
  qaUs4OperationalDefectRoute,
} from "@awp/runtime-composition";

type Row = Readonly<Record<string, unknown>>;
const parsedApproval = (value: unknown): Approval => {
  const stored = json<Record<string, unknown>>(value);
  const decision =
    stored.decision && typeof stored.decision === "object" && !Array.isArray(stored.decision)
      ? (stored.decision as Record<string, unknown>)
      : undefined;
  return {
    ...stored,
    expiresAt: new Date(String(stored.expiresAt)),
    createdAt: new Date(String(stored.createdAt)),
    ...(decision
      ? { decision: { ...decision, decidedAt: new Date(String(decision.decidedAt)) } }
      : {}),
    ...(stored.invalidatedAt ? { invalidatedAt: new Date(String(stored.invalidatedAt)) } : {}),
    ...(stored.consumedAt ? { consumedAt: new Date(String(stored.consumedAt)) } : {}),
  } as unknown as Approval;
};
const rows = (value: unknown): readonly Readonly<Record<string, unknown>>[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as readonly Readonly<Record<string, unknown>>[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const local = () => {
  if (!["local", "test"].includes(process.env.AWP_RUNTIME_PROFILE ?? ""))
    throw new Error("LOCAL_QA_DEFECT_APPROVAL_FORBIDDEN");
};

export function createLocalQaDefectApproval(
  source: DataSource,
  _publication: DurableQaDefectPublicationRuntime,
  broker?: QaLocalOperationalBrokerMap,
): QaDefectApprovalRuntime {
  local();
  return new LocalQaDefectApproval(source, broker);
}

/** Historical local compatibility: native Jira queues the command; the mock executes synchronously. */
class LocalQaDefectApproval implements QaDefectApprovalRuntime {
  constructor(
    private readonly source: DataSource,
    private readonly broker?: QaLocalOperationalBrokerMap,
  ) {}
  async approve(authority: QaDefectApprovalAuthority, workItemId: string, approvalId: string) {
    local();
    const { workspaceId, projectId } = authority;
    const authorization = await authority.authorize("qa.defect.publish");
    const jiraDurable = loadEnvironment().composition === "qa-jira-local";
    if (!jiraDurable && !this.broker) throw new ConflictException("QA_DEFECT_BROKER_UNAVAILABLE");
    const matches = rows(
      await this.source.query(
        `SELECT a.*,c.id AS command_id,c.actor AS command_actor,c.target,c.payload,c.binding_ref,c.profile_ref,c.effect_idempotency_key,c.correlation_id,c.causation_id,c.state AS command_state,d.defect_draft_id,d.state AS draft_state,d.resource_version AS draft_resource_version
       FROM approvals a JOIN connector_commands c ON c.id=a.action_id AND c.workspace_id=a.workspace_id AND c.project_id=a.project_id
       JOIN qa_defect_drafts d ON d.command_ref->>'id'=c.id::text AND d.workspace_id=c.workspace_id AND d.project_id=c.project_id
       WHERE a.id=$1 AND a.workspace_id=$2 AND a.project_id=$3 AND d.work_item_id=$4`,
        [approvalId, workspaceId, projectId, workItemId],
      ),
    );
    const approval = matches[0];
    if (!approval) throw new NotFoundException("QA_DEFECT_APPROVAL_NOT_FOUND");
    if (approval.initiator_id === authorization.actor.principalId)
      throw new ForbiddenException("QA_DEFECT_SELF_APPROVAL_FORBIDDEN");
    if (
      approval.decision_state !== "PENDING" ||
      !["PENDING", "NOT_AUTHORIZED"].includes(String(approval.effect_authorization_state)) ||
      Date.parse(String(approval.expires_at)) <= Date.now()
    )
      throw new ConflictException("QA_DEFECT_APPROVAL_NOT_LIVE");
    if (jiraDurable) return this.#approveDurable(approval, authorization);
    const service = await new TypeOrmIdentityRepository(this.source).findByVerifiedSubject(
      loadEnvironment().identityIssuer,
      "worker.local",
    );
    if (service?.kind !== "SERVICE")
      throw new ForbiddenException("LOCAL_QA_DEFECT_SERVICE_REQUIRED");
    const storedPayload = json<Readonly<{ value: Readonly<Record<string, unknown>> }>>(
      approval.payload,
    );
    const target = json<
      Readonly<{
        workspaceId: string;
        projectId: string;
        entityKind: "DEFECT";
        authorityScopeKey: string;
        naturalKey: string;
      }>
    >(approval.target);
    const profileRef = json<Readonly<{ id: string; version: number }>>(approval.profile_ref);
    const bindingRef = json<Readonly<{ id: string; version: number }>>(approval.binding_ref);
    const effectIdempotencyKey = String(approval.effect_idempotency_key);
    await this.source.transaction("SERIALIZABLE", async (manager) => {
      const decided = rows(
        await manager.query(
          "UPDATE approvals SET decision_state='APPROVED',effect_authorization_state='CONSUMED',approver_id=$1,row_version=row_version+1 WHERE id=$2 AND workspace_id=$3 AND project_id=$4 AND decision_state='PENDING' AND effect_authorization_state IN('PENDING','NOT_AUTHORIZED') AND expires_at>clock_timestamp() RETURNING id",
          [authorization.actor.principalId, approvalId, workspaceId, projectId],
        ),
      )[0];
      if (!decided) throw new QaDomainError("QA_DEFECT_APPROVAL_CONSUMPTION_RACE");
      await manager.query(
        "UPDATE qa_defect_drafts SET state='AUTHORIZED',resource_version=resource_version+1,updated_at=clock_timestamp() WHERE defect_draft_id=$1 AND state='AWAITING_APPROVAL'",
        [approval.defect_draft_id],
      );
      await manager.query(
        "UPDATE qa_defect_drafts SET state='DISPATCHED',command_ref=$1,effect_key_hash=$2,resource_version=resource_version+1,updated_at=clock_timestamp() WHERE defect_draft_id=$3 AND state='AUTHORIZED'",
        [
          JSON.stringify({ id: approval.command_id }),
          qaAggregateSnapshotHash(effectIdempotencyKey as never),
          approval.defect_draft_id,
        ],
      );
      await manager.query(
        "UPDATE connector_commands SET state='IN_FLIGHT',row_version=row_version+1 WHERE id=$1 AND state='AWAITING_APPROVAL'",
        [approval.command_id],
      );
    });
    try {
      const result = await this.broker![qaUs4OperationalDefectRoute].invoke(
        {
          scope: { kind: "PROJECT", workspaceId, projectId },
          actor: {
            kind: "SERVICE",
            principalId: service.id,
            serviceKey: "qa-local-defect-dispatch",
          },
          correlationId: String(approval.correlation_id),
          causationId: String(approval.causation_id),
          effectIdempotencyKey,
          profileRef,
          classification: { key: String(storedPayload.value.dataClassificationKey), rank: 10 },
          signal: new AbortController().signal,
        },
        target,
        storedPayload.value as never,
      );
      const hook = createQaTypeOrmDefectConfirmationHook();
      await this.source.transaction("SERIALIZABLE", async (manager) => {
        await hook.apply(
          {
            workspaceId,
            projectId,
            commandId: String(approval.command_id),
            effectIdempotencyKey,
            capabilityKey: "operational-work-item",
            capabilityVersion: "1.0.0",
            operation: "defect.create",
            result,
            source: { sourceWorkItemId: workItemId },
            bindingRef,
            profileRefs: [profileRef],
            correlationId: String(approval.correlation_id),
            causationId: String(approval.causation_id),
            resultRefs: { confirmationReceiptId: randomUUID(), operationalResultId: randomUUID() },
          },
          {
            transactionId: randomUUID(),
            native: manager,
            contributionKey: hook.key,
            idempotencyKey: `${String(approval.command_id)}:confirmation:${hook.key}`,
          },
        );
        await manager.query(
          "UPDATE connector_commands SET state='CONFIRMED',result=$1,row_version=row_version+1 WHERE id=$2 AND state='IN_FLIGHT'",
          [JSON.stringify(result), approval.command_id],
        );
      });
      return {
        approvalId,
        commandId: String(approval.command_id),
        defectDraftId: String(approval.defect_draft_id),
        state: "LINKED",
        result,
      };
    } catch (error) {
      await this.source.transaction(async (manager) => {
        await manager.query(
          "UPDATE qa_defect_drafts SET state='FAILED',terminal_from_state='DISPATCHED',failure_code='DEFECT_CREATE_FAILED',terminal_reason=$1,resource_version=resource_version+1,updated_at=clock_timestamp() WHERE defect_draft_id=$2 AND state='DISPATCHED'",
          ["DEFECT_CREATE_FAILED", approval.defect_draft_id],
        );
        await manager.query(
          "UPDATE connector_commands SET state='FAILED',result=$1,row_version=row_version+1 WHERE id=$2 AND state='IN_FLIGHT'",
          [JSON.stringify({ code: "DEFECT_CREATE_FAILED" }), approval.command_id],
        );
      });
      throw error;
    }
  }

  async #approveDurable(
    approvalRow: Row,
    authorization: Awaited<ReturnType<QaDefectApprovalAuthority["authorize"]>>,
  ) {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const locked = rows(
        await manager.query(
          "SELECT * FROM approvals WHERE workspace_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
          [approvalRow.workspace_id, approvalRow.project_id, approvalRow.id],
        ),
      )[0];
      if (!locked) throw new QaDomainError("QA_DEFECT_APPROVAL_NOT_FOUND");
      const approval = parsedApproval(locked.subject);
      if (
        approval.subjectHash !== String(locked.subject_hash) ||
        recomputeExactApprovalSubjectHash(approval) !== approval.subjectHash
      )
        throw new QaDomainError("QA_DEFECT_APPROVAL_SUBJECT_CHANGED");
      const commands = new TypeOrmCommandRepository(this.source);
      const command = await commands.get(
        String(locked.workspace_id),
        String(locked.project_id),
        String(locked.action_id),
        manager,
      );
      if (
        !command ||
        command.capability.operation !== "defect.create" ||
        command.commandType !== "qa.defect.create"
      )
        throw new QaDomainError("QA_DEFECT_COMMAND_NOT_FOUND");
      const now = new Date();
      const approved = approveExternalCommand(command, approval, {
        approverId: authorization.actor.principalId,
        approverRole: "QA_LEAD",
        authorizationBasisHash: qaAggregateSnapshotHash(authorization.basis as never),
        authorizationBasis: authorization.basis,
        now,
      });
      const consumed = await consumeEffectAuthorization(approved.approval, {
        subjectHash: recomputeExactApprovalSubjectHash(approved.approval),
        approverAuthorized: true,
        now,
      });
      const nextCommand: ConnectorCommand = {
        ...approved.command,
        effectAuthorizationStatus: "CONSUMED",
      };
      validateApprovalSnapshot(consumed);
      validateConnectorCommandSnapshot(nextCommand);
      await commands.save(nextCommand, command.rowVersion, manager);
      const changed = rows(
        await manager.query(
          "UPDATE approvals SET subject=$4,decision_state=$5,effect_authorization_state=$6,approver_id=$7,row_version=$8 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND row_version=$9 AND subject_hash=$10 RETURNING id",
          [
            locked.workspace_id,
            locked.project_id,
            locked.id,
            JSON.stringify(consumed),
            consumed.decisionStatus,
            consumed.effectAuthorizationStatus,
            consumed.decision?.approverId ?? null,
            consumed.resourceVersion,
            Number(locked.row_version),
            approval.subjectHash,
          ],
        ),
      )[0];
      if (!changed) throw new QaDomainError("QA_DEFECT_APPROVAL_CONSUMPTION_RACE");
      await manager.query(
        "UPDATE command_outbox SET state='READY',available_at=clock_timestamp(),lease_until=NULL,next_republish_at=NULL WHERE workspace_id=$1 AND project_id=$2 AND command_id=$3 AND state='HELD'",
        [locked.workspace_id, locked.project_id, command.id],
      );
      const draft = rows(
        await manager.query(
          "UPDATE qa_defect_drafts SET state='AUTHORIZED',resource_version=resource_version+1,updated_at=clock_timestamp() WHERE workspace_id=$1 AND project_id=$2 AND command_ref->>'id'=$3 AND state='AWAITING_APPROVAL' RETURNING defect_draft_id",
          [locked.workspace_id, locked.project_id, command.id],
        ),
      )[0];
      if (!draft) throw new QaDomainError("QA_DEFECT_DRAFT_AUTHORIZATION_RACE");
      return Object.freeze({
        approvalId: approval.id,
        commandId: command.id,
        defectDraftId: String(draft.defect_draft_id),
        state: "QUEUED",
      });
    });
  }
}
