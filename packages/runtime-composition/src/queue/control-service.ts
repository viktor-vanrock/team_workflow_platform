import type { DataSource, EntityManager } from "typeorm";

import { type QaTriageAssessmentSnapshot, triageAssessmentFingerprint } from "@awp/competency-qa";
import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";
import {
  applyQueueControlEffect,
  type ApprovalAuthorizationScopeWitness,
  type ApprovalSubjectV2,
  assertExactCapacityActionConsumption,
  assertQueueActionConsumedResult,
  type CapacityActionExpectedState,
  consumeApprovalSubjectV2,
  createPlatformActionApprovalV2,
  type ExactCapacityApprovalBinding,
  prepareCapacityQueueAction,
  prepareQueueControlAction,
  projectSafeQueueAuthorizationWitness,
  type QueueActionConsumer,
  type QueueActionPair,
  queueControlDefaultState,
  type QueueControlExpectedState,
  type QueueControlRevision,
  type QueueControlState,
  type QueueEntryCommandRef,
  type QueueExactSourceRef,
  type QueuePlanningValues,
} from "@awp/platform-core";
import {
  QueueActionCandidateRepository,
  TypeOrmApprovalRepository,
} from "@awp/platform-persistence-typeorm";

export interface QueueControlRequest {
  readonly schemaVersion: "queue-control-command@1.0.0";
  readonly requestKey: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly principalId: string;
  readonly commandKind:
    "ACCEPT_PLANNING_VALUES" | "SET_FIXED_DATE" | "SET_EXPEDITE" | "CLEAR_SERVICE_CLASS";
  readonly expectedControlVersion: number;
  readonly expectedQueueEntry: QueueEntryCommandRef;
  readonly acceptedValues?: Readonly<{
    risk: QueuePlanningValues["risk"];
    businessImpact: QueuePlanningValues["businessImpact"];
    dependencyReadiness: QueuePlanningValues["dependencyReadiness"];
    effortRange?: QueuePlanningValues["effortRange"];
  }>;
  readonly triageAssessmentRef?: QueueExactSourceRef;
  readonly requestedServiceClass?: "STANDARD" | "FIXED_DATE" | "EXPEDITE";
  readonly confirmedDueDateRef?: QueueExactSourceRef;
  readonly reviewAt?: string;
  readonly expiresAt?: string;
  readonly reason: string;
}

export interface ExactCapacityActionConsumerPorts {
  currentActionState(pair: QueueActionPair): Promise<
    Readonly<{
      expectedState: CapacityActionExpectedState;
      workItemRef: Readonly<Record<string, JsonValue>>;
    }>
  >;
  approvalBinding(approvalId: string): Promise<ExactCapacityApprovalBinding | undefined>;
  originatingPair(actionId: string): Promise<QueueActionPair | undefined>;
  blockedFromState(pair: QueueActionPair): Promise<"RUNNING" | "REVIEW_REQUIRED" | undefined>;
  persist(
    pair: QueueActionPair,
    context: Readonly<{ approvalId: string; approverId: string }>,
  ): Promise<Readonly<{ resultRef: Readonly<Record<string, JsonValue>> }>>;
}

/** Approval consumption adapter; the persistence port must execute inside the canonical capacity transaction. */
export class ExactCapacityActionConsumer implements QueueActionConsumer<
  Readonly<{ resultRef: Readonly<Record<string, JsonValue>> }>
> {
  readonly key = "queue.capacity.exact-action";
  readonly actionKinds = Object.freeze([
    "SERVICE_CLASS_EXPEDITE",
    "EXPEDITE_CAPACITY_OVERRIDE",
    "WIP_ADMISSION_OVERRIDE",
  ] as const);

  constructor(
    private readonly ports: ExactCapacityActionConsumerPorts,
    private readonly now = () => new Date(),
  ) {}

  async consume(
    pair: QueueActionPair,
    context: Readonly<{
      workspaceId: string;
      projectId: string;
      approvalId: string;
      approverId: string;
      currentAuthorizationWitness: ApprovalAuthorizationScopeWitness;
    }>,
  ) {
    if (
      pair.candidate.scope.kind !== "PROJECT" ||
      pair.candidate.scope.workspaceId !== context.workspaceId ||
      pair.candidate.scope.projectId !== context.projectId
    )
      throw new Error("CAPACITY_ACTION_SCOPE_MISMATCH");
    projectSafeQueueAuthorizationWitness(
      pair.candidate.scope,
      {
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        requiredPermission: context.currentAuthorizationWitness.requiredPermission,
        classificationDecision: "ALLOW",
      },
      context.currentAuthorizationWitness.evaluatedAt,
    );
    const current = await this.ports.currentActionState(pair);
    const effect = pair.witness.requestedEffect as Readonly<Record<string, JsonValue>>;
    const originId =
      effect.kind === "ALLOW_EXPEDITE_CAPACITY"
        ? String((effect.originatingActionRef as Readonly<Record<string, JsonValue>>).sourceId)
        : undefined;
    const [approval, origin, blockedFromState] = await Promise.all([
      pair.candidate.approvalPolicy === "SELF_APPROVAL_FORBIDDEN"
        ? this.ports.approvalBinding(context.approvalId)
        : Promise.resolve(undefined),
      originId ? this.ports.originatingPair(originId) : Promise.resolve(undefined),
      pair.candidate.actionKind === "WIP_ADMISSION_OVERRIDE"
        ? this.ports.blockedFromState(pair)
        : Promise.resolve(undefined),
    ]);
    assertExactCapacityActionConsumption({
      pair,
      currentExpectedState: current.expectedState,
      currentWorkItemRef: current.workItemRef,
      ...(approval ? { approval } : {}),
      ...(origin ? { originatingPair: origin } : {}),
      ...(blockedFromState ? { blockedFromState } : {}),
      now: this.now().toISOString(),
    });
    const result = await this.ports.persist(pair, {
      approvalId: context.approvalId,
      approverId: context.approverId,
    });
    return result;
  }
}

