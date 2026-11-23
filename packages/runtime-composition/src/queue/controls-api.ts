import type { DataSource } from "typeorm";

import { TypeOrmQaTriageAssessmentRepository } from "@awp/competency-qa/node";
import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  createPlatformActionApprovalV2,
  projectSafeQueueAuthorizationWitness,
  type QueueActionPair,
  type QueueControlState,
  type QueueExactSourceRef,
  type QueuePlanningValues,
  UNKNOWN_QUEUE_PLANNING_VALUES,
} from "@awp/platform-core";
import {
  QueueActionCandidateRepository,
  QueueControlRepository,
  TypeOrmApprovalRepository,
} from "@awp/platform-persistence-typeorm";

import type { QueueApprovalAuthorization } from "./approval-api.ts";
import { type QueueControlRequest, QueueControlService } from "./control-service.ts";
import { createPostgresQueueExpediteActionWorkflow } from "./expedite-action-runtime.ts";
import type { QueueHttpAuthority } from "./http-authority.ts";
import {
  exactQueueActionHttpReceipt,
  type PublicQueueActionRef,
  type PublicQueueActionState,
  type QueueActionReceiptSource,
} from "./http-receipts.ts";
import { type QueueOrderRequest, QueueOrderService } from "./order-service.ts";
import {
  exactQueueEntryReadToken,
  PostgresProjectQueueProjection,
  ProjectQueueQueryService,
} from "./portfolio-query.ts";
import type { QueueRuntimeRequest } from "./query-api.ts";

export interface QueueMutableRuntimeResponse {
  setHeader(name: string, value: string): void;
  status(code: number): QueueMutableRuntimeResponse;
}
export type QueueOrderCommandBody = Omit<
  QueueOrderRequest,
  "requestKey" | "workspaceId" | "principalId" | "expectedOrderResourceVersion"
> &
  Readonly<{ schemaVersion?: string }>;
export type QueueControlCommandBody = Omit<
  QueueControlRequest,
  | "requestKey"
  | "workspaceId"
  | "projectId"
  | "workItemId"
  | "principalId"
  | "expectedControlVersion"
>;
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const controlCommandKeys = new Set([
  "schemaVersion",
  "commandKind",
  "expectedQueueEntry",
  "triageAssessmentRef",
  "acceptedValues",
  "requestedServiceClass",
  "confirmedDueDateRef",
  "reviewAt",
  "expiresAt",
  "reason",
]);
const digestPattern = /^sha256:[a-f0-9]{64}$/u;

function assertControlHttpCommand(
  body: unknown,
  requestKey: string | undefined,
): asserts body is QueueControlCommandBody {
  if (!requestKey || !/^[A-Za-z0-9._:-]{16,200}$/u.test(requestKey))
    throw new Error("QUEUE_CONTROL_IDEMPOTENCY_KEY_INVALID");
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !controlCommandKeys.has(key))
  )
    throw new Error("QUEUE_CONTROL_COMMAND_INVALID");
  const value = body as Partial<QueueControlCommandBody>;
  const entry = value.expectedQueueEntry as Readonly<Record<string, unknown>> | undefined;
  if (
    value.schemaVersion !== "queue-control-command@1.0.0" ||
    !entry ||
    Object.keys(entry).some(
      (key) => !new Set(["queueEntryId", "revision", "semanticHash", "inputFingerprint"]).has(key),
    ) ||
    typeof entry.queueEntryId !== "string" ||
    !entry.queueEntryId ||
    !Number.isSafeInteger(entry.revision) ||
    Number(entry.revision) < 1 ||
    typeof entry.semanticHash !== "string" ||
    !digestPattern.test(entry.semanticHash) ||
    typeof entry.inputFingerprint !== "string" ||
    !digestPattern.test(entry.inputFingerprint)
  ) {
    throw new Error("QUEUE_CONTROL_COMMAND_INVALID");
  }
}

const deterministicUuid = (namespace: string): string => {
  const hex = sha256(namespace).slice(7).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
};

