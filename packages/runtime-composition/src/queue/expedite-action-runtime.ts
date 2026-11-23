import type { DataSource, EntityManager } from "typeorm";

import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  assertExactCapacityActionConsumption,
  assertQueueActionConsumedResult,
  authorizedProjectSetHash,
  type CapacityActionExpectedState,
  consumeApprovalSubjectV2,
  type QueueActionPair,
} from "@awp/platform-core";
import {
  CapacityAdmissionRepository,
  QueueActionCandidateRepository,
  TypeOrmApprovalRepository,
} from "@awp/platform-persistence-typeorm";

import { PostgresCapacityAdmissionBinder } from "./admission-service.ts";
import {
  createPostgresExactCapacityOverrideResolver,
  type QueueExpediteActionWorkflowPorts,
  QueueExpediteActionWorkflowService,
} from "./control-service.ts";

type QuerySource = Pick<DataSource, "query"> | Pick<EntityManager, "query">;
type Row = Readonly<Record<string, unknown>>;

const rows = (value: unknown): readonly Row[] => {
  const raw = value as readonly unknown[];
  return (Array.isArray(raw?.[0]) ? raw[0] : raw) as readonly Row[];
};
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const uuid = (namespace: string): string => {
  const hex = sha256(namespace).slice(7).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
};

export interface PostgresQueueExpediteContext {
  readonly expectedState: CapacityActionExpectedState;
  readonly serviceClass: "STANDARD" | "FIXED_DATE" | "EXPEDITE";
  readonly workItemRef: Readonly<Record<string, JsonValue>>;
  readonly authorizedCapacitySnapshotRef: Readonly<{
    id: string;
    version: number;
    semanticHash: `sha256:${string}`;
  }>;
  readonly policyFacetRef: Readonly<{
    id: string;
    version: number;
    semanticHash: `sha256:${string}`;
  }>;
  readonly qaSourceSetHash: `sha256:${string}`;
}