export interface QueueExpediteActionRequest {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly requestKey: string;
  readonly commandKind: "SET_EXPEDITE" | "CLEAR_EXPEDITE";
  readonly expectedControlVersion: number;
  readonly expectedQueueEntry: QueueEntryCommandRef;
  readonly reason: string;
  readonly reviewAt?: string;
  readonly expiresAt?: string;
  readonly actor: Extract<ApprovalSubjectV2["initiator"], { kind: "HUMAN" }>;
}

export interface QueueExpediteActionWorkflowPorts {
  authorize(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      workItemId: string;
      principalId: string;
      permission: "queue.control.request";
    }>,
  ): Promise<
    | Readonly<{
        authorizationScopeWitness: ApprovalAuthorizationScopeWitness;
        authorizationBasis: JsonValue;
      }>
    | undefined
  >;
  current(input: Readonly<{ workspaceId: string; projectId: string; workItemId: string }>): Promise<
    Readonly<{
      expectedState: CapacityActionExpectedState;
      serviceClass: "STANDARD" | "FIXED_DATE" | "EXPEDITE";
      workItemRef: Readonly<Record<string, JsonValue>>;
      authorizedCapacitySnapshotRef: Readonly<{
        id: string;
        version: number;
        semanticHash: Sha256Digest;
      }>;
    }>
  >;
  save(
    input: Readonly<{
      pair: QueueActionPair;
      approval?: ApprovalSubjectV2;
      initiatorId: string;
      authorizationBasis: JsonValue;
      authorizationBasisHash: Sha256Digest;
      createdAt: string;
    }>,
  ): Promise<
    Readonly<{
      replayed: boolean;
      state?: "PENDING_APPROVAL" | "COMPLETED";
      requestedAt?: string;
      resultRef?: Readonly<Record<string, JsonValue>>;
      approvalRef?: Readonly<{
        sourceType: "APPROVAL_SUBJECT_V2";
        sourceId: string;
        sourceVersion: number;
        semanticHash: Sha256Digest;
      }>;
    }>
  >;
  consume(
    pair: QueueActionPair,
    context: Readonly<{
      workspaceId: string;
      projectId: string;
      approvalId: string;
      approverId: string;
      currentAuthorizationWitness: ApprovalAuthorizationScopeWitness;
      approvedSubject?: ApprovalSubjectV2;
      expectedApprovalVersion?: number;
    }>,
  ): Promise<Readonly<{ resultRef: Readonly<Record<string, JsonValue>> }>>;
}

export type QueueExpediteActionReceipt = Readonly<{
  schemaVersion: "queue-action-receipt@1.0.0";
  actionId: string;
  actionKind: "SERVICE_CLASS_EXPEDITE" | "EXPEDITE_CAPACITY_OVERRIDE";
  state: "PENDING_APPROVAL" | "CONSUMED";
  resourceVersion: number;
  approvalRequired: boolean;
  publicIntentHash: Sha256Digest;
  approvalRef?: Readonly<{
    sourceType: "APPROVAL_SUBJECT_V2";
    sourceId: string;
    sourceVersion: number;
    semanticHash: Sha256Digest;
  }>;
  resultRef?: Readonly<Record<string, JsonValue>>;
  requestedAt: string;
  expiresAt?: string;
  replayed: boolean;
}>;

/** Creates and consumes the exact EXPEDITE action families without accepting global capacity facts from HTTP. */
export class QueueExpediteActionWorkflowService {
  constructor(
    private readonly ports: QueueExpediteActionWorkflowPorts,
    private readonly now = () => new Date(),
  ) {}

