import type { DataSource, EntityManager } from "typeorm";

import {
  ManualExecutionUnitOfWork,
  qaAggregateSnapshotHash,
  type QaAuthorizationBasis,
  type QaHumanActor,
  qaSessionPlanningAudit,
  qaSessionStateChangedEvent,
  resumeBlockedTestSession,
  startPreparedTestSession,
  TypeOrmManualSessionRepository,
} from "@awp/competency-qa/node";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  type Approval,
  type ApprovalSubjectV2,
  decideApproval,
  decideApprovalSubjectV2,
  projectSafeQueueAuthorizationWitness,
  type QueueActionCandidateForApproval,
} from "@awp/platform-core";
import {
  QueueActionCandidateRepository,
  TypeOrmApprovalRepository,
} from "@awp/platform-persistence-typeorm";
import type { ApprovalsV11ApiPort } from "@awp/platform-runtime-nest";

import { RuntimeQaManualSessionAdmissionAdapter } from "../qa/platform-adapters.ts";
import { createPostgresExactCapacityOverrideResolver } from "./control-service.ts";
import { createPostgresQueueExpediteActionWorkflow } from "./expedite-action-runtime.ts";
import type { QueueHttpAuthority, QueueRuntimeRequest } from "./http-authority.ts";

export interface QueueApprovalAuthorizationInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorSubject: string;
  readonly permission: string;
}

export interface QueueApprovalAuthorization {
  readonly actor: QaHumanActor;
  readonly basis: QaAuthorizationBasis;
  /** An identity adapter may narrow the persisted classification grant. */
  readonly classificationCeiling?: "PUBLIC" | "INTERNAL" | "RESTRICTED" | "CONFIDENTIAL";
}

export interface QueueApprovalAuthorizer {
  authorize(
    input: QueueApprovalAuthorizationInput,
  ): Promise<QueueApprovalAuthorization | undefined>;
}

const deterministicUuid = (namespace: string): string => {
  const hex = sha256(namespace).slice(7);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

async function appendApprovedSessionTransition(
  manager: EntityManager,
  previous: NonNullable<Awaited<ReturnType<TypeOrmManualSessionRepository["get"]>>>,
  next: NonNullable<Awaited<ReturnType<TypeOrmManualSessionRepository["get"]>>>,
  actor: Extract<ApprovalSubjectV2["initiator"], { kind: "HUMAN" }>,
  basis: QaAuthorizationBasis,
  at: string,
  correlationId: string,
  causationId: string,
): Promise<void> {
  const projectRows = (await manager.query(
    "SELECT classification_key FROM projects WHERE workspace_id=$1 AND id=$2",
    [next.workspaceId, next.projectId],
  )) as readonly Readonly<{ classification_key: string }>[];
  const classificationKey = projectRows[0]?.classification_key ?? "INTERNAL";
  const context = Object.freeze({
    actor,
    scope: { kind: "PROJECT" as const, workspaceId: next.workspaceId, projectId: next.projectId },
    correlationId,
    causationId,
    authorizationBasis: basis,
  });
  const eventId = deterministicUuid(`approved-session-event:${next.id}:${next.resourceVersion}`);
  const event = qaSessionStateChangedEvent({
    context,
    eventId,
    previousState: previous.state,
    session: next,
    occurredAt: at,
    classificationKey,
  });
  const audit = qaSessionPlanningAudit(previous, next);
  await manager.query(
    "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'READY',$7) ON CONFLICT(id) DO NOTHING",
    [
      eventId,
      next.workspaceId,
      next.projectId,
      event.eventType,
      JSON.stringify(event.payload),
      qaAggregateSnapshotHash(event.payload as never),
      at,
    ],
  );
  await manager.query(
    "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    [
      deterministicUuid(`approved-session-audit:${next.id}:${next.resourceVersion}`),
      next.workspaceId,
      next.projectId,
      at,
      JSON.stringify(actor),
      audit.action,
      audit.outcome,
      audit.reasonCode,
      correlationId,
      causationId,
      JSON.stringify(basis),
      classificationKey,
      JSON.stringify({ values: audit.attributes ?? {}, versionRefs: [] }),
    ],
  );
}