/** Loads private Workspace capacity facts and the viewer-safe Project snapshot without serializing either to HTTP. */
export async function readPostgresQueueExpediteContext(
  source: QuerySource,
  input: Readonly<{ workspaceId: string; projectId: string; workItemId: string }>,
): Promise<PostgresQueueExpediteContext> {
  const [capacity] = rows(
    await source.query("SELECT * FROM workspace_capacity_heads WHERE workspace_id=$1", [
      input.workspaceId,
    ]),
  );
  if (!capacity) throw new Error("QUEUE_EXPEDITE_CAPACITY_NOT_READY");
  const policyRef = json<
    Readonly<{ sourceId: string; sourceVersion: number; semanticHash: `sha256:${string}` }>
  >(capacity.policy_ref);
  const [policy] = rows(
    await source.query(
      "SELECT mode,workspace_human_wip_limit,active_expedite_limit FROM workspace_queue_policy_revisions WHERE workspace_id=$1 AND policy_revision_id=$2 AND revision_number=$3 AND semantic_hash=$4",
      [input.workspaceId, policyRef.sourceId, policyRef.sourceVersion, policyRef.semanticHash],
    ),
  );
  if (
    !policy ||
    String(policy.mode) !== String(capacity.state) ||
    !new Set(["MEASURE_ONLY", "ENFORCED"]).has(String(policy.mode))
  ) {
    throw new Error("QUEUE_EXPEDITE_POLICY_NOT_READY");
  }
  const [queue] = rows(
    await source.query(
      `SELECT head.queue_entry_id,revision.revision_number,revision.semantic_hash,revision.input_fingerprint,
            revision.subject,revision.operational_facet,revision.qa_facet,revision.policy_facet_ref,revision.source_set_hash
       FROM queue_entry_heads head
       JOIN queue_entry_revisions revision
         ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id
        AND revision.queue_entry_revision_id=head.current_revision_id
      WHERE head.workspace_id=$1 AND head.project_id=$2 AND head.work_item_id=$3
        AND head.suppressed_by_work_item_id IS NULL`,
      [input.workspaceId, input.projectId, input.workItemId],
    ),
  );
  if (!queue) throw new Error("QUEUE_EXPEDITE_QUEUE_ENTRY_NOT_FOUND");
  const subject = json<Readonly<Record<string, JsonValue>>>(queue.subject);
  const operational = json<Readonly<Record<string, JsonValue>>>(queue.operational_facet);
  const qa = json<Readonly<Record<string, JsonValue>>>(queue.qa_facet);
  const facet = json<Readonly<{ id: string; version: number; semanticHash: `sha256:${string}` }>>(
    queue.policy_facet_ref,
  );
  const operationalProjectionRef = operational.projectionRef as
    Readonly<Record<string, JsonValue>> | undefined;
  const qaFactsRef = qa.factsRef as Readonly<Record<string, JsonValue>> | undefined;
  if (
    subject.kind !== "WORK_ITEM" ||
    subject.id !== input.workItemId ||
    typeof subject.version !== "number" ||
    typeof subject.semanticHash !== "string" ||
    operational.state !== "KNOWN" ||
    !operationalProjectionRef ||
    typeof qaFactsRef?.semanticHash !== "string"
  )
    throw new Error("QUEUE_EXPEDITE_SOURCE_FACTS_INCOMPLETE");
  const [control] = rows(
    await source.query(
      `SELECT head.resource_version,revision.service_class
       FROM work_item_queue_control_heads head
       LEFT JOIN work_item_queue_control_revisions revision
         ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id
        AND revision.control_revision_id=head.current_revision_id
      WHERE head.workspace_id=$1 AND head.project_id=$2 AND head.work_item_id=$3`,
      [input.workspaceId, input.projectId, input.workItemId],
    ),
  );
  const setHash = authorizedProjectSetHash([input.projectId]);
  const [projection] = rows(
    await source.query(
      `SELECT revision.safe_body
       FROM capacity_scope_projection_heads head
       JOIN capacity_scope_projection_revisions revision
         ON revision.workspace_id=head.workspace_id
        AND revision.capacity_projection_revision_id=head.current_revision_id
      WHERE head.workspace_id=$1 AND head.scope_kind='PROJECT' AND head.project_id=$2
        AND head.authorized_project_set_hash=$3`,
      [input.workspaceId, input.projectId, setHash],
    ),
  );
  if (!projection) throw new Error("QUEUE_EXPEDITE_CAPACITY_PROJECTION_NOT_READY");
  const safeCapacity = json<Readonly<Record<string, JsonValue>>>(projection.safe_body);
  const authorizedRef = safeCapacity.authorizedProjectionRef as
    Readonly<{ id?: unknown; version?: unknown; semanticHash?: unknown }> | undefined;
  if (
    safeCapacity.freshness !== "CURRENT" ||
    !authorizedRef ||
    typeof authorizedRef.id !== "string" ||
    !Number.isSafeInteger(authorizedRef.version) ||
    typeof authorizedRef.semanticHash !== "string"
  ) {
    throw new Error("QUEUE_EXPEDITE_CAPACITY_PROJECTION_STALE");
  }
  const expectedState: CapacityActionExpectedState = Object.freeze({
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
    operationalProjectionRef,
  });
  return Object.freeze({
    expectedState,
    serviceClass: String(
      control?.service_class ?? "STANDARD",
    ) as PostgresQueueExpediteContext["serviceClass"],
    workItemRef: Object.freeze({
      sourceType: "WORK_ITEM_REVISION",
      sourceId: input.workItemId,
      sourceVersion: subject.version,
      semanticHash: subject.semanticHash,
    }),
    authorizedCapacitySnapshotRef: Object.freeze({
      id: authorizedRef.id,
      version: Number(authorizedRef.version),
      semanticHash: authorizedRef.semanticHash as `sha256:${string}`,
    }),
    policyFacetRef: facet,
    qaSourceSetHash: qaFactsRef.semanticHash as `sha256:${string}`,
  });
}

export interface PostgresQueueExpediteWorkflowAuthorization {
  authorize: QueueExpediteActionWorkflowPorts["authorize"];
}