  async request(input: QueueExpediteActionRequest): Promise<QueueExpediteActionReceipt> {
    if (
      !/^[A-Za-z0-9._:-]{16,200}$/u.test(input.requestKey) ||
      !input.reason.trim() ||
      input.reason.length > 2_000
    )
      throw new Error("QUEUE_EXPEDITE_REQUEST_INVALID");
    const set = input.commandKind === "SET_EXPEDITE";
    if (set) {
      if (
        !input.reviewAt ||
        !input.expiresAt ||
        !Number.isFinite(Date.parse(input.reviewAt)) ||
        !Number.isFinite(Date.parse(input.expiresAt))
      )
        throw new Error("QUEUE_EXPEDITE_WINDOW_REQUIRED");
    } else if (input.reviewAt !== undefined || input.expiresAt !== undefined)
      throw new Error("QUEUE_EXPEDITE_CLEAR_WINDOW_FORBIDDEN");
    const authorization = await this.ports.authorize({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workItemId: input.workItemId,
      principalId: input.actor.principalId,
      permission: "queue.control.request",
    });
    if (!authorization) throw new Error("QUEUE_EXPEDITE_NOT_FOUND");
    const current = await this.ports.current(input);
    if (
      current.expectedState.expectedControlVersion !== input.expectedControlVersion ||
      sha256(current.expectedState.expectedQueueEntry as unknown as JsonValue) !==
        sha256(input.expectedQueueEntry as unknown as JsonValue)
    )
      throw new Error("QUEUE_EXPEDITE_STATE_STALE");
    const actionId = stableUuid(
      `queue-expedite:${input.workspaceId}:${input.projectId}:${input.requestKey}`,
    );
    const requestHash = sha256({
      schemaVersion: "queue-expedite-command@1.0.0",
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workItemId: input.workItemId,
      commandKind: input.commandKind,
      expectedControlVersion: input.expectedControlVersion,
      expectedQueueEntry: input.expectedQueueEntry,
      reason: input.reason,
      reviewAt: input.reviewAt ?? null,
      expiresAt: input.expiresAt ?? null,
    } as JsonValue);
    const effect = set
      ? Object.freeze({
          kind: "SET_EXPEDITE" as const,
          beforeServiceClass: current.serviceClass,
          afterServiceClass: "EXPEDITE" as const,
          reviewAt: input.reviewAt!,
        })
      : Object.freeze({
          kind: "CLEAR_EXPEDITE" as const,
          beforeServiceClass: "EXPEDITE" as const,
          afterServiceClass: "STANDARD" as const,
        });
    if (!set && current.serviceClass !== "EXPEDITE")
      throw new Error("QUEUE_EXPEDITE_CLEAR_STATE_INVALID");
    const pair = prepareCapacityQueueAction({
      actionId,
      actionKind: "SERVICE_CLASS_EXPEDITE",
      requestKey: input.requestKey,
      requestHash,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workItemRef: current.workItemRef,
      expectedState: current.expectedState,
      authorizedCapacitySnapshotRef: current.authorizedCapacitySnapshotRef,
      effect,
      reason: input.reason,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    });
    const createdAt = this.now().toISOString();
    const approvalId = set ? stableUuid(`queue-expedite-approval:${actionId}`) : undefined;
    const approval = approvalId
      ? createPlatformActionApprovalV2({
          approvalId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          initiator: input.actor,
          initiatorAuthorizationScopeWitness: authorization.authorizationScopeWitness,
          action: {
            actionKind: "PLATFORM_ACTION",
            actionId,
            commandType: "queue.service-class.expedite",
          },
          candidate: pair.candidate,
          requiredPermission: "queue.control.request",
          effectIdempotencyKey: `awp:queue-expedite:${actionId}`,
          dataClassificationKey: "INTERNAL",
          expiresAt: input.expiresAt!,
          createdAt,
        })
      : undefined;
    const stored = await this.ports.save({
      pair,
      ...(approval ? { approval } : {}),
      initiatorId: input.actor.principalId,
      authorizationBasis: authorization.authorizationBasis,
      authorizationBasisHash: sha256(authorization.authorizationBasis),
      createdAt,
    });
    const requestedAt = stored.requestedAt ?? createdAt;
    const approvalRef =
      stored.approvalRef ??
      (approval
        ? Object.freeze({
            sourceType: "APPROVAL_SUBJECT_V2" as const,
            sourceId: approval.approvalId,
            sourceVersion: 1 as const,
            semanticHash: approval.subjectHash,
          })
        : undefined);
    if (stored.state === "COMPLETED" && stored.resultRef)
      return Object.freeze({
        schemaVersion: "queue-action-receipt@1.0.0",
        actionId,
        actionKind: "SERVICE_CLASS_EXPEDITE",
        state: "CONSUMED",
        resourceVersion: 1,
        approvalRequired: Boolean(approval),
        publicIntentHash: pair.publicIntentHash,
        ...(approvalRef ? { approvalRef } : {}),
        resultRef: stored.resultRef,
        requestedAt,
        ...(pair.candidate.expiresAt ? { expiresAt: pair.candidate.expiresAt } : {}),
        replayed: stored.replayed,
      });
    if (approval)
      return Object.freeze({
        schemaVersion: "queue-action-receipt@1.0.0",
        actionId,
        actionKind: "SERVICE_CLASS_EXPEDITE",
        state: "PENDING_APPROVAL",
        resourceVersion: 1,
        approvalRequired: true,
        publicIntentHash: pair.publicIntentHash,
        approvalRef: approvalRef!,
        requestedAt,
        expiresAt: pair.candidate.expiresAt!,
        replayed: stored.replayed,
      });
    const consumed = await this.ports.consume(pair, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      approvalId: actionId,
      approverId: input.actor.principalId,
      currentAuthorizationWitness: authorization.authorizationScopeWitness,
    });
    assertQueueActionConsumedResult(pair, consumed);
    return Object.freeze({
      schemaVersion: "queue-action-receipt@1.0.0",
      actionId,
      actionKind: "SERVICE_CLASS_EXPEDITE",
      state: "CONSUMED",
      resourceVersion: 1,
      approvalRequired: false,
      publicIntentHash: pair.publicIntentHash,
      resultRef: consumed.resultRef,
      requestedAt,
      replayed: stored.replayed,
    });
  }

  async requestCapacityOverride(
    input: Readonly<{
      originatingPair: QueueActionPair;
      requestKey: string;
      reason: string;
      expiresAt: string;
      actor: Extract<ApprovalSubjectV2["initiator"], { kind: "HUMAN" }>;
    }>,
  ): Promise<QueueExpediteActionReceipt> {
    if (input.originatingPair.candidate.actionKind !== "SERVICE_CLASS_EXPEDITE")
      throw new Error("EXPEDITE_OVERRIDE_ORIGIN_REQUIRED");
    const scope = input.originatingPair.candidate.scope;
    if (scope.kind !== "PROJECT") throw new Error("EXPEDITE_OVERRIDE_PROJECT_SCOPE_REQUIRED");
    const target = input.originatingPair.candidate.target;
    const targetWorkItemRef = target.workItemRef as Readonly<Record<string, JsonValue>>;
    if (typeof targetWorkItemRef.sourceId !== "string")
      throw new Error("EXPEDITE_OVERRIDE_TARGET_INVALID");
    const workItemId = targetWorkItemRef.sourceId;
    const authorization = await this.ports.authorize({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      workItemId,
      principalId: input.actor.principalId,
      permission: "queue.control.request",
    });
    if (!authorization) throw new Error("QUEUE_EXPEDITE_NOT_FOUND");
    const current = await this.ports.current({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      workItemId,
    });
    if (
      sha256(current.workItemRef as unknown as JsonValue) !==
      sha256(targetWorkItemRef as unknown as JsonValue)
    )
      throw new Error("EXPEDITE_OVERRIDE_TARGET_STALE");
    const originatingEffect = input.originatingPair.witness.requestedEffect as Readonly<
      Record<string, JsonValue>
    >;
    if (originatingEffect.kind !== "SET_EXPEDITE")
      throw new Error("EXPEDITE_OVERRIDE_SET_ORIGIN_REQUIRED");
    const actionId = stableUuid(
      `queue-expedite-capacity-override:${scope.workspaceId}:${scope.projectId}:${input.requestKey}`,
    );
    const pair = prepareCapacityQueueAction({
      actionId,
      actionKind: "EXPEDITE_CAPACITY_OVERRIDE",
      requestKey: input.requestKey,
      requestHash: sha256({
        originatingActionId: input.originatingPair.actionId,
        reason: input.reason,
        expiresAt: input.expiresAt,
      } as JsonValue),
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      workItemRef: current.workItemRef,
      expectedState: current.expectedState,
      authorizedCapacitySnapshotRef: current.authorizedCapacitySnapshotRef,
      effect: Object.freeze({
        kind: "ALLOW_EXPEDITE_CAPACITY" as const,
        workItemRef: current.workItemRef,
        originatingActionRef: Object.freeze({
          sourceType: "QUEUE_ACTION_CANDIDATE" as const,
          sourceId: input.originatingPair.actionId,
          sourceVersion: 1 as const,
          semanticHash: input.originatingPair.publicIntentHash,
        }),
        originatingActionHash: input.originatingPair.actionHash,
        requestedExpediteEffect: originatingEffect as unknown as {
          kind: "SET_EXPEDITE";
          beforeServiceClass: "STANDARD" | "FIXED_DATE" | "EXPEDITE";
          afterServiceClass: "EXPEDITE";
          reviewAt: string;
        },
      }),
      reason: input.reason,
      expiresAt: input.expiresAt,
    });
    const createdAt = this.now().toISOString();
    const approvalId = stableUuid(`queue-expedite-capacity-override-approval:${actionId}`);
    const approval = createPlatformActionApprovalV2({
      approvalId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      initiator: input.actor,
      initiatorAuthorizationScopeWitness: authorization.authorizationScopeWitness,
      action: {
        actionKind: "PLATFORM_ACTION",
        actionId,
        commandType: "queue.expedite.capacity-override",
      },
      candidate: pair.candidate,
      requiredPermission: "queue.control.request",
      effectIdempotencyKey: `awp:queue-expedite-capacity-override:${actionId}`,
      dataClassificationKey: "INTERNAL",
      expiresAt: input.expiresAt,
      createdAt,
    });
    const stored = await this.ports.save({
      pair,
      approval,
      initiatorId: input.actor.principalId,
      authorizationBasis: authorization.authorizationBasis,
      authorizationBasisHash: sha256(authorization.authorizationBasis),
      createdAt,
    });
    const requestedAt = stored.requestedAt ?? createdAt;
    const approvalRef =
      stored.approvalRef ??
      Object.freeze({
        sourceType: "APPROVAL_SUBJECT_V2" as const,
        sourceId: approvalId,
        sourceVersion: 1 as const,
        semanticHash: approval.subjectHash,
      });
    if (stored.state === "COMPLETED" && stored.resultRef)
      return Object.freeze({
        schemaVersion: "queue-action-receipt@1.0.0",
        actionId,
        actionKind: "EXPEDITE_CAPACITY_OVERRIDE",
        state: "CONSUMED",
        resourceVersion: 1,
        approvalRequired: true,
        publicIntentHash: pair.publicIntentHash,
        approvalRef,
        resultRef: stored.resultRef,
        requestedAt,
        expiresAt: pair.candidate.expiresAt!,
        replayed: stored.replayed,
      });
    return Object.freeze({
      schemaVersion: "queue-action-receipt@1.0.0",
      actionId,
      actionKind: "EXPEDITE_CAPACITY_OVERRIDE",
      state: "PENDING_APPROVAL",
      resourceVersion: 1,
      approvalRequired: true,
      publicIntentHash: pair.publicIntentHash,
      approvalRef,
      requestedAt,
      expiresAt: pair.candidate.expiresAt!,
      replayed: stored.replayed,
    });
  }

  async consumeApproved(
    pair: QueueActionPair,
    context: Readonly<{
      workspaceId: string;
      projectId: string;
      approvalId: string;
      approverId: string;
      currentAuthorizationWitness: ApprovalAuthorizationScopeWitness;
      approvedSubject?: ApprovalSubjectV2;
      expectedApprovalVersion?: number;
    }>,
  ) {
    if (
      !new Set(["SERVICE_CLASS_EXPEDITE", "EXPEDITE_CAPACITY_OVERRIDE"]).has(
        pair.candidate.actionKind,
      )
    )
      throw new Error("QUEUE_EXPEDITE_ACTION_KIND_INVALID");
    const result = await this.ports.consume(pair, context);
    assertQueueActionConsumedResult(pair, result);
    return result;
  }
}

