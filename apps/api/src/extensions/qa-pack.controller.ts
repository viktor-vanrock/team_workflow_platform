import { createHash, randomUUID } from "node:crypto";

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { DataSource, EntityManager } from "typeorm";

import {
  confirmQaIntake,
  createQaIntakeDetailSection,
  createQaReadinessDetailSection,
  createQaSessionDetailSection,
  createQaVerdictCompletionDetailSection,
  listConfirmedQaBacklog,
  onQaRequestConfirmed,
  type QaConfirmedDraft,
  type QaIntakePayload,
  type QaOperationalRequestCreateResult,
  QaProjectPolicyRepository,
  type QaReadinessAssessment,
  QaReadinessRepository,
  QaRequestInputRepository,
  QaRequestRepository,
  type QaRequiredSessionPlanHeader,
  QaTypeOrmIntakeConfirmationWriter,
  QaWorkItemDetailSectionRegistry,
  type QaWorkspaceContext,
  TypeOrmManualSessionRepository,
} from "@awp/competency-qa/node";
import {
  CommandGateway,
  type CommandIntent,
  defaultClassificationCatalog,
  type WorkspaceContext,
} from "@awp/platform-core";
import { TypeOrmUnitOfWork } from "@awp/platform-persistence-typeorm";
import {
  QaIntakeDraftService,
  type QaUs1OperationalBrokerMap,
  qaUs1OperationalRoute,
} from "@awp/runtime-composition";

import {
  CorporateAdmissionUnitOfWork,
  type CorporateCommandAdmissionAuthority,
  QA_COMMAND_ADMISSION_AUTHORITY,
} from "./corporate-command-admission.ts";
import {
  authorizeQaApi,
  QA_DATA_SOURCE,
  type QaApiAuthorization,
  QaSessionGuard,
  type QaSessionRequest,
} from "./qa-api-authorization.ts";
import { QA_INTAKE_CONFIGURATION, type QaIntakeConfiguration } from "./qa-intake-configuration.ts";

interface ScopeContext {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly principalId: string;
  readonly authorization: QaApiAuthorization;
}
interface ResponseLike {
  setHeader(name: string, value: string): void;
  status?(code: number): ResponseLike;
}
export const QA_API_OPERATIONAL_BROKER_MAP = Symbol("QA_API_OPERATIONAL_BROKER_MAP");
export const QA_API_OPERATIONAL_DELIVERY_MODE = Symbol("QA_API_OPERATIONAL_DELIVERY_MODE");
export const QA_INTAKE_CLASSIFICATION_POLICY = Symbol("QA_INTAKE_CLASSIFICATION_POLICY");
export interface QaIntakeClassificationPolicy {
  assertAllowed(ceiling: string, requested: string, projectMaximum?: string): void;
}
export type QaOperationalDeliveryMode = "INLINE_LOCAL" | "DURABLE_WORKER";