async function consumeApprovedWipOverride(
  source: DataSource,
  pending: ApprovalSubjectV2,
  approved: ApprovalSubjectV2,
) {
  const initiator = approved.initiator;
  if (
    pending.action.actionKind !== "PLATFORM_ACTION" ||
    approved.action.actionKind !== "PLATFORM_ACTION" ||
    initiator.kind !== "HUMAN"
  )
    throw new Error("WIP_OVERRIDE_APPROVAL_SUBJECT_INVALID");
  const pairRepository = new QueueActionCandidateRepository(source);
  const pair = await pairRepository.getQueueActionPair(
    approved.workspaceId,
    approved.projectId,
    approved.action.actionId,
  );
  if (!pair || pair.candidate.actionKind !== "WIP_ADMISSION_OVERRIDE")
    throw new Error("WIP_OVERRIDE_ACTION_NOT_FOUND");
  const effect = pair.witness.requestedEffect as Readonly<Record<string, JsonValue>>;
  if (
    effect.kind !== "ALLOW_WIP_ADMISSION" ||
    typeof effect.sessionRef !== "object" ||
    effect.sessionRef === null ||
    Array.isArray(effect.sessionRef)
  )
    throw new Error("WIP_OVERRIDE_EFFECT_INVALID");
  const sessionRef = effect.sessionRef as Readonly<Record<string, JsonValue>>;
  const at = new Date().toISOString();
  await source.transaction("SERIALIZABLE", async (manager) => {
    const actionRows = (await manager.query(
      "SELECT initiator_authorization_basis FROM queue_action_candidates WHERE workspace_id=$1 AND project_id=$2 AND action_id=$3",
      [approved.workspaceId, approved.projectId, pair.actionId],
    )) as readonly Readonly<{ initiator_authorization_basis: unknown }>[];
    const basis = (
      typeof actionRows[0]?.initiator_authorization_basis === "string"
        ? JSON.parse(actionRows[0].initiator_authorization_basis)
        : actionRows[0]?.initiator_authorization_basis
    ) as QaAuthorizationBasis | undefined;
    if (!basis) throw new Error("WIP_OVERRIDE_INITIATOR_BASIS_MISSING");
    const repository = new TypeOrmManualSessionRepository(manager);
    const previous = await repository.get(
      { workspaceId: approved.workspaceId, projectId: approved.projectId },
      String(sessionRef.sourceId),
    );
    const targetRef = pair.candidate.target.workItemRef as Readonly<Record<string, JsonValue>>;
    if (!previous || previous.mode !== "MANUAL" || previous.workItemId !== targetRef.sourceId)
      throw new Error("WIP_OVERRIDE_SESSION_NOT_FOUND");
    const requestedState = String(effect.requestedSessionState);
    const next =
      String(effect.activityKind) === "MANUAL_SESSION_RESUME"
        ? resumeBlockedTestSession(previous, {
            actor: initiator,
            at,
            target: requestedState as "RUNNING" | "REVIEW_REQUIRED",
            expectedResourceVersion: previous.resourceVersion,
          })
        : startPreparedTestSession(previous, {
            actor: initiator,
            at,
            expectedResourceVersion: previous.resourceVersion,
            confirmedOperationalReady: true,
          });
    const correlationId = deterministicUuid(`wip-override-correlation:${pair.actionId}`);
    const causationId = approved.approvalId;
    const resolver = createPostgresExactCapacityOverrideResolver(source, {
      pair,
      approved,
      expectedApprovalVersion: pending.resourceVersion,
      now: at,
    });
    const admission = new RuntimeQaManualSessionAdmissionAdapter(manager, {
      actor: initiator,
      authorizationBasis: basis,
      correlationId,
      causationId,
      requestKey: `approved-wip-override:${pair.actionId}`,
      resolveExactOverride: resolver,
    });
    const persisted = await new ManualExecutionUnitOfWork(manager, admission).persistTransition(
      previous,
      next,
    );
    if (!persisted.persisted || persisted.admission?.outcome !== "ADMITTED_WITH_EXACT_OVERRIDE")
      throw new Error("WIP_OVERRIDE_ADMISSION_NOT_CONSUMED");
    await appendApprovedSessionTransition(
      manager,
      previous,
      next,
      initiator,
      basis,
      at,
      correlationId,
      causationId,
    );
  });
  return await new TypeOrmApprovalRepository(source).getV2(
    approved.workspaceId,
    approved.projectId,
    approved.approvalId,
  );
}