const exactRows = (value: unknown): readonly Readonly<Record<string, unknown>>[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw?.[0]) ? raw[0] : raw) as readonly Readonly<Record<string, unknown>>[];
};
const exactJson = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

/**
 * Builds the binder's exact override resolver after the normal admission path has
 * acquired capacity→control→Session locks. Approval/action consumption remains
 * on that same transaction and is rolled back if the eventual Session CAS fails.
 */
export function createPostgresExactCapacityOverrideResolver(
  source: DataSource,
  context: Readonly<{
    pair: QueueActionPair;
    approved: ApprovalSubjectV2;
    expectedApprovalVersion: number;
    now: string;
  }>,
) {
  return async (
    manager: EntityManager,
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      workItemId: string;
      sessionId?: string;
      expectedState: Readonly<{
        sessionRef?: Readonly<Record<string, JsonValue>>;
        operationalProjectionRef: Readonly<Record<string, JsonValue>>;
      }>;
      blockedFromState?: "RUNNING" | "REVIEW_REQUIRED";
    }>,
  ) => {
    const pair = context.pair;
    if (
      pair.candidate.actionKind !== "WIP_ADMISSION_OVERRIDE" &&
      pair.candidate.actionKind !== "EXPEDITE_CAPACITY_OVERRIDE"
    )
      return undefined;
    if (
      pair.candidate.scope.kind !== "PROJECT" ||
      pair.candidate.scope.workspaceId !== input.workspaceId ||
      pair.candidate.scope.projectId !== input.projectId ||
      pair.candidate.target.projectId !== input.projectId
    )
      throw new Error("CAPACITY_ACTION_SCOPE_MISMATCH");
    if (
      context.approved.action.actionKind !== "PLATFORM_ACTION" ||
      context.approved.action.actionId !== pair.actionId ||
      context.approved.decisionStatus !== "APPROVED" ||
      context.approved.effectAuthorizationStatus !== "AUTHORIZED" ||
      context.approved.payloadHash !== pair.publicIntentHash ||
      !context.approved.decision
    )
      throw new Error("CAPACITY_ACTION_APPROVAL_INVALID");
    const [capacity] = exactRows(
      await manager.query("SELECT * FROM workspace_capacity_heads WHERE workspace_id=$1", [
        input.workspaceId,
      ]),
    );
    const [control] = exactRows(
      await manager.query(
        `SELECT head.resource_version,revision.service_class
         FROM work_item_queue_control_heads head
         LEFT JOIN work_item_queue_control_revisions revision
           ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id
          AND revision.control_revision_id=head.current_revision_id
        WHERE head.workspace_id=$1 AND head.project_id=$2 AND head.work_item_id=$3`,
        [input.workspaceId, input.projectId, input.workItemId],
      ),
    );
    const [queue] = exactRows(
      await manager.query(
        `SELECT head.queue_entry_id,revision.revision_number,revision.semantic_hash,revision.input_fingerprint,revision.subject
         FROM queue_entry_heads head JOIN queue_entry_revisions revision
           ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id
          AND revision.queue_entry_revision_id=head.current_revision_id
        WHERE head.workspace_id=$1 AND head.project_id=$2 AND head.work_item_id=$3 AND head.suppressed_by_work_item_id IS NULL`,
        [input.workspaceId, input.projectId, input.workItemId],
      ),
    );
    if (!capacity || !queue) throw new Error("CAPACITY_ACTION_STATE_NOT_FOUND");
    const policyRef = exactJson<
      Readonly<{ sourceId: string; sourceVersion: number; semanticHash: `sha256:${string}` }>
    >(capacity.policy_ref);
    const [policy] = exactRows(
      await manager.query(
        "SELECT mode,workspace_human_wip_limit,active_expedite_limit FROM workspace_queue_policy_revisions WHERE workspace_id=$1 AND policy_revision_id=$2 AND revision_number=$3 AND semantic_hash=$4",
        [input.workspaceId, policyRef.sourceId, policyRef.sourceVersion, policyRef.semanticHash],
      ),
    );
    if (!policy) throw new Error("CAPACITY_ACTION_POLICY_STALE");
    const subject = exactJson<Readonly<Record<string, JsonValue>>>(queue.subject);
    if (
      subject.kind !== "WORK_ITEM" ||
      subject.id !== input.workItemId ||
      typeof subject.version !== "number" ||
      typeof subject.semanticHash !== "string"
    ) {
      throw new Error("CAPACITY_ACTION_TARGET_SCOPE_MISMATCH");
    }
    const currentExpectedState: CapacityActionExpectedState = Object.freeze({
      kind: "CAPACITY",
      policyRef: Object.freeze({
        id: policyRef.sourceId,
        version: policyRef.sourceVersion,
        semanticHash: policyRef.semanticHash,
      }),
      policyMode: String(policy.mode) as "MEASURE_ONLY" | "ENFORCED",
      expectedControlVersion: Number(control?.resource_version ?? 0),
      expectedQueueEntry: Object.freeze({
        queueEntryId: String(queue.queue_entry_id),
        revision: Number(queue.revision_number),
        semanticHash: String(queue.semantic_hash) as `sha256:${string}`,
        inputFingerprint: String(queue.input_fingerprint) as `sha256:${string}`,
      }),
      expectedCapacityHeadVersion: Number(capacity.resource_version),
      workspaceHumanWipLimit:
        policy.workspace_human_wip_limit === null ? null : Number(policy.workspace_human_wip_limit),
      activeExpediteLimit:
        policy.active_expedite_limit === null ? null : Number(policy.active_expedite_limit),
      humanOccupiedCount: Number(capacity.human_occupied_count),
      reviewReservedCount: Number(capacity.review_reserved_count),
      humanCommittedCount: Number(capacity.human_committed_count),
      forcedExternalCount: Number(capacity.forced_external_count),
      activeExpediteCount: Number(capacity.active_expedite_count),
      claimSetHash: String(capacity.claim_set_hash) as `sha256:${string}`,
      reservationSetHash: String(capacity.reservation_set_hash) as `sha256:${string}`,
      expediteSetHash: String(capacity.expedite_set_hash) as `sha256:${string}`,
      ...(input.expectedState.sessionRef ? { sessionRef: input.expectedState.sessionRef } : {}),
      operationalProjectionRef: input.expectedState.operationalProjectionRef,
    });
    const effect = pair.witness.requestedEffect as Readonly<Record<string, JsonValue>>;
    const originId =
      effect.kind === "ALLOW_EXPEDITE_CAPACITY"
        ? String((effect.originatingActionRef as Readonly<Record<string, JsonValue>>).sourceId)
        : undefined;
    const originatingPair = originId
      ? await new QueueActionCandidateRepository(source).scopedPair(
          { kind: "PROJECT", workspaceId: input.workspaceId, projectId: input.projectId },
          originId,
          manager,
        )
      : undefined;
    assertExactCapacityActionConsumption({
      pair,
      currentExpectedState,
      currentWorkItemRef: Object.freeze({
        sourceType: "WORK_ITEM_REVISION",
        sourceId: input.workItemId,
        sourceVersion: subject.version,
        semanticHash: subject.semanticHash,
      }),
      approval: Object.freeze({
        approvalId: context.approved.approvalId,
        state: "APPROVED",
        initiatorId: context.approved.initiator.principalId,
        approverId: context.approved.decision.approver.principalId,
        approverRole: context.approved.decision.approverRole,
        expiresAt: context.approved.expiresAt,
      }),
      ...(originatingPair ? { originatingPair } : {}),
      ...(input.blockedFromState ? { blockedFromState: input.blockedFromState } : {}),
      now: context.now,
    });
    const actionCandidateRef = Object.freeze({
      sourceType: "QUEUE_ACTION_CANDIDATE",
      sourceId: pair.actionId,
      sourceVersion: 1,
      semanticHash: pair.publicIntentHash,
    });
    const approvalRef = Object.freeze({
      sourceType: "APPROVAL_SUBJECT_V2",
      sourceId: context.approved.approvalId,
      sourceVersion: context.approved.resourceVersion + 1,
      semanticHash: context.approved.subjectHash,
    });
    return Object.freeze({
      actionKind: pair.candidate.actionKind,
      effectKind: effect.kind as "ALLOW_WIP_ADMISSION" | "ALLOW_EXPEDITE_CAPACITY",
      actionCandidateRef,
      approvalRef,
      publicIntentHash: pair.publicIntentHash,
      consume: async (
        transaction: EntityManager,
        decisionRef: Readonly<{
          sourceType: "CAPACITY_ADMISSION_DECISION";
          sourceId: string;
          sourceVersion: 1;
          semanticHash: `sha256:${string}`;
        }>,
      ) => {
        const currentWitness = context.approved.decision?.authorizationScopeWitness;
        if (!currentWitness) throw new Error("CAPACITY_ACTION_CURRENT_SCOPE_REQUIRED");
        const consumed = consumeApprovalSubjectV2({
          subject: context.approved,
          currentSubjectHash: context.approved.subjectHash,
          currentAuthorizationScopeWitness: currentWitness,
          now: context.now,
        });
        if (consumed.resourceVersion !== approvalRef.sourceVersion)
          throw new Error("CAPACITY_ACTION_APPROVAL_VERSION_MISMATCH");
        await new TypeOrmApprovalRepository(transaction as unknown as DataSource).saveV2(
          consumed,
          context.expectedApprovalVersion,
        );
        const updated = exactRows(
          await transaction.query(
            "UPDATE platform_actions SET state='COMPLETED',result=$4,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND state='PENDING_APPROVAL' AND row_version=1 RETURNING id",
            [
              input.workspaceId,
              input.projectId,
              pair.actionId,
              JSON.stringify({ resultRef: decisionRef }),
            ],
          ),
        );
        if (updated.length !== 1) throw new Error("CAPACITY_ACTION_PLATFORM_CAS_CONFLICT");
        assertQueueActionConsumedResult(pair, { resultRef: decisionRef });
      },
    });
  };
}