/** Concrete exact-action lifecycle used by both the control route and Approval v2 consumption. */
export function createPostgresQueueExpediteActionWorkflow(
  source: DataSource,
  authorization: PostgresQueueExpediteWorkflowAuthorization,
  now = () => new Date(),
): QueueExpediteActionWorkflowService {
  const ports: QueueExpediteActionWorkflowPorts = {
    authorize: authorization.authorize,
    current: async (input) => await readPostgresQueueExpediteContext(source, input),
    save: async ({
      pair,
      approval,
      initiatorId,
      authorizationBasis,
      authorizationBasisHash,
      createdAt,
    }) =>
      await source.transaction("SERIALIZABLE", async (manager) => {
        const repository = new QueueActionCandidateRepository(source);
        const stored = await repository.saveQueueActionPair(
          {
            scope: {
              kind: "PROJECT",
              workspaceId: pair.candidate.scope.workspaceId,
              projectId: pair.candidate.target.projectId,
            },
            pair,
            initiatorId,
            initiatorAuthorizationBasis: authorizationBasis,
            initiatorAuthorizationBasisHash: authorizationBasisHash,
            createdAt,
          },
          manager,
        );
        const approvals = new TypeOrmApprovalRepository(manager as unknown as DataSource);
        if (approval && !stored.replayed) await approvals.insertV2(approval);
        const existingApproval =
          approval && stored.replayed
            ? await approvals.getV2(approval.workspaceId, approval.projectId, approval.approvalId)
            : approval;
        if (approval && stored.replayed && !existingApproval)
          throw new Error("QUEUE_EXPEDITE_APPROVAL_REPLAY_CONFLICT");
        const [row] = rows(
          await manager.query(
            "SELECT action.state,action.result,candidate.created_at FROM platform_actions action JOIN queue_action_candidates candidate ON candidate.workspace_id=action.workspace_id AND candidate.project_id=action.project_id AND candidate.action_id=action.id WHERE action.workspace_id=$1 AND action.project_id=$2 AND action.id=$3",
            [pair.candidate.scope.workspaceId, pair.candidate.target.projectId, pair.actionId],
          ),
        );
        const result = row?.result
          ? json<Readonly<{ resultRef?: Readonly<Record<string, JsonValue>> }>>(row.result)
          : undefined;
        return Object.freeze({
          replayed: stored.replayed,
          state:
            String(row?.state) === "COMPLETED"
              ? ("COMPLETED" as const)
              : ("PENDING_APPROVAL" as const),
          requestedAt: new Date(String(row?.created_at ?? createdAt)).toISOString(),
          ...(result?.resultRef ? { resultRef: result.resultRef } : {}),
          ...(existingApproval
            ? {
                approvalRef: Object.freeze({
                  sourceType: "APPROVAL_SUBJECT_V2" as const,
                  sourceId: existingApproval.approvalId,
                  sourceVersion: existingApproval.resourceVersion,
                  semanticHash: existingApproval.subjectHash,
                }),
              }
            : {}),
        });
      }),
    consume: async (pair, context) =>
      await source.transaction("SERIALIZABLE", async (manager) => {
        if (pair.candidate.scope.kind !== "PROJECT")
          throw new Error("QUEUE_EXPEDITE_PROJECT_SCOPE_REQUIRED");
        const workspaceId = pair.candidate.scope.workspaceId;
        const projectId = pair.candidate.scope.projectId;
        const workItemRef = pair.candidate.target.workItemRef as Readonly<
          Record<string, JsonValue>
        >;
        const workItemId = String(workItemRef.sourceId ?? "");
        if (workspaceId !== context.workspaceId || projectId !== context.projectId || !workItemId)
          throw new Error("QUEUE_EXPEDITE_SCOPE_MISMATCH");
        await new CapacityAdmissionRepository(source).lockWorkspaceCapacity(
          { kind: "WORKSPACE", workspaceId },
          manager,
        );
        const current = await readPostgresQueueExpediteContext(manager, {
          workspaceId,
          projectId,
          workItemId,
        });
        const effect = pair.witness.requestedEffect as Readonly<Record<string, JsonValue>>;
        let originatingPair: QueueActionPair | undefined;
        let expediteEffect = effect;
        if (effect.kind === "ALLOW_EXPEDITE_CAPACITY") {
          const origin = effect.originatingActionRef as Readonly<Record<string, JsonValue>>;
          originatingPair = await new QueueActionCandidateRepository(source).scopedPair(
            { kind: "PROJECT", workspaceId, projectId },
            String(origin.sourceId),
            manager,
          );
          expediteEffect = effect.requestedExpediteEffect as Readonly<Record<string, JsonValue>>;
        }
        if (expediteEffect.beforeServiceClass !== current.serviceClass)
          throw new Error("QUEUE_EXPEDITE_SERVICE_CLASS_STALE");
        const approved = context.approvedSubject;
        const approvalBinding = approved?.decision
          ? Object.freeze({
              approvalId: approved.approvalId,
              state: "APPROVED" as const,
              initiatorId: approved.initiator.principalId,
              approverId: approved.decision.approver.principalId,
              approverRole: approved.decision.approverRole,
              expiresAt: approved.expiresAt,
            })
          : undefined;
        assertExactCapacityActionConsumption({
          pair,
          currentExpectedState: current.expectedState,
          currentWorkItemRef: current.workItemRef,
          ...(approvalBinding ? { approval: approvalBinding } : {}),
          ...(originatingPair ? { originatingPair } : {}),
          now: now().toISOString(),
        });
        const acceptedActionRef = Object.freeze({
          sourceType: "QUEUE_ACTION_CANDIDATE",
          sourceId: pair.actionId,
          sourceVersion: 1,
          semanticHash: pair.publicIntentHash,
        });
        const exactResolver =
          pair.candidate.actionKind === "EXPEDITE_CAPACITY_OVERRIDE" &&
          approved &&
          context.expectedApprovalVersion !== undefined
            ? createPostgresExactCapacityOverrideResolver(source, {
                pair,
                approved,
                expectedApprovalVersion: context.expectedApprovalVersion,
                now: now().toISOString(),
              })
            : undefined;
        const binder = new PostgresCapacityAdmissionBinder(source, {
          reauthorize: async (transaction, request) =>
            rows(
              await transaction.query(
                `SELECT 1 FROM workspace_memberships membership
            JOIN project_entitlements entitlement
              ON entitlement.workspace_id=membership.workspace_id AND entitlement.principal_id=membership.principal_id
             AND entitlement.project_id=$2 AND entitlement.effect='ALLOW' AND entitlement.revoked_at IS NULL
           WHERE membership.workspace_id=$1 AND membership.principal_id=$3 AND membership.state='ACTIVE'`,
                [workspaceId, projectId, request.principalId],
              ),
            ).length === 1,
          ...(exactResolver ? { resolveExactOverride: exactResolver } : {}),
        });
        const decidedAt = now().toISOString();
        const admission = await binder.admitInTransaction(manager, {
          workspaceId,
          projectId,
          workItemId,
          principalId: context.approverId,
          requestKey: `queue-expedite-consume:${pair.actionId}`,
          activityKind:
            expediteEffect.kind === "CLEAR_EXPEDITE" ? "CLEAR_EXPEDITE" : "SET_EXPEDITE",
          actor: Object.freeze({ kind: "HUMAN" as const, principalId: context.approverId }),
          authorizationScopeWitnessHash: sha256(
            context.currentAuthorizationWitness as unknown as JsonValue,
          ),
          expectedState: Object.freeze({
            policyFacetRef: current.policyFacetRef,
            expectedQueueControlVersion: current.expectedState.expectedControlVersion,
            operationalProjectionRef: current.expectedState.operationalProjectionRef,
            qaSourceSetHash: current.qaSourceSetHash,
          }),
          authorizedScopeSnapshotRef: current.authorizedCapacitySnapshotRef,
          controlAction: Object.freeze({
            controlId: uuid(`queue-control:${workspaceId}:${projectId}:${workItemId}`),
            revisionId: uuid(`queue-control-expedite:${pair.actionId}`),
            acceptedActionRef,
            reason: pair.candidate.reason,
            ...(typeof expediteEffect.reviewAt === "string"
              ? { reviewAt: expediteEffect.reviewAt }
              : {}),
            ...(expediteEffect.kind === "SET_EXPEDITE" && originatingPair?.candidate.expiresAt
              ? { expiresAt: originatingPair.candidate.expiresAt }
              : expediteEffect.kind === "SET_EXPEDITE" && pair.candidate.expiresAt
                ? { expiresAt: pair.candidate.expiresAt }
                : {}),
          }),
          decidedAt,
          correlationId: uuid(`queue-expedite-correlation:${pair.actionId}`),
          causationId: context.approvalId,
        });
        if (!exactResolver) {
          if (pair.candidate.approvalPolicy === "SELF_APPROVAL_FORBIDDEN") {
            if (
              !approved ||
              context.expectedApprovalVersion === undefined ||
              !approved.decision?.authorizationScopeWitness
            )
              throw new Error("QUEUE_EXPEDITE_APPROVED_SUBJECT_REQUIRED");
            const consumed = consumeApprovalSubjectV2({
              subject: approved,
              currentSubjectHash: approved.subjectHash,
              currentAuthorizationScopeWitness: approved.decision.authorizationScopeWitness,
              now: decidedAt,
            });
            await new TypeOrmApprovalRepository(manager as unknown as DataSource).saveV2(
              consumed,
              context.expectedApprovalVersion,
            );
          }
          const updated = rows(
            await manager.query(
              "UPDATE platform_actions SET state='COMPLETED',result=$4,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND state='PENDING_APPROVAL' AND row_version=1 RETURNING id",
              [
                workspaceId,
                projectId,
                pair.actionId,
                JSON.stringify({ resultRef: admission.decisionRef }),
              ],
            ),
          );
          if (updated.length !== 1) throw new Error("QUEUE_EXPEDITE_PLATFORM_ACTION_CAS_CONFLICT");
        }
        assertQueueActionConsumedResult(pair, { resultRef: admission.decisionRef });
        return Object.freeze({ resultRef: admission.decisionRef });
      }),
  };
  return new QueueExpediteActionWorkflowService(ports, now);
}