function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
    .join(",")}}`;
}
function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}
function json<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId")
@UseGuards(QaSessionGuard)
export class QaPackController {
  constructor(
    @Inject(QA_DATA_SOURCE) private readonly source: DataSource,
    @Inject(QA_API_OPERATIONAL_BROKER_MAP)
    private readonly operationalBroker: QaUs1OperationalBrokerMap,
    @Inject(QA_API_OPERATIONAL_DELIVERY_MODE)
    private readonly deliveryMode: QaOperationalDeliveryMode,
    @Inject(QA_INTAKE_CONFIGURATION) private readonly configuration: QaIntakeConfiguration,
    @Optional()
    @Inject(QA_INTAKE_CLASSIFICATION_POLICY)
    private readonly classificationPolicy?: QaIntakeClassificationPolicy,
    @Optional()
    @Inject(QA_COMMAND_ADMISSION_AUTHORITY)
    private readonly commandAdmission?: CorporateCommandAdmissionAuthority,
  ) {}

  async #scope(
    request: QaSessionRequest,
    workspaceId: string,
    projectId: string,
    permission: string,
  ): Promise<ScopeContext> {
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      permission,
    );
    return { workspaceId, projectId, principalId: authorization.actor.principalId, authorization };
  }

  #workspaceContext(
    scope: ScopeContext,
    stableIds?: Readonly<{ correlationId: string; causationId: string }>,
  ): QaWorkspaceContext {
    return {
      actor: scope.authorization.actor,
      scope: scope.authorization.scope,
      authorizationBasis: scope.authorization.basis,
      correlationId: stableIds?.correlationId ?? randomUUID(),
      causationId: stableIds?.causationId ?? randomUUID(),
    };
  }

  @Post("qa/intake")
  async createDraft(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Body() payload: QaIntakePayload,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const scope = await this.#scope(request, workspaceId, projectId, "qa.request.create");
    const allowed = new Set([
      "schemaVersion",
      "title",
      "requestKind",
      "goal",
      "scope",
      "acceptanceOutcome",
      "sourceRefs",
      "blockers",
      "dependencies",
      "requestedTarget",
      "requestRisk",
      "businessImpact",
      "desiredDate",
      "checklistRefs",
      "roleMetadataRefs",
      "requestedClassificationKey",
      "defectRef",
      "previousSessionRef",
      "sourceBuildRef",
    ]);
    if (
      Object.keys(payload).some((key) => !allowed.has(key)) ||
      payload.schemaVersion !== 1 ||
      !payload.title?.trim() ||
      !payload.requestKind ||
      !payload.requestedClassificationKey
    )
      throw new BadRequestException("QA_INTAKE_INVALID");
    this.classificationPolicy?.assertAllowed(
      scope.authorization.classificationCeiling,
      payload.requestedClassificationKey,
    );
    const created = await new QaIntakeDraftService(this.source).create({
      workspaceId,
      projectId,
      principalId: scope.principalId,
      requestKey: randomUUID(),
      content: payload as never,
    });
    response.setHeader("ETag", `W/"${created.draft.rowVersion}"`);
    response.setHeader(
      "Location",
      `/api/v1/workspaces/${workspaceId}/projects/${projectId}/intake-drafts/${created.draft.id}/qa-status`,
    );
    return {
      draftId: created.draft.id,
      state: created.draft.state,
      resourceVersion: created.draft.rowVersion,
    };
  }

  @Post("intake-drafts/:draftId/qa-confirmation")
  async confirmDraft(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
    @Headers("idempotency-key") clientRequestKey: string | undefined,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const scope = await this.#scope(request, workspaceId, projectId, "qa.request.confirm");
    if (!clientRequestKey?.trim()) throw new BadRequestException("IDEMPOTENCY_KEY_REQUIRED");
    const rows = (await this.source.query(
      `SELECT d.*,i.issuer,i.subject FROM intake_drafts d JOIN identities i ON i.id=d.created_by WHERE d.workspace_id=$1 AND d.project_id=$2 AND d.id=$3`,
      [workspaceId, projectId, draftId],
    )) as readonly Record<string, unknown>[];
    const row = rows[0];
    if (!row) throw new NotFoundException("QA_DRAFT_NOT_FOUND");
    if (row.created_by !== scope.principalId)
      throw new ForbiddenException("QA_ORIGINAL_REQUESTER_REQUIRED");
    const configuration = await this.configuration.load({ workspaceId, projectId });
    const { bindingRef, profileRef } = configuration;
    const unitOfWork = this.commandAdmission
      ? new CorporateAdmissionUnitOfWork(this.source, this.commandAdmission)
      : new TypeOrmUnitOfWork(this.source);
    const sourceCommands =
      this.deliveryMode === "DURABLE_WORKER"
        ? ((await this.source.query(
            "SELECT id FROM connector_commands WHERE workspace_id=$1 AND project_id=$2 AND operation='request.create' AND payload #>> '{metadata,source,intakeDraftId}'=$3 ORDER BY created_at,id",
            [workspaceId, projectId, draftId],
          )) as readonly Readonly<{ id: string }>[])
        : [];
    if (sourceCommands.length > 1) throw new ConflictException("QA_DRAFT_CREATE_IDENTITY_CONFLICT");
    const sourceCommand = sourceCommands[0]
      ? await unitOfWork.command(workspaceId, projectId, sourceCommands[0].id)
      : undefined;
    if (sourceCommands[0] && !sourceCommand) throw new Error("QA_DRAFT_CREATE_COMMAND_NOT_FOUND");
    if (sourceCommand && unitOfWork instanceof CorporateAdmissionUnitOfWork)
      await unitOfWork.assertReplay(sourceCommand);
    if (this.deliveryMode === "DURABLE_WORKER" && sourceCommand?.status === "CONFIRMED") {
      const materialized = (await this.source.query(
        "SELECT id FROM work_items WHERE workspace_id=$1 AND project_id=$2 AND source_draft_id=$3 ORDER BY id",
        [workspaceId, projectId, draftId],
      )) as readonly Readonly<{ id: string }>[];
      if (materialized.length !== 1) {
        throw new Error("QA_DURABLE_COMMAND_MATERIALIZATION_INCONSISTENT");
      }
      response.setHeader("ETag", 'W/"1"');
      response.setHeader(
        "Location",
        `/api/v1/workspaces/${workspaceId}/projects/${projectId}/work-items/${materialized[0]!.id}/qa/detail`,
      );
      return {
        commandId: sourceCommand.id,
        effectIdempotencyKey: sourceCommand.effectIdempotencyKey,
        state: "CONFIRMED",
        workItemId: materialized[0]!.id,
        replayed: true,
      };
    }
    const confirmationVersion =
      sourceCommand?.source.confirmationVersion ??
      (row.state === "SUBMITTED" ? Number(row.row_version) - 1 : Number(row.row_version));
    const stableCreate =
      this.deliveryMode === "DURABLE_WORKER"
        ? await configuration.commandIdentity({ sourceId: draftId, confirmationVersion })
        : undefined;
    if (
      sourceCommand &&
      sourceCommand.effectIdempotencyKey !== stableCreate?.effectIdempotencyKey
    ) {
      throw new ConflictException("QA_DRAFT_CREATE_IDENTITY_CONFLICT");
    }
    const deterministicCommandId =
      stableCreate?.commandId ??
      deterministicUuid(
        `${workspaceId}:${projectId}:${scope.principalId}:operational-work-item.request.create:${clientRequestKey}`,
      );
    const effectKey =
      stableCreate?.effectIdempotencyKey ??
      `awp:effect:${deterministicUuid(`${workspaceId}:${projectId}:${scope.principalId}:${clientRequestKey}`)}`;
    const priorCommands = (await this.source.query(
      "SELECT id,correlation_id,causation_id,created_at FROM connector_commands WHERE effect_idempotency_key=$1",
      [effectKey],
    )) as readonly Record<string, unknown>[];
    const prior = priorCommands[0];
    const context = this.#workspaceContext(
      scope,
      prior
        ? {
            correlationId: String(prior.correlation_id),
            causationId: String(prior.causation_id),
          }
        : {
            correlationId: deterministicUuid(`${effectKey}:correlation`),
            causationId: deterministicUuid(`${effectKey}:causation`),
          },
    );
    const evaluatedAt = prior
      ? new Date(String(prior.created_at)).toISOString()
      : new Date(String(row.created_at)).toISOString();
    const projectContext = await new QaProjectPolicyRepository(this.source).currentProjectContext(
      { workspaceId, projectId },
      configuration.projectContextId,
    );
    if (!projectContext) throw new Error("QA_PROJECT_CONTEXT_NOT_PUBLISHED");
    const payload = json<QaIntakePayload>(row.intake_payload);
    this.classificationPolicy?.assertAllowed(
      scope.authorization.classificationCeiling,
      payload.requestedClassificationKey,
      projectContext.maximumClassificationKey,
    );
    const draft: QaConfirmedDraft = {
      id: draftId,
      version: confirmationVersion,
      contentHash: digest(payload),
      workspaceId,
      projectId,
      definitionRef: { key: "qa.validation", version: "1.0.0" },
      state: "CONFIRMED",
      requester: {
        kind: "HUMAN",
        principalId: scope.principalId,
        issuer: String(row.issuer),
        subject: String(row.subject),
      },
      payload,
      authoritativeClassificationKey: payload.requestedClassificationKey,
    };
    let commandId = prior
      ? String(prior.id)
      : this.deliveryMode === "DURABLE_WORKER"
        ? deterministicCommandId
        : deterministicUuid(`${effectKey}:command`);
    const candidate = await confirmQaIntake({
      context,
      draft,
      projectContext,
      bindingRef,
      profileRef,
      clientRequestKey,
      evaluatedAt,
      responseChannels: configuration.responseChannels,
      commandGateway: {
        submit: async (_ctx, intent) => {
          if (configuration.authorityScopeKey)
            intent = {
              ...intent,
              target: { ...intent.target, authorityScopeKey: configuration.authorityScopeKey },
            };
          if (this.deliveryMode === "DURABLE_WORKER") {
            const loadStableReplay = async () => {
              const matches = (await this.source.query(
                "SELECT id FROM connector_commands WHERE workspace_id=$1 AND project_id=$2 AND effect_idempotency_key=$3",
                [workspaceId, projectId, effectKey],
              )) as readonly Readonly<{ id: string }>[];
              const existing = matches[0]
                ? await unitOfWork.command(workspaceId, projectId, matches[0].id)
                : undefined;
              if (!existing) return undefined;
              if (unitOfWork instanceof CorporateAdmissionUnitOfWork)
                await unitOfWork.assertReplay(existing);
              if (
                digest(existing.target) !== digest(intent.target) ||
                digest(existing.payload) !== digest(intent.payload) ||
                digest(existing.bindingRef) !== digest(intent.bindingRef) ||
                digest(existing.profileRef) !== digest(intent.profileRef) ||
                existing.source.intakeDraftId !== draftId ||
                existing.source.confirmationVersion !== confirmationVersion
              )
                throw new ConflictException("QA_DRAFT_CREATE_IDENTITY_CONFLICT");
              commandId = existing.id;
              return {
                commandId: existing.id,
                effectIdempotencyKey: existing.effectIdempotencyKey,
                status: existing.status,
                replayed: true,
                ...(existing.terminalResult?.receipt
                  ? {
                      confirmedResult: existing.terminalResult
                        .receipt as QaOperationalRequestCreateResult,
                    }
                  : {}),
              };
            };
            const replay = await loadStableReplay();
            if (replay) return replay;
            const gateway = new CommandGateway(
              unitOfWork,
              { now: () => new Date(evaluatedAt) },
              { next: () => deterministicCommandId },
            );
            try {
              const submitted = await gateway.submit(
                context as unknown as WorkspaceContext,
                intent as unknown as CommandIntent,
              );
              commandId = submitted.command.id;
              return {
                commandId,
                effectIdempotencyKey: submitted.command.effectIdempotencyKey,
                status: submitted.command.status,
                replayed: submitted.replayed,
                ...(submitted.command.terminalResult?.receipt
                  ? {
                      confirmedResult: submitted.command.terminalResult
                        .receipt as QaOperationalRequestCreateResult,
                    }
                  : {}),
              };
            } catch (error) {
              if (error instanceof Error && error.message === "IDEMPOTENCY_CONCURRENT_CLAIM") {
                const concurrentWinner = await loadStableReplay();
                if (concurrentWinner) return concurrentWinner;
              }
              if (error instanceof Error && error.message === "IDEMPOTENCY_KEY_CONFLICT") {
                throw new ConflictException(error.message);
              }
              throw error;
            }
          }
          const inserted = (await this.source.query(
            "INSERT INTO connector_commands(id,workspace_id,project_id,actor,capability_key,capability_version,operation,target,payload,binding_ref,profile_ref,effect_idempotency_key,state,result,correlation_id,causation_id,created_at) VALUES($1,$2,$3,$4,'operational-work-item','1.0.0','request.create',$5,$6,$7,$8,$9,'QUEUED',NULL,$10,$11,$12) ON CONFLICT(effect_idempotency_key) DO NOTHING RETURNING id",
            [
              commandId,
              workspaceId,
              projectId,
              JSON.stringify(context.actor),
              JSON.stringify(intent.target),
              JSON.stringify(intent.payload),
              JSON.stringify(intent.bindingRef),
              JSON.stringify(intent.profileRef),
              effectKey,
              context.correlationId,
              context.causationId,
              evaluatedAt,
            ],
          )) as readonly { id: string }[];
          const found = (await this.source.query(
            "SELECT id,state,result,target,payload FROM connector_commands WHERE effect_idempotency_key=$1",
            [effectKey],
          )) as readonly Record<string, unknown>[];
          if (!found[0]) throw new Error("QA_COMMAND_INSERT_LOST");
          if (
            digest(found[0].target) !== digest(intent.target) ||
            digest(found[0].payload) !== digest(intent.payload)
          )
            throw new ConflictException("IDEMPOTENCY_KEY_CONFLICT");
          commandId = String(found[0].id);
          return {
            commandId,
            effectIdempotencyKey: effectKey,
            status: String(found[0].state),
            replayed: inserted.length === 0,
          };
        },
      },
    });
    if (this.deliveryMode === "DURABLE_WORKER" && candidate.command.status !== "CONFIRMED") {
      response.status?.(202);
      response.setHeader("ETag", `W/"${candidate.command.status}"`);
      response.setHeader(
        "Location",
        `/api/v1/workspaces/${workspaceId}/projects/${projectId}/intake-drafts/${draftId}/qa-status`,
      );
      return {
        commandId,
        effectIdempotencyKey: candidate.command.effectIdempotencyKey,
        state: candidate.command.status,
        replayed: candidate.command.replayed,
      };
    }
    if (this.deliveryMode === "DURABLE_WORKER") {
      const materialized = (await this.source.query(
        "SELECT id FROM work_items WHERE workspace_id=$1 AND project_id=$2 AND source_draft_id=$3 ORDER BY id",
        [workspaceId, projectId, draftId],
      )) as readonly Readonly<{ id: string }>[];
      if (materialized.length !== 1) {
        throw new Error("QA_DURABLE_COMMAND_MATERIALIZATION_INCONSISTENT");
      }
      response.setHeader("ETag", 'W/"1"');
      response.setHeader(
        "Location",
        `/api/v1/workspaces/${workspaceId}/projects/${projectId}/work-items/${materialized[0]!.id}/qa/detail`,
      );
      return {
        commandId,
        effectIdempotencyKey: candidate.command.effectIdempotencyKey,
        state: "CONFIRMED",
        workItemId: materialized[0]!.id,
        replayed: true,
      };
    }
    const confirmed = (await this.source.query(
      "SELECT result FROM connector_commands WHERE id=$1 AND state='CONFIRMED'",
      [commandId],
    )) as readonly Record<string, unknown>[];
    const storedResult = confirmed[0]?.result
      ? json<
          | QaOperationalRequestCreateResult
          | Readonly<{ receipt?: QaOperationalRequestCreateResult }>
        >(confirmed[0].result)
      : undefined;
    let receipt: QaOperationalRequestCreateResult | undefined = candidate.command.confirmedResult;
    if (!receipt && storedResult) {
      receipt =
        "receipt" in storedResult
          ? storedResult.receipt
          : (storedResult as QaOperationalRequestCreateResult);
    }
    if (!receipt && !configuration.inlineService)
      throw new Error("QA_INLINE_SERVICE_NOT_CONFIGURED");
    if (!receipt)
      receipt = await this.operationalBroker[qaUs1OperationalRoute].invoke(
        {
          scope: { kind: "PROJECT", workspaceId, projectId },
          actor: configuration.inlineService!,
          correlationId: context.correlationId,
          causationId: context.causationId,
          effectIdempotencyKey: effectKey,
          profileRef,
          classification: { key: payload.requestedClassificationKey, rank: 10 },
          signal: new AbortController().signal,
        },
        candidate.commandIntent.target,
        candidate.commandIntent.payload,
      );
    const workItemId = deterministicUuid(`${commandId}:work-item`);
    const delta = await this.source.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `qa-confirm:${workspaceId}:${projectId}:${draftId}`,
      ]);
      const work = (await manager.query(
        "SELECT id FROM work_items WHERE workspace_id=$1 AND project_id=$2 AND source_draft_id=$3 FOR UPDATE",
        [workspaceId, projectId, draftId],
      )) as readonly { id: string }[];
      const actualWorkItemId = work[0]?.id ?? workItemId;
      if (!work[0]) {
        await manager.query(
          "UPDATE intake_drafts SET state='SUBMITTED',submitted_at=clock_timestamp(),row_version=row_version+1 WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND state='DRAFT'",
          [workspaceId, projectId, draftId],
        );
        await manager.query(
          "INSERT INTO work_items(id,workspace_id,project_id,work_type_definition_id,source_draft_id,created_by,state,classification_key,row_version,created_at,acceptance_source) VALUES($1,$2,$3,$4,$5,$6,'NEW',$7,1,clock_timestamp(),'PLATFORM_DRAFT')",
          [
            actualWorkItemId,
            workspaceId,
            projectId,
            row.work_type_definition_id,
            draftId,
            scope.principalId,
            payload.requestedClassificationKey,
          ],
        );
      }
      const result = await onQaRequestConfirmed({
        effect: {
          workspaceId,
          projectId,
          commandId,
          effectIdempotencyKey: effectKey,
          capabilityKey: "operational-work-item",
          capabilityVersion: "1.0.0",
          operation: "request.create",
          result: receipt!,
          source: { intakeDraftId: draftId },
          bindingRef,
          profileRefs: [profileRef],
          correlationId: context.correlationId,
          causationId: context.causationId,
          workItemId: actualWorkItemId,
        },
        transaction: {
          transactionId: `api:${commandId}`,
          native: manager,
          contributionKey: "qa.request-create.confirmation",
          idempotencyKey: `${commandId}:confirmation:qa.request-create.confirmation`,
        },
        materials: {
          load: async () => ({
            context,
            draft,
            projectContext,
            responseChannelResolution: candidate.validated.responseChannelResolution,
            semanticInput: candidate.validated.semanticInput,
            blockersDeclared: candidate.validated.blockersDeclared,
            dependenciesDeclared: candidate.validated.dependenciesDeclared,
          }),
        },
        writer: new QaTypeOrmIntakeConfirmationWriter(),
        ids: {
          extensionId: () => deterministicUuid(`${commandId}:qa-extension`),
          inputRevisionId: () => deterministicUuid(`${commandId}:qa-input:1`),
          eventId: () => deterministicUuid(`${commandId}:qa-accepted-event`),
        },
        recordedAt: evaluatedAt,
      });
      await manager.query(
        "UPDATE connector_commands SET state='CONFIRMED',result=$1,row_version=row_version+1 WHERE id=$2 AND state<>'CONFIRMED'",
        [JSON.stringify(receipt), commandId],
      );
      await this.#persistDelta(manager, workspaceId, projectId, context, result);
      return { actualWorkItemId, delta: result };
    });
    response.setHeader("ETag", 'W/"1"');
    response.setHeader(
      "Location",
      `/api/v1/workspaces/${workspaceId}/projects/${projectId}/work-items/${delta.actualWorkItemId}/qa/detail`,
    );
    return {
      commandId,
      effectIdempotencyKey: effectKey,
      state: "CONFIRMED",
      workItemId: delta.actualWorkItemId,
      replayed: candidate.command.replayed || delta.delta.replayed,
    };
  }

  async #persistDelta(
    manager: EntityManager,
    workspaceId: string,
    projectId: string,
    context: QaWorkspaceContext,
    delta: Awaited<ReturnType<typeof onQaRequestConfirmed>>,
  ): Promise<void> {
    for (const event of delta.events ?? [])
      await manager.query(
        "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'READY',clock_timestamp()) ON CONFLICT DO NOTHING",
        [
          deterministicUuid(`${event.eventType}:${event.entityId}`),
          workspaceId,
          projectId,
          event.eventType,
          JSON.stringify(event.payload),
          digest(event.payload),
        ],
      );
    for (const audit of delta.audit ?? [])
      await manager.query(
        "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,clock_timestamp(),$4,$5,$6,$7,$8,$9,$10,'INTERNAL',$11) ON CONFLICT DO NOTHING",
        [
          deterministicUuid(`${context.correlationId}:${audit.action}`),
          workspaceId,
          projectId,
          JSON.stringify(context.actor),
          audit.action,
          audit.outcome,
          audit.reasonCode,
          context.correlationId,
          context.causationId,
          JSON.stringify(context.authorizationBasis),
          JSON.stringify({ values: audit.attributes ?? {}, versionRefs: [] }),
        ],
      );
  }

  @Get("intake-drafts/:draftId/qa-status")
  async status(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("draftId") draftId: string,
  ) {
    await this.#scope(request, workspaceId, projectId, "work-item.read");
    const rows = (await this.source.query(
      "SELECT d.state,d.row_version,w.id AS work_item_id,c.id AS command_id,c.state AS command_state FROM intake_drafts d LEFT JOIN work_items w ON w.workspace_id=d.workspace_id AND w.project_id=d.project_id AND w.source_draft_id=d.id LEFT JOIN connector_commands c ON c.workspace_id=d.workspace_id AND c.project_id=d.project_id AND c.target->>'naturalKey'=$4 WHERE d.workspace_id=$1 AND d.project_id=$2 AND d.id=$3",
      [workspaceId, projectId, draftId, `qa-${draftId}`],
    )) as readonly Record<string, unknown>[];
    if (!rows[0]) throw new NotFoundException("QA_DRAFT_NOT_FOUND");
    return rows[0];
  }

  @Get("qa/backlog")
  async backlog(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
  ) {
    const access = await this.#scope(request, workspaceId, projectId, "work-item.read");
    const requests = new QaRequestRepository(this.source);
    const inputs = new QaRequestInputRepository(this.source);
    const items = await listConfirmedQaBacklog(
      {
        extensions: async (value) => await requests.confirmedBacklog(value),
        input: async (value, workItemId, version) => await inputs.get(value, workItemId, version),
      },
      { workspaceId, projectId },
    );
    const rows = (await this.source.query(
      "SELECT id,classification_key FROM work_items WHERE workspace_id=$1 AND project_id=$2",
      [workspaceId, projectId],
    )) as { id: string; classification_key: string }[];
    const ceiling = defaultClassificationCatalog.reference(
      access.authorization.classificationCeiling,
    );
    const permitted = new Set(
      rows
        .filter((row) =>
          defaultClassificationCatalog.permits(
            ceiling,
            defaultClassificationCatalog.reference(row.classification_key),
          ),
        )
        .map((row) => row.id),
    );
    return {
      items: items.filter(
        (item) =>
          permitted.has(item.requestExtension.workItemId) &&
          defaultClassificationCatalog.permits(
            ceiling,
            defaultClassificationCatalog.reference(
              item.currentRequestInputRevision.dataClassificationKey,
            ),
          ),
      ),
    };
  }

  @Get("qa/backlog/:workItemId")
  async backlogItem(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    await this.#scope(request, workspaceId, projectId, "work-item.read");
    const items = await this.backlog(request, workspaceId, projectId);
    const item = items.items.find((value) => value.requestExtension.workItemId === workItemId);
    if (!item) throw new NotFoundException("QA_REQUEST_NOT_FOUND");
    response.setHeader("ETag", `W/"${item.requestExtension.resourceVersion}"`);
    return item;
  }

  @Get("work-items/:workItemId/qa/request-input-revisions/current")
  async currentInput(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    await this.#scope(request, workspaceId, projectId, "work-item.read");
    if (
      !(await this.backlog(request, workspaceId, projectId)).items.some(
        (item) => item.requestExtension.workItemId === workItemId,
      )
    )
      throw new NotFoundException("QA_REQUEST_NOT_FOUND");
    const extension = await new QaRequestRepository(this.source).byWorkItem(
      { workspaceId, projectId },
      workItemId,
    );
    if (!extension) throw new NotFoundException("QA_REQUEST_NOT_FOUND");
    const revision = await new QaRequestInputRepository(this.source).get(
      { workspaceId, projectId },
      workItemId,
      extension.currentRequestInputRevisionRef.version,
    );
    if (!revision) throw new NotFoundException("QA_REQUEST_INPUT_NOT_FOUND");
    response.setHeader("ETag", `W/"${extension.resourceVersion}"`);
    return revision;
  }

  @Get("work-items/:workItemId/qa/request-input-revisions")
  async inputHistory(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    await this.#scope(request, workspaceId, projectId, "work-item.read");
    if (
      !(await this.backlog(request, workspaceId, projectId)).items.some(
        (item) => item.requestExtension.workItemId === workItemId,
      )
    )
      throw new NotFoundException("QA_REQUEST_NOT_FOUND");
    const extension = await new QaRequestRepository(this.source).byWorkItem(
      { workspaceId, projectId },
      workItemId,
    );
    if (!extension) throw new NotFoundException("QA_REQUEST_NOT_FOUND");
    const revisions = await new QaRequestInputRepository(this.source).history(
      { workspaceId, projectId },
      workItemId,
    );
    response.setHeader("ETag", `W/"${extension.resourceVersion}"`);
    return {
      schemaVersion: 1,
      workspaceId,
      projectId,
      workItemId,
      extensionId: extension.extensionId,
      currentInputRevisionRef: extension.currentRequestInputRevisionRef,
      resourceVersion: extension.resourceVersion,
      revisions,
    };
  }

  @Get("work-items/:workItemId/qa")
  async requestExtension(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    await this.#scope(request, workspaceId, projectId, "work-item.read");
    const extension = await new QaRequestRepository(this.source).byWorkItem(
      { workspaceId, projectId },
      workItemId,
    );
    if (!extension) throw new NotFoundException("QA_REQUEST_NOT_FOUND");
    response.setHeader("ETag", `W/"${extension.resourceVersion}"`);
    return extension;
  }

  @Get("work-items/:workItemId/qa/detail")
  async detail(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    await this.#scope(request, workspaceId, projectId, "work-item.read");
    if (
      !(await this.backlog(request, workspaceId, projectId)).items.some(
        (item) => item.requestExtension.workItemId === workItemId,
      )
    )
      throw new NotFoundException("QA_REQUEST_NOT_FOUND");
    const requests = new QaRequestRepository(this.source);
    const inputs = new QaRequestInputRepository(this.source);
    const readiness = new QaReadinessRepository(this.source);
    const detail = await new QaWorkItemDetailSectionRegistry([
      createQaIntakeDetailSection({ requests, inputs }),
      createQaReadinessDetailSection({
        latest: async (value, id) => await readiness.latest(value, id),
        assessmentHistory: async (value, id) => {
          const rows = (await this.source.query(
            "SELECT content FROM qa_readiness_assessments WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY assessment_version",
            [value.workspaceId, value.projectId, id],
          )) as readonly { content: QaReadinessAssessment }[];
          return rows.map(({ content }) => content);
        },
        plan: async (value, id) => {
          const rows = (await this.source.query(
            "SELECT h.*,COALESCE(jsonb_agg(v.content ORDER BY v.version) FILTER(WHERE v.plan_version_id IS NOT NULL),'[]') AS revisions FROM qa_required_session_plans h LEFT JOIN qa_required_session_plan_versions v ON v.plan_id=h.plan_id WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.work_item_id=$3 GROUP BY h.plan_id",
            [value.workspaceId, value.projectId, id],
          )) as readonly Record<string, unknown>[];
          const row = rows[0];
          if (!row) return undefined;
          return {
            id: String(row.plan_id),
            workspaceId: value.workspaceId,
            projectId: value.projectId,
            workItemId: id,
            extensionId: String(row.extension_id),
            currentRevisionRef: row.current_version_id
              ? {
                  id: String(row.current_version_id),
                  version: Number(row.current_version),
                  contentHash: String(row.current_content_hash) as `sha256:${string}`,
                }
              : null,
            revisions: json<QaRequiredSessionPlanHeader["revisions"]>(row.revisions),
            resourceVersion: Number(row.resource_version),
            createdAt: new Date(String(row.created_at)).toISOString(),
            updatedAt: new Date(String(row.updated_at)).toISOString(),
          };
        },
        operational: async (value, id) => {
          const rows = (await this.source.query(
            "SELECT state FROM work_items WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
            [value.workspaceId, value.projectId, id],
          )) as readonly { state: string }[];
          const normalizedStatus = rows[0]?.state ?? "NEW";
          return {
            normalizedStatus,
            syncStage: normalizedStatus === "READY" ? "READY" : "NOT_CONFIRMED",
          };
        },
      }),
      createQaSessionDetailSection({
        sessions: async (value, id) =>
          await new TypeOrmManualSessionRepository(this.source).list(value, id),
        planItems: async (value, id) => {
          const rows = (await this.source.query(
            "SELECT content FROM qa_plan_items WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY session_id,ordinal",
            [value.workspaceId, value.projectId, id],
          )) as readonly { content: unknown }[];
          return rows.map(({ content }) => json(content));
        },
      }),
      createQaVerdictCompletionDetailSection({
        verdicts: async (value, id) =>
          (await this.source.query(
            "SELECT * FROM qa_verdicts WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY version,verdict_id",
            [value.workspaceId, value.projectId, id],
          )) as readonly unknown[],
        verdictSignatures: async (value, id) =>
          (await this.source.query(
            "SELECT * FROM qa_verdict_signatures WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY signed_at,signature_id",
            [value.workspaceId, value.projectId, id],
          )) as readonly unknown[],
        dodAssessments: async (value, id) =>
          (await this.source.query(
            "SELECT * FROM qa_dod_assessments WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY version,assessment_id",
            [value.workspaceId, value.projectId, id],
          )) as readonly unknown[],
        completionCandidates: async (value, id) =>
          (await this.source.query(
            "SELECT * FROM qa_completion_candidates WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY candidate_number,candidate_id",
            [value.workspaceId, value.projectId, id],
          )) as readonly unknown[],
        finalCloseConfirmations: async (value, id) =>
          (await this.source.query(
            "SELECT * FROM qa_final_close_confirmations WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY confirmed_at,confirmation_id",
            [value.workspaceId, value.projectId, id],
          )) as readonly unknown[],
        postCloseCorrectionMarkers: async (value, id) =>
          (await this.source.query(
            "SELECT * FROM qa_post_close_correction_markers WHERE workspace_id=$1 AND project_id=$2 AND work_item_id=$3 ORDER BY recorded_at,marker_id",
            [value.workspaceId, value.projectId, id],
          )) as readonly unknown[],
      }),
    ]).detail({ workspaceId, projectId, workItemId });
    response.setHeader(
      "ETag",
      `W/"${(detail.requestExtension as { resourceVersion: number }).resourceVersion}"`,
    );
    return detail;
  }
}