export interface QueueControlReadContext {
  readonly current: QueueControlState;
  readonly currentQueueEntry: QueueEntryCommandRef;
  readonly workItemRef: QueueExactSourceRef;
  readonly assessment?: QaTriageAssessmentSnapshot;
  readonly currentAssessmentFingerprint?: string;
}

export interface QueueControlCommitReceipt {
  readonly replayed: boolean;
  readonly revision: QueueControlRevision;
}

export interface QueueControlServicePorts {
  authorize(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      workItemId: string;
      principalId: string;
      permission: "queue.control.request";
    }>,
  ): Promise<boolean>;
  read(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      workItemId: string;
      triageAssessmentRef?: QueueExactSourceRef;
    }>,
  ): Promise<QueueControlReadContext>;
  replay?(
    input: Readonly<{ actionId: string; requestHash: Sha256Digest }>,
  ): Promise<
    Readonly<{ publicIntentHash: Sha256Digest; revision: QueueControlRevision }> | undefined
  >;
  commit(
    input: Readonly<{
      pair: QueueActionPair;
      revision: QueueControlRevision;
      requestHash: Sha256Digest;
    }>,
  ): Promise<QueueControlCommitReceipt>;
  emit?(event: Readonly<Record<string, JsonValue>>): Promise<void>;
}