async function consumeApprovedExpedite(
  source: DataSource,
  pending: ApprovalSubjectV2,
  approved: ApprovalSubjectV2,
  currentAuthorizationWitness: NonNullable<
    ApprovalSubjectV2["decision"]
  >["authorizationScopeWitness"],
) {
  if (
    !currentAuthorizationWitness ||
    pending.action.actionKind !== "PLATFORM_ACTION" ||
    approved.action.actionKind !== "PLATFORM_ACTION" ||
    !approved.decision
  ) {
    throw new Error("EXPEDITE_APPROVAL_SUBJECT_INVALID");
  }
  const pair = await new QueueActionCandidateRepository(source).getQueueActionPair(
    approved.workspaceId,
    approved.projectId,
    approved.action.actionId,
  );
  if (
    !pair ||
    !new Set(["SERVICE_CLASS_EXPEDITE", "EXPEDITE_CAPACITY_OVERRIDE"]).has(
      pair.candidate.actionKind,
    )
  ) {
    throw new Error("EXPEDITE_APPROVAL_ACTION_NOT_FOUND");
  }
  const at = new Date();
  const workflow = createPostgresQueueExpediteActionWorkflow(
    source,
    {
      authorize: async () => {
        throw new Error("EXPEDITE_APPROVAL_REQUEST_PATH_FORBIDDEN");
      },
    },
    () => at,
  );
  await workflow.consumeApproved(pair, {
    workspaceId: approved.workspaceId,
    projectId: approved.projectId,
    approvalId: approved.approvalId,
    approverId: approved.decision.approver.principalId,
    currentAuthorizationWitness,
    approvedSubject: approved,
    expectedApprovalVersion: pending.resourceVersion,
  });
  return await new TypeOrmApprovalRepository(source).getV2(
    approved.workspaceId,
    approved.projectId,
    approved.approvalId,
  );
}