function orderVersion(value: string | undefined): number {
  const match = /^"(0|[1-9][0-9]*)"$/u.exec(value ?? "");
  if (!match) throw new Error("QUEUE_ORDER_IF_MATCH_INVALID");
  return Number(match[1]);
}

export class RuntimeQueueControlsApi {
  constructor(
    private readonly source: DataSource,
    private readonly authority: QueueHttpAuthority,
  ) {}

  private async authorize(
    request: QueueRuntimeRequest,
    workspaceId: string,
    projectId: string,
    permission: string,
  ): Promise<QueueApprovalAuthorization> {
    const authorization = await this.authority.project(request, workspaceId, projectId, permission);
    if (!authorization) throw new Error("QA_SCOPE_DENIED");
    return authorization;
  }

  async control(
    request: QueueRuntimeRequest,
    workspaceId: string,
    projectId: string,
    workItemId: string,
    requestKey: string | undefined,
    ifMatch: string | undefined,
    body: QueueControlCommandBody,
    response: QueueMutableRuntimeResponse,
  ) {
    assertControlHttpCommand(body, requestKey);
    const validatedRequestKey = requestKey as string;
    const expectedControlVersion = orderVersion(ifMatch);
    const authorization = await this.authorize(
      request,
      workspaceId,
      projectId,
      "queue.control.request",
    );
    const currentClassRaw = (await this.source.query(
      `SELECT revision.service_class
         FROM work_item_queue_control_heads head
         LEFT JOIN work_item_queue_control_revisions revision
           ON revision.workspace_id=head.workspace_id AND revision.project_id=head.project_id
          AND revision.control_revision_id=head.current_revision_id
        WHERE head.workspace_id=$1 AND head.project_id=$2 AND head.work_item_id=$3`,
      [workspaceId, projectId, workItemId],
    )) as unknown;
    const currentClassValues = currentClassRaw as readonly unknown[];
    const currentClassResult = (
      Array.isArray(currentClassValues[0]) ? currentClassValues[0] : currentClassValues
    ) as readonly Readonly<{ service_class?: string }>[];
    const currentServiceClass = currentClassResult[0]?.service_class ?? "STANDARD";
    const exactExpedite =
      body.commandKind === "SET_EXPEDITE" ||
      (body.commandKind === "CLEAR_SERVICE_CLASS" && currentServiceClass === "EXPEDITE");
    if (exactExpedite) {
      if (body.commandKind === "SET_EXPEDITE") {
        if (
          body.requestedServiceClass !== "EXPEDITE" ||
          !body.reviewAt ||
          !body.expiresAt ||
          body.acceptedValues !== undefined ||
          body.triageAssessmentRef !== undefined ||
          body.confirmedDueDateRef !== undefined
        ) {
          throw new Error("QUEUE_CONTROL_EXPEDITE_COMMAND_INVALID");
        }
      } else if (
        body.requestedServiceClass !== "STANDARD" ||
        body.reviewAt !== undefined ||
        body.expiresAt !== undefined ||
        body.acceptedValues !== undefined ||
        body.triageAssessmentRef !== undefined ||
        body.confirmedDueDateRef !== undefined
      ) {
        throw new Error("QUEUE_CONTROL_CLEAR_COMMAND_INVALID");
      }
      const eventTime = new Date().toISOString();
      const authorizationScopeWitness = projectSafeQueueAuthorizationWitness(
        { kind: "PROJECT", workspaceId, projectId },
        {
          workspaceId,
          projectId,
          requiredPermission: "queue.control.request",
          classificationDecision: "ALLOW",
        },
        eventTime,
      );
      const service = createPostgresQueueExpediteActionWorkflow(this.source, {
        authorize: async ({
          workspaceId: requestedWorkspace,
          projectId: requestedProject,
          workItemId: requestedWorkItem,
          principalId,
        }) =>
          requestedWorkspace === workspaceId &&
          requestedProject === projectId &&
          requestedWorkItem === workItemId &&
          principalId === authorization.actor.principalId
            ? Object.freeze({
                authorizationScopeWitness,
                authorizationBasis: authorization.basis as unknown as JsonValue,
              })
            : undefined,
      });
      const receipt = await service.request({
        workspaceId,
        projectId,
        workItemId,
        requestKey: validatedRequestKey,
        commandKind: body.commandKind === "SET_EXPEDITE" ? "SET_EXPEDITE" : "CLEAR_EXPEDITE",
        expectedControlVersion,
        expectedQueueEntry: body.expectedQueueEntry,
        reason: body.reason,
        ...(body.reviewAt ? { reviewAt: body.reviewAt } : {}),
        ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
        actor: authorization.actor,
      });
      response.setHeader("ETag", `"${receipt.resourceVersion}"`);
      if (receipt.state === "PENDING_APPROVAL" && receipt.approvalRef) {
        response.status(202);
        response.setHeader(
          "Location",
          `/api/v1/workspaces/${workspaceId}/projects/${projectId}/approvals/${receipt.approvalRef.sourceId}`,
        );
      }
      return exactQueueActionHttpReceipt(receipt as unknown as QueueActionReceiptSource);
    }
    const projection = new PostgresProjectQueueProjection(this.source);
    const controls = new QueueControlRepository(this.source);
    const assessments = new TypeOrmQaTriageAssessmentRepository(this.source);
    const eventTime = new Date().toISOString();
    const controlId = deterministicUuid(`queue-control:${workspaceId}:${projectId}:${workItemId}`);
    const service = new QueueControlService({
      authorize: async () => true,
      replay: async ({ actionId, requestHash }) => {
        const rows = (await this.source.query(
          `SELECT q.public_candidate,q.public_intent_hash,p.result,r.*
             FROM queue_action_candidates q
             JOIN platform_actions p ON p.workspace_id=q.workspace_id AND p.project_id=q.project_id AND p.id=q.action_id
             LEFT JOIN work_item_queue_control_revisions r ON r.workspace_id=q.workspace_id AND r.project_id=q.project_id AND r.control_revision_id=(p.result->'resultRef'->>'sourceId')::uuid
            WHERE q.workspace_id=$1 AND q.project_id=$2 AND q.action_id=$3`,
          [workspaceId, projectId, actionId],
        )) as readonly Readonly<Record<string, unknown>>[];
        const row = rows[0];
        if (!row) return undefined;
        const candidate = json<Readonly<{ requestHash?: string }>>(row.public_candidate);
        if (candidate.requestHash !== requestHash)
          throw new Error("QUEUE_CONTROL_IDEMPOTENCY_CONFLICT");
        if (!row.control_revision_id) throw new Error("QUEUE_CONTROL_REPLAY_RESULT_NOT_FOUND");
        return Object.freeze({
          publicIntentHash: String(row.public_intent_hash) as `sha256:${string}`,
          revision: {
            revisionId: String(row.control_revision_id),
            revision: Number(row.revision_number),
            semanticHash: String(row.semantic_hash),
            recordedAt: new Date(String(row.recorded_at)).toISOString(),
          } as never,
        });
      },
      read: async ({ triageAssessmentRef }) => {
        const entry = await projection.read({
          workspaceId,
          projectId,
          workItemId,
          principalId: authorization.actor.principalId,
        });
        if (!entry) throw new Error("QUEUE_CONTROL_NOT_FOUND");
        const readToken = exactQueueEntryReadToken(entry);
        const token = Object.freeze({
          queueEntryId: readToken.queueEntryId,
          revision: readToken.revision,
          semanticHash: readToken.semanticHash as `sha256:${string}`,
          inputFingerprint: readToken.inputFingerprint as `sha256:${string}`,
        });
        const subject = entry.subject as Readonly<Record<string, unknown>>;
        if (subject.kind !== "WORK_ITEM" || subject.id !== workItemId)
          throw new Error("QUEUE_CONTROL_NOT_FOUND");
        const sourceRefs = (entry.sourceRefs ?? []) as readonly QueueExactSourceRef[];
        const operationalProjectionRef = sourceRefs.find(
          ({ sourceType }) => sourceType === "JIRA_OPERATIONAL_PROJECTION_REVISION",
        );
        const qaRef = sourceRefs.find(({ sourceType }) => sourceType === "QA_QUEUE_FACT_REVISION");
        const policyFacetRef = entry.policyFacetRef as
          Readonly<{ id?: unknown; version?: unknown; semanticHash?: unknown }> | undefined;
        if (
          !operationalProjectionRef ||
          !qaRef ||
          !policyFacetRef ||
          typeof policyFacetRef.id !== "string" ||
          !Number.isSafeInteger(policyFacetRef.version) ||
          typeof policyFacetRef.semanticHash !== "string"
        )
          throw new Error("QUEUE_CONTROL_SOURCE_FACTS_INCOMPLETE");
        const policyRef = Object.freeze({
          id: policyFacetRef.id,
          version: Number(policyFacetRef.version),
          semanticHash: policyFacetRef.semanticHash as `sha256:${string}`,
        });
        const stored = await controls.currentControl(
          { kind: "PROJECT", workspaceId, projectId },
          workItemId,
        );
        const current: QueueControlState = stored?.control_revision_id
          ? Object.freeze({
              controlId,
              workspaceId,
              projectId,
              workItemId,
              resourceVersion: Number(stored.resource_version),
              currentRevisionId: String(stored.control_revision_id),
              serviceClass: String(stored.service_class) as QueueControlState["serviceClass"],
              planningValues: json<QueuePlanningValues>(stored.planning_values),
              operationalProjectionRef,
              qaSourceSetHash: qaRef.semanticHash,
              policyRef,
            })
          : Object.freeze({
              controlId,
              workspaceId,
              projectId,
              workItemId,
              resourceVersion: 0,
              serviceClass: "STANDARD",
              planningValues: UNKNOWN_QUEUE_PLANNING_VALUES,
              operationalProjectionRef,
              qaSourceSetHash: qaRef.semanticHash,
              policyRef,
            });
        const assessment = triageAssessmentRef
          ? await assessments.revision(
              workspaceId,
              projectId,
              triageAssessmentRef.sourceId,
              Number(triageAssessmentRef.sourceVersion),
            )
          : undefined;
        const assessmentComponents = assessment?.content.inputFingerprintComponents as
          Readonly<Record<string, unknown>> | undefined;
        const currentAssessmentFingerprint = assessmentComponents
          ? sha256({
              ...assessmentComponents,
              subject: {
                sourceType: "WORK_ITEM_REVISION",
                sourceId: workItemId,
                sourceVersion: Number(subject.version),
                semanticHash: String(subject.semanticHash),
              },
              jiraOperationalProjection: { state: "KNOWN", sourceRef: operationalProjectionRef },
              qaPlanningFacts: { state: "KNOWN", sourceRef: qaRef },
            } as unknown as JsonValue)
          : assessment?.sourceFactSetHash;
        return Object.freeze({
          current,
          currentQueueEntry: token,
          workItemRef: Object.freeze({
            sourceType: "WORK_ITEM_REVISION",
            sourceId: workItemId,
            sourceVersion: Number(subject.version),
            semanticHash: String(subject.semanticHash) as `sha256:${string}`,
          }),
          ...(assessment && currentAssessmentFingerprint
            ? { assessment, currentAssessmentFingerprint }
            : {}),
        });
      },
      commit: async ({ pair, revision }) =>
        await this.source.transaction("SERIALIZABLE", async (manager) => {
          const candidateRepository = new QueueActionCandidateRepository(this.source);
          const basis = authorization.basis as unknown as JsonValue;
          const stored = await candidateRepository.saveQueueActionPair(
            {
              scope: { kind: "PROJECT", workspaceId, projectId },
              pair,
              initiatorId: authorization.actor.principalId,
              initiatorAuthorizationBasis: basis,
              initiatorAuthorizationBasisHash: sha256(basis),
              createdAt: eventTime,
            },
            manager,
          );
          if (stored.replayed) {
            const rows = (await manager.query(
              "SELECT result FROM platform_actions WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
              [workspaceId, projectId, pair.actionId],
            )) as readonly Readonly<{ result: unknown }>[];
            const result = json<Readonly<{ resultRef?: Readonly<Record<string, unknown>> }>>(
              rows[0]?.result ?? {},
            );
            const history = (await manager.query(
              "SELECT * FROM work_item_queue_control_revisions WHERE workspace_id=$1 AND project_id=$2 AND control_revision_id=$3",
              [workspaceId, projectId, result.resultRef?.sourceId],
            )) as readonly Readonly<Record<string, unknown>>[];
            if (!history[0]) throw new Error("QUEUE_CONTROL_REPLAY_RESULT_NOT_FOUND");
            return Object.freeze({
              replayed: true,
              revision: {
                ...revision,
                revisionId: String(history[0].control_revision_id),
                revision: Number(history[0].revision_number),
                serviceClass: String(history[0].service_class),
                planningValues: json(history[0].planning_values),
                semanticHash: String(history[0].semantic_hash),
              } as typeof revision,
            });
          }
          const expected = pair.witness.expectedState as unknown as Readonly<{
            expectedQueueEntry: QueueControlRequest["expectedQueueEntry"];
            operationalProjectionRef: QueueExactSourceRef;
            qaSourceSetHash: string;
          }>;
          const effect = pair.witness.requestedEffect as unknown as Readonly<{
            triageAssessmentRef?: QueueExactSourceRef;
          }>;
          await controls.appendControlRevision(
            {
              scope: { kind: "PROJECT", workspaceId, projectId },
              controlId,
              revisionId: revision.revisionId,
              workItemId,
              expectedResourceVersion: revision.revision - 1,
              expectedQueueEntry: expected.expectedQueueEntry,
              expectedOperationalProjectionRef: expected.operationalProjectionRef,
              expectedQaSourceSetHash: expected.qaSourceSetHash,
              ...(effect.triageAssessmentRef
                ? { triageAssessmentRef: effect.triageAssessmentRef }
                : {}),
              ...(revision.previousRevisionId
                ? { previousRevisionId: revision.previousRevisionId }
                : {}),
              serviceClass: revision.serviceClass,
              planningValues: revision.planningValues,
              acceptedSourceRefs: revision.acceptedSourceRefs,
              dependencySourceSetHash: revision.dependencySourceSetHash,
              acceptedActionRef: revision.acceptedActionRef,
              reason: revision.reason,
              semanticHash: revision.semanticHash,
              recordedAt: revision.recordedAt,
              recordedBy: revision.recordedBy,
            },
            manager,
          );
          const resultRef = Object.freeze({
            sourceType: "WORK_ITEM_QUEUE_CONTROL_REVISION",
            sourceId: revision.revisionId,
            sourceVersion: revision.revision,
            semanticHash: revision.semanticHash,
          });
          await manager.query(
            "UPDATE platform_actions SET state='COMPLETED',result=$4,row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
            [workspaceId, projectId, pair.actionId, JSON.stringify({ resultRef })],
          );
          const eventId = deterministicUuid(`queue-control-changed:${revision.revisionId}`);
          const envelope = Object.freeze({
            eventId,
            eventType: "queue.control.changed",
            workspaceId,
            projectId,
            entityType: "WORK_ITEM_QUEUE_CONTROL",
            entityId: workItemId,
            entityVersion: revision.revision,
            occurredAt: revision.recordedAt,
            recordedAt: revision.recordedAt,
            payload: {
              queueEntryId: body.expectedQueueEntry.queueEntryId,
              revision: revision.revision,
              calculatedAt: revision.recordedAt,
            },
            cause: { kind: "CONTROL_TRANSITION" },
          });
          await manager.query(
            "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,'queue.control.changed',$4,$5,'READY',$6)",
            [
              eventId,
              workspaceId,
              projectId,
              JSON.stringify(envelope),
              sha256(envelope as unknown as JsonValue),
              revision.recordedAt,
            ],
          );
          return Object.freeze({ replayed: false, revision });
        }),
    });
    const receipt = await service.request({
      ...body,
      requestKey: validatedRequestKey,
      workspaceId,
      projectId,
      workItemId,
      principalId: authorization.actor.principalId,
      expectedControlVersion,
    });
    response.setHeader("ETag", `"${receipt.resultRef.sourceVersion}"`);
    return exactQueueActionHttpReceipt(receipt as unknown as QueueActionReceiptSource);
  }