const stableUuid = (identity: string): string => {
  const hex = sha256(identity).slice(7).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
};

export function queueControlActionId(
  input: Pick<QueueControlRequest, "workspaceId" | "projectId" | "requestKey">,
): string {
  return stableUuid(`queue-control:${input.workspaceId}:${input.projectId}:${input.requestKey}`);
}

export function queueControlRequestHash(input: QueueControlRequest): Sha256Digest {
  return sha256({
    schemaVersion: input.schemaVersion,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workItemId: input.workItemId,
    commandKind: input.commandKind,
    expectedControlVersion: input.expectedControlVersion,
    expectedQueueEntry: input.expectedQueueEntry,
    acceptedValues: input.acceptedValues ?? null,
    triageAssessmentRef: input.triageAssessmentRef ?? null,
    requestedServiceClass: input.requestedServiceClass ?? null,
    confirmedDueDateRef: input.confirmedDueDateRef ?? null,
    reviewAt: input.reviewAt ?? null,
    expiresAt: input.expiresAt ?? null,
    reason: input.reason,
  } as JsonValue);
}

function controlReceipt(
  input: Readonly<{
    actionId: string;
    publicIntentHash: Sha256Digest;
    revision: QueueControlRevision;
    replayed: boolean;
  }>,
) {
  return Object.freeze({
    schemaVersion: "queue-action-receipt@1.0.0",
    actionId: input.actionId,
    actionKind: "QUEUE_CONTROL_ACCEPT" as const,
    state: "CONSUMED" as const,
    resourceVersion: input.revision.revision,
    approvalRequired: false,
    publicIntentHash: input.publicIntentHash,
    resultRef: Object.freeze({
      sourceType: "WORK_ITEM_QUEUE_CONTROL_REVISION" as const,
      sourceId: input.revision.revisionId,
      sourceVersion: input.revision.revision,
      semanticHash: input.revision.semanticHash,
    }),
    requestedAt: input.revision.recordedAt,
    replayed: input.replayed,
  });
}