export function createRuntimeApprovalsV11Api(
  source: DataSource,
  authority: QueueHttpAuthority,
): ApprovalsV11ApiPort {
  const repository = new TypeOrmApprovalRepository(source);
  const authorize = async (
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      request: QueueRuntimeRequest;
      permission: string;
    }>,
  ) => {
    try {
      return await authority.project(
        input.request,
        input.workspaceId,
        input.projectId,
        input.permission,
      );
    } catch {
      return undefined;
    }
  };
  const approverRole = async (
    workspaceId: string,
    projectId: string,
    access: QueueApprovalAuthorization,
  ): Promise<string | undefined> => {
    const roles = (await source.query(
      `SELECT role.role_key FROM role_assignments role
      JOIN jsonb_to_recordset($4::jsonb) AS basis(id uuid,version integer) ON basis.id=role.id AND basis.version=role.row_version
      WHERE role.workspace_id=$1 AND (role.project_id=$2 OR role.project_id IS NULL) AND role.principal_id=$3
        AND role.effect='ALLOW' AND role.revoked_at IS NULL AND role.valid_from<=clock_timestamp()
        AND (role.valid_until IS NULL OR role.valid_until>clock_timestamp())
      ORDER BY CASE WHEN role.role_key IN ('qa-lead','Lead') THEN 0 ELSE 1 END,role.role_key`,
      [
        workspaceId,
        projectId,
        access.actor.principalId,
        JSON.stringify(access.basis.roleAssignmentRefs),
      ],
    )) as readonly { role_key: string }[];
    return roles[0]?.role_key;
  };
  const authorizeV2Scope = async (
    subject: ApprovalSubjectV2,
    request: QueueRuntimeRequest,
    permission: string,
  ) => {
    const project = await authorize({
      workspaceId: subject.workspaceId,
      projectId: subject.projectId,
      request,
      permission,
    });
    if (!project) return undefined;
    const candidate =
      subject.action.actionKind === "PLATFORM_ACTION"
        ? (subject.target.value as QueueActionCandidateForApproval)
        : undefined;
    if (!candidate || candidate.scope.kind === "PROJECT") return project;
    let identity: Awaited<ReturnType<QueueHttpAuthority["portfolio"]>>;
    try {
      identity = await authority.portfolio(request, subject.workspaceId, [
        permission === "queue.project.read" ? "queue.portfolio.read" : permission,
      ]);
    } catch {
      return undefined;
    }
    const currentHash = sha256([...identity.projectIds].sort() as unknown as JsonValue);
    return currentHash === candidate.scope.authorizedProjectSetHash
      ? Object.freeze({ ...project, authorizedProjectSetHash: currentHash })
      : undefined;
  };
  const api: ApprovalsV11ApiPort = {
    get: async ({ workspaceId, projectId, approvalId, request }) => {
      const access = await authorize({
        workspaceId,
        projectId,
        request,
        permission: "queue.project.read",
      });
      if (!access) return undefined;
      const subject = await repository.getSubject(workspaceId, projectId, approvalId);
      if (!subject) return undefined;
      if (
        "subjectSchemaId" in subject &&
        !(await authorizeV2Scope(subject, request, "queue.project.read"))
      )
        return undefined;
      return subject;
    },
    decide: async ({ workspaceId, projectId, approvalId, request, decision }) => {
      if (!(await authorize({ workspaceId, projectId, request, permission: "queue.project.read" })))
        return undefined;
      const permission = decision === "APPROVE" ? "queue.control.approve" : "queue.control.reject";
      const subject = await repository.getSubject(workspaceId, projectId, approvalId);
      if (!subject) return undefined;
      if (
        !Number.isFinite(new Date(subject.expiresAt).getTime()) ||
        new Date(subject.expiresAt).getTime() <= Date.now()
      )
        return undefined;
      if (!("subjectSchemaId" in subject)) {
        if (subject.decisionStatus !== "PENDING") return undefined;
        const access = await authorize({
          workspaceId,
          projectId,
          request,
          permission: "approval.decide",
        });
        if (!access) return undefined;
        const role = await approverRole(workspaceId, projectId, access);
        if (!role) return undefined;
        const updated =
          decision === "APPROVE"
            ? decideApproval(subject as Approval, {
                approverId: access.actor.principalId,
                approverRole: role,
                authorizationBasisHash: sha256(access.basis as unknown as JsonValue),
                authorizationBasis: access.basis,
                now: new Date(),
              })
            : {
                ...subject,
                decisionStatus: "REJECTED" as const,
                effectAuthorizationStatus: "NOT_AUTHORIZED" as const,
                decision: {
                  approverId: access.actor.principalId,
                  approverRole: role,
                  authorizationBasisHash: sha256(access.basis as unknown as JsonValue),
                  authorizationBasis: access.basis,
                  decidedAt: new Date(),
                },
                resourceVersion: subject.resourceVersion + 1,
              };
        await repository.save(updated, subject.resourceVersion);
        return updated;
      }
      const decisionAccess = await authorize({ workspaceId, projectId, request, permission });
      const access = await authorizeV2Scope(subject, request, subject.requiredPermission);
      if (
        !decisionAccess ||
        !access ||
        decisionAccess.actor.principalId !== access.actor.principalId
      )
        return undefined;
      const role = await approverRole(workspaceId, projectId, decisionAccess);
      if (!role) return undefined;
      const candidate =
        subject.action.actionKind === "PLATFORM_ACTION"
          ? (subject.target.value as QueueActionCandidateForApproval)
          : undefined;
      const scopeWitness = candidate
        ? projectSafeQueueAuthorizationWitness(
            candidate.scope,
            {
              workspaceId,
              projectId,
              requiredPermission: subject.requiredPermission,
              classificationDecision: "ALLOW",
              ...(candidate.scope.kind === "AUTHORIZED_PORTFOLIO"
                ? { authorizedProjectSetHash: candidate.scope.authorizedProjectSetHash }
                : {}),
            },
            new Date().toISOString(),
          )
        : undefined;
      const updated = decideApprovalSubjectV2({
        subject,
        decision,
        approver: access.actor,
        approverRole: role,
        ...(scopeWitness
          ? { authorizationScopeWitness: scopeWitness }
          : { authorizationBasis: access.basis }),
        now: new Date().toISOString(),
      });
      if (decision === "APPROVE" && candidate?.actionKind === "WIP_ADMISSION_OVERRIDE") {
        return await consumeApprovedWipOverride(source, subject, updated);
      }
      if (
        decision === "APPROVE" &&
        candidate &&
        new Set(["SERVICE_CLASS_EXPEDITE", "EXPEDITE_CAPACITY_OVERRIDE"]).has(candidate.actionKind)
      ) {
        return await consumeApprovedExpedite(source, subject, updated, scopeWitness);
      }
      await repository.saveV2(updated, subject.resourceVersion);
      return updated;
    },
  };
  return Object.freeze(api);
}