  async projectOrder(
    request: QueueRuntimeRequest,
    workspaceId: string,
    projectId: string,
    requestKey: string | undefined,
    ifMatch: string | undefined,
    body: QueueOrderCommandBody,
    response: QueueMutableRuntimeResponse,
  ) {
    if (body.scopeKind !== "PROJECT" || body.subject.projectId !== projectId)
      throw new Error("QUEUE_ORDER_PROJECT_SCOPE_INVALID");
    return await this.submit(request, workspaceId, projectId, requestKey, ifMatch, body, response);
  }

  async portfolioOrder(
    request: QueueRuntimeRequest,
    workspaceId: string,
    requestKey: string | undefined,
    ifMatch: string | undefined,
    body: QueueOrderCommandBody,
    response: QueueMutableRuntimeResponse,
  ) {
    if (body.scopeKind !== "AUTHORIZED_PORTFOLIO")
      throw new Error("QUEUE_ORDER_PORTFOLIO_SCOPE_INVALID");
    return await this.submit(
      request,
      workspaceId,
      body.subject.projectId,
      requestKey,
      ifMatch,
      body,
      response,
    );
  }

  private async submit(
    request: QueueRuntimeRequest,
    workspaceId: string,
    targetProjectId: string,
    requestKey: string | undefined,
    ifMatch: string | undefined,
    body: QueueOrderCommandBody,
    response: QueueMutableRuntimeResponse,
  ) {
    if (
      !requestKey ||
      !/^[A-Za-z0-9._:-]{16,200}$/u.test(requestKey) ||
      body.schemaVersion !== "queue-order-command@1.0.0"
    )
      throw new Error("QUEUE_ORDER_COMMAND_INVALID");
    const targetAuthorization = await this.authorize(
      request,
      workspaceId,
      targetProjectId,
      "queue.order.move",
    );
    const portfolioIdentity =
      body.scopeKind === "AUTHORIZED_PORTFOLIO"
        ? await this.authority.portfolio(request, workspaceId, ["queue.order.move"])
        : undefined;
    if (portfolioIdentity && !portfolioIdentity.projectIds.includes(targetProjectId))
      throw new Error("QUEUE_ORDER_TARGET_NOT_FOUND");
    const projection = new PostgresProjectQueueProjection(this.source);
    const query = new ProjectQueueQueryService({
      authorize: async ({ workspaceId: requestedWorkspace, projectId }) => {
        try {
          await this.authorize(request, requestedWorkspace, projectId, "queue.order.move");
          return true;
        } catch {
          return false;
        }
      },
      authorizedProjects: async () =>
        (await this.authority.portfolio(request, workspaceId, ["queue.order.move"])).projectIds,
      projection,
    });
    const requestedAt = new Date().toISOString();
    let persistence:
      | Readonly<{
          state: "PENDING_APPROVAL" | "COMPLETED";
          replayed: boolean;
          requestedAt: string;
          approvalRef?: PublicQueueActionRef;
          resultRef?: Readonly<Record<string, unknown>>;
        }>
      | undefined;
    let approvalId: string | undefined;
    const service = new QueueOrderService({
      now: () => requestedAt,
      authorizeTarget: async () =>
        body.scopeKind === "PROJECT" ||
        Boolean(portfolioIdentity?.projectIds.includes(targetProjectId)),
      readAuthorizedView: async () => {
        const pages: Readonly<Record<string, unknown>>[] = [];
        let cursor: string | undefined;
        do {
          const page =
            body.scopeKind === "PROJECT"
              ? await query.lane({
                  workspaceId,
                  projectId: targetProjectId,
                  principalId: targetAuthorization.actor.principalId,
                  pageSize: 100,
                  ...(cursor ? { cursor } : {}),
                })
              : await query.portfolio({
                  workspaceId,
                  principalId: targetAuthorization.actor.principalId,
                  pageSize: 100,
                  ...(cursor ? { cursor } : {}),
                });
          pages.push(page);
          cursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
        } while (cursor);
        const first = pages[0]!;
        const entries = pages.flatMap((page) =>
          (page.items as readonly Readonly<{ entry: Readonly<Record<string, unknown>> }>[]).map(
            ({ entry }) => {
              const subject = entry.subject as Readonly<Record<string, unknown>>;
              if (
                subject.kind !== "WORK_ITEM" ||
                !subject.id ||
                !subject.version ||
                !subject.semanticHash
              )
                throw new Error("QUEUE_ORDER_WORK_ITEM_REF_INVALID");
              const token = exactQueueEntryReadToken(entry);
              return Object.freeze({
                projectId: String(entry.projectId),
                workItemId: String(subject.id),
                expectedQueueEntry: Object.freeze({
                  queueEntryId: token.queueEntryId,
                  revision: token.revision,
                  semanticHash: token.semanticHash,
                  inputFingerprint: token.inputFingerprint,
                }),
                workItemRef: Object.freeze({
                  sourceType: "WORK_ITEM_REVISION" as const,
                  sourceId: String(subject.id),
                  sourceVersion: Number(subject.version),
                  semanticHash: String(subject.semanticHash),
                }),
              });
            },
          ),
        );
        const scope = first.scope as Readonly<Record<string, unknown>>;
        return Object.freeze({
          entries,
          orderState: first.orderState as Readonly<{
            resourceVersion: number;
            queueEpoch: number;
            baseVisibleSetHash: string;
          }>,
          authorizedProjectSetHash: String(scope.authorizedProjectSetHash),
          projectionGeneration: String(first.projectionGeneration),
        });
      },
      commit: async (pair: QueueActionPair) => {
        const basis =
          body.scopeKind === "PROJECT"
            ? (targetAuthorization.basis as unknown as JsonValue)
            : ({
                kind: "AUTHORIZED_PORTFOLIO",
                principalId: targetAuthorization.actor.principalId,
                projectIds: portfolioIdentity!.projectIds,
                authorizedProjectSetHash: body.expectedAuthorizedProjectSetHash,
              } as JsonValue);
        const basisHash = sha256(basis);
        const createdAt = requestedAt;
        approvalId = deterministicUuid(`queue-order-approval:${pair.actionId}`);
        persistence = await this.source.transaction("SERIALIZABLE", async (manager) => {
          const stored = await new QueueActionCandidateRepository(this.source).saveQueueActionPair(
            {
              scope: { kind: "PROJECT", workspaceId, projectId: targetProjectId },
              pair,
              initiatorId: targetAuthorization.actor.principalId,
              initiatorAuthorizationBasis: basis,
              initiatorAuthorizationBasisHash: basisHash,
              createdAt,
            },
            manager,
          );
          let approvalRef: PublicQueueActionRef | undefined;
          if (stored.state === "PENDING_APPROVAL" && !stored.replayed) {
            const scopeWitness = projectSafeQueueAuthorizationWitness(
              pair.candidate.scope,
              {
                workspaceId,
                projectId: targetProjectId,
                requiredPermission: "queue.order.move",
                classificationDecision: "ALLOW",
                ...(pair.candidate.scope.kind === "AUTHORIZED_PORTFOLIO"
                  ? { authorizedProjectSetHash: pair.candidate.scope.authorizedProjectSetHash }
                  : {}),
              },
              createdAt,
            );
            const approval = createPlatformActionApprovalV2({
              approvalId: approvalId!,
              workspaceId,
              projectId: targetProjectId,
              initiator: targetAuthorization.actor,
              initiatorAuthorizationScopeWitness: scopeWitness,
              action: {
                actionKind: "PLATFORM_ACTION",
                actionId: pair.actionId,
                commandType: "queue.order.override",
              },
              candidate: pair.candidate,
              requiredPermission: "queue.order.move",
              effectIdempotencyKey: `awp:queue-order:${pair.actionId}`,
              dataClassificationKey: "INTERNAL",
              expiresAt: pair.candidate.expiresAt!,
              createdAt,
            });
            await new TypeOrmApprovalRepository(manager as unknown as DataSource).insertV2(
              approval,
            );
            approvalRef = Object.freeze({
              sourceType: "APPROVAL_SUBJECT_V2",
              sourceId: approval.approvalId,
              sourceVersion: approval.resourceVersion,
              semanticHash: approval.subjectHash,
            });
          } else if (stored.state === "PENDING_APPROVAL") {
            const rows = (await manager.query(
              "SELECT id,row_version,subject_hash FROM approvals WHERE workspace_id=$1 AND project_id=$2 AND action_id=$3",
              [workspaceId, targetProjectId, pair.actionId],
            )) as readonly Readonly<{ id: string; row_version: number; subject_hash: string }>[];
            if (!rows[0]) throw new Error("QUEUE_ORDER_APPROVAL_REF_NOT_FOUND");
            approvalId = rows[0].id;
            approvalRef = Object.freeze({
              sourceType: "APPROVAL_SUBJECT_V2",
              sourceId: approvalId,
              sourceVersion: rows[0].row_version,
              semanticHash: rows[0].subject_hash,
            });
          }
          const actionRows = (await manager.query(
            "SELECT created_at FROM platform_actions WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
            [workspaceId, targetProjectId, pair.actionId],
          )) as readonly Readonly<{ created_at: string | Date }>[];
          const durableRequestedAt = actionRows[0]?.created_at
            ? new Date(actionRows[0].created_at).toISOString()
            : createdAt;
          return Object.freeze({
            ...stored,
            requestedAt: durableRequestedAt,
            ...(approvalRef ? { approvalRef } : {}),
          });
        });
      },
    });
    const receipt = await service.request({
      ...body,
      requestKey,
      workspaceId,
      principalId: targetAuthorization.actor.principalId,
      expectedOrderResourceVersion: orderVersion(ifMatch),
    });
    response.setHeader("ETag", '"1"');
    if (persistence?.state === "PENDING_APPROVAL") {
      response.status(202);
      response.setHeader(
        "Location",
        `/api/v1/workspaces/${workspaceId}/projects/${targetProjectId}/approvals/${persistence.approvalRef!.sourceId}`,
      );
    }
    const internal = receipt as Readonly<{
      candidate: Readonly<{ actionId: string; expiresAt?: string }>;
      publicIntentHash: string;
      state: PublicQueueActionState;
      approvalRequired: boolean;
      resultRef?: PublicQueueActionRef;
    }>;
    return exactQueueActionHttpReceipt({
      actionId: internal.candidate.actionId,
      actionKind: "QUEUE_ORDER_OVERRIDE",
      state: internal.state,
      resourceVersion: 1,
      publicIntentHash: internal.publicIntentHash,
      approvalRequired: internal.approvalRequired,
      ...(persistence?.approvalRef ? { approvalRef: persistence.approvalRef } : {}),
      ...(internal.resultRef ? { resultRef: internal.resultRef } : {}),
      requestedAt: persistence?.requestedAt ?? requestedAt,
      ...(internal.candidate.expiresAt ? { expiresAt: internal.candidate.expiresAt } : {}),
    });
  }
}