function exactAssessment(
  input: QueueControlRequest,
  context: QueueControlReadContext,
  now: Date,
): QueueExactSourceRef | undefined {
  if (!input.triageAssessmentRef) return undefined;
  const assessment = context.assessment;
  const expected = input.triageAssessmentRef;
  if (
    !assessment ||
    expected.sourceType !== "TRIAGE_ASSESSMENT_REVISION" ||
    assessment.id !== expected.sourceId ||
    assessment.revision !== expected.sourceVersion ||
    assessment.contentHash !== expected.semanticHash
  )
    throw new Error("QUEUE_CONTROL_TRIAGE_ASSESSMENT_NOT_FOUND");
  if (assessment.state !== "CURRENT" || now >= assessment.expiresAt)
    throw new Error("QUEUE_CONTROL_TRIAGE_ASSESSMENT_STALE");
  if (
    assessment.content.schemaVersion === "triage-assessment@1.1.0" &&
    (assessment.content.inputFingerprint !== triageAssessmentFingerprint(assessment.content) ||
      (context.currentAssessmentFingerprint !== undefined &&
        context.currentAssessmentFingerprint !== assessment.content.inputFingerprint))
  ) {
    throw new Error("QUEUE_CONTROL_TRIAGE_ASSESSMENT_SOURCE_DRIFT");
  }
  return expected;
}

function acceptedValues(input: QueueControlRequest): QueuePlanningValues {
  if (!input.acceptedValues) throw new Error("QUEUE_CONTROL_ACCEPTED_VALUES_REQUIRED");
  return Object.freeze({
    risk: input.acceptedValues.risk,
    businessImpact: input.acceptedValues.businessImpact,
    dependencyReadiness: input.acceptedValues.dependencyReadiness,
    effortRange: input.acceptedValues.effortRange ?? Object.freeze({ kind: "UNKNOWN" as const }),
  });
}

export class QueueControlService {
  readonly #receipts = new Map<
    string,
    Readonly<{ requestHash: Sha256Digest; receipt: ReturnType<typeof controlReceipt> }>
  >();

  constructor(
    private readonly ports: QueueControlServicePorts,
    private readonly now = () => new Date(),
  ) {}

  async request(input: QueueControlRequest) {
    if (
      input.schemaVersion !== "queue-control-command@1.0.0" ||
      !input.requestKey.trim() ||
      !input.reason.trim()
    ) {
      throw new Error("QUEUE_CONTROL_COMMAND_INVALID");
    }
    if (input.reason.length > 2_000) throw new Error("QUEUE_CONTROL_REASON_INVALID");
    if (input.commandKind === "ACCEPT_PLANNING_VALUES") {
      if (
        !input.acceptedValues ||
        input.requestedServiceClass !== undefined ||
        input.confirmedDueDateRef !== undefined ||
        input.reviewAt !== undefined ||
        input.expiresAt !== undefined
      ) {
        throw new Error("QUEUE_CONTROL_ACCEPT_COMMAND_INVALID");
      }
      if (
        Object.keys(input.acceptedValues).some(
          (key) =>
            !new Set(["risk", "businessImpact", "dependencyReadiness", "effortRange"]).has(key),
        )
      ) {
        throw new Error("QUEUE_CONTROL_ACCEPTED_VALUES_INVALID");
      }
    } else if (input.commandKind === "SET_FIXED_DATE") {
      if (!input.confirmedDueDateRef) throw new Error("QUEUE_CONTROL_CONFIRMED_DUE_DATE_REQUIRED");
      if (
        input.requestedServiceClass !== "FIXED_DATE" ||
        input.acceptedValues !== undefined ||
        input.triageAssessmentRef !== undefined ||
        input.reviewAt !== undefined ||
        input.expiresAt !== undefined
      ) {
        throw new Error("QUEUE_CONTROL_FIXED_DATE_COMMAND_INVALID");
      }
    } else if (input.commandKind === "CLEAR_SERVICE_CLASS") {
      if (
        input.requestedServiceClass !== "STANDARD" ||
        input.acceptedValues !== undefined ||
        input.triageAssessmentRef !== undefined ||
        input.confirmedDueDateRef !== undefined ||
        input.reviewAt !== undefined ||
        input.expiresAt !== undefined
      ) {
        throw new Error("QUEUE_CONTROL_CLEAR_COMMAND_INVALID");
      }
    } else if (input.requestedServiceClass !== "EXPEDITE" || !input.reviewAt || !input.expiresAt) {
      throw new Error("QUEUE_CONTROL_EXPEDITE_COMMAND_INVALID");
    }
    const actionId = queueControlActionId(input);
    const requestHash = queueControlRequestHash(input);
    const replay = this.#receipts.get(actionId);
    if (replay) {
      if (replay.requestHash !== requestHash) throw new Error("QUEUE_CONTROL_IDEMPOTENCY_CONFLICT");
      return Object.freeze({ ...replay.receipt, replayed: true });
    }
    if (!(await this.ports.authorize({ ...input, permission: "queue.control.request" })))
      throw new Error("QUEUE_CONTROL_NOT_FOUND");
    const durableReplay = await this.ports.replay?.({ actionId, requestHash });
    if (durableReplay)
      return controlReceipt({
        actionId,
        publicIntentHash: durableReplay.publicIntentHash,
        revision: durableReplay.revision,
        replayed: true,
      });
    if (input.commandKind === "SET_EXPEDITE")
      throw new Error("QUEUE_CONTROL_EXPEDITE_DEDICATED_ACTION_REQUIRED");
    const context = await this.ports.read(input);
    if (context.current.resourceVersion !== input.expectedControlVersion)
      throw new Error("QUEUE_CONTROL_CAS_CONFLICT");
    const assessmentRef = exactAssessment(input, context, this.now());
    const expectedState: QueueControlExpectedState = Object.freeze({
      kind: "WORK_ITEM_CONTROL",
      policyRef: context.current.policyRef,
      expectedControlVersion: input.expectedControlVersion,
      expectedQueueEntry: input.expectedQueueEntry,
      operationalProjectionRef: context.current.operationalProjectionRef,
      qaSourceSetHash: context.current.qaSourceSetHash,
    });
    const effect =
      input.commandKind === "ACCEPT_PLANNING_VALUES"
        ? Object.freeze({
            kind: "ACCEPT_PLANNING_VALUES" as const,
            after: acceptedValues(input),
            ...(assessmentRef ? { triageAssessmentRef: assessmentRef } : {}),
          })
        : input.commandKind === "SET_FIXED_DATE"
          ? Object.freeze({
              kind: "SET_FIXED_DATE" as const,
              confirmedDueDateRef:
                input.confirmedDueDateRef ??
                (() => {
                  throw new Error("QUEUE_CONTROL_CONFIRMED_DUE_DATE_REQUIRED");
                })(),
            })
          : Object.freeze({ kind: "CLEAR_SERVICE_CLASS" as const });
    const pair = prepareQueueControlAction({
      actionId,
      requestKey: input.requestKey,
      requestHash,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workItemId: input.workItemId,
      workItemRef: context.workItemRef,
      current: context.current,
      currentQueueEntry: context.currentQueueEntry,
      expectedState,
      effect,
      reason: input.reason,
    });
    const recordedAt = this.now().toISOString();
    const revision = applyQueueControlEffect({
      pair,
      current: context.current,
      revisionId: stableUuid(`queue-control-revision:${actionId}`),
      actorId: input.principalId,
      recordedAt,
    });
    const committed = await this.ports.commit({ pair, revision, requestHash });
    if (!committed.replayed && this.ports.emit)
      await this.ports.emit(
        Object.freeze({
          eventType: "queue.control.changed",
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          workItemId: input.workItemId,
          queueEntryId: input.expectedQueueEntry.queueEntryId,
          revision: committed.revision.revision,
          calculatedAt: recordedAt,
          cause: "CONTROL_TRANSITION",
        }),
      );
    const receipt = controlReceipt({
      actionId,
      publicIntentHash: pair.publicIntentHash,
      revision: committed.revision,
      replayed: committed.replayed,
    });
    this.#receipts.set(actionId, Object.freeze({ requestHash, receipt }));
    return receipt;
  }
}

export interface QueueControlConsumerPorts {
  current(pair: QueueActionPair): Promise<QueueControlState>;
  currentQueueEntry(pair: QueueActionPair): Promise<QueueEntryCommandRef>;
  persist(revision: QueueControlRevision, pair: QueueActionPair): Promise<QueueControlRevision>;
}

export class AcceptedQueueControlConsumer implements QueueActionConsumer<
  Readonly<{ resultRef: Readonly<Record<string, JsonValue>> }>
> {
  readonly key = "queue.control.accept";
  readonly actionKinds = Object.freeze(["QUEUE_CONTROL_ACCEPT"] as const);

  constructor(
    private readonly ports: QueueControlConsumerPorts,
    private readonly now = () => new Date(),
  ) {}

  async consume(
    pair: QueueActionPair,
    context: Readonly<{
      workspaceId: string;
      projectId: string;
      approvalId: string;
      approverId: string;
      currentAuthorizationWitness: ApprovalAuthorizationScopeWitness;
    }>,
  ) {
    if (
      pair.candidate.scope.kind !== "PROJECT" ||
      pair.candidate.scope.projectId !== context.projectId ||
      pair.candidate.scope.workspaceId !== context.workspaceId
    )
      throw new Error("QUEUE_CONTROL_SCOPE_MISMATCH");
    projectSafeQueueAuthorizationWitness(
      pair.candidate.scope,
      {
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        requiredPermission: context.currentAuthorizationWitness.requiredPermission,
        classificationDecision: "ALLOW",
      },
      context.currentAuthorizationWitness.evaluatedAt,
    );
    const current = await this.ports.current(pair);
    const expected = pair.witness.expectedState as QueueControlExpectedState;
    const queueEntry = await this.ports.currentQueueEntry(pair);
    if (
      current.resourceVersion !== expected.expectedControlVersion ||
      sha256(queueEntry as JsonValue) !== sha256(expected.expectedQueueEntry as JsonValue)
    ) {
      throw new Error("QUEUE_CONTROL_APPROVAL_STATE_CHANGED");
    }
    const revision = applyQueueControlEffect({
      pair,
      current,
      revisionId: stableUuid(`queue-control-approved:${pair.actionId}:${context.approvalId}`),
      actorId: context.approverId,
      recordedAt: this.now().toISOString(),
    });
    const stored = await this.ports.persist(revision, pair);
    return Object.freeze({
      resultRef: Object.freeze({
        sourceType: "WORK_ITEM_QUEUE_CONTROL_REVISION",
        sourceId: stored.revisionId,
        sourceVersion: stored.revision,
        semanticHash: stored.semanticHash,
      }),
    });
  }
}

export function defaultQueueControlReadContext(
  input: Parameters<typeof queueControlDefaultState>[0] &
    Readonly<{
      currentQueueEntry: QueueEntryCommandRef;
      workItemRef: QueueExactSourceRef;
    }>,
): QueueControlReadContext {
  return Object.freeze({
    current: queueControlDefaultState(input),
    currentQueueEntry: input.currentQueueEntry,
    workItemRef: input.workItemRef,
  });
}
