import { randomUUID } from "node:crypto";

import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import type { DataSource, EntityManager } from "typeorm";

import {
  assertSessionStartGuards,
  buildScopeSnapshot,
  buildTargetSnapshot,
  createLinkedReplacementSession,
  ManualExecutionUnitOfWork,
  planManualSession,
  prepareManualSession,
  qaAggregateSnapshotHash,
  type QaPlanItem,
  type QaPlanItemDefinition,
  QaProjectPolicyRepository,
  QaRequestInputRepository,
  QaRequestRepository,
  type QaRequiredSessionPlanRevision,
  qaSessionPlannedAudit,
  qaSessionPlanningAudit,
  qaSessionStateChangedEvent,
  type QaTestSession,
  replacePlannedItems,
  resumeBlockedTestSession,
  startPreparedTestSession,
  transitionExecutionSession,
  TypeOrmManualExecutionRepository,
  TypeOrmManualPlanItemRepository,
  TypeOrmManualSessionRepository,
} from "@awp/competency-qa/node";
import {
  assertStrongSessionIfMatch,
  type QaSessionRuntime,
  type QaSessionRuntimeAuthority,
  strongSessionEtag,
} from "@awp/runtime-composition";

import { PublishedOnboardingProblemFilter } from "./onboarding/published-http.ts";
import {
  captureOnboardingSessionTarget,
  onboardingSessionContext,
} from "./onboarding/session-facts.ts";
import {
  authorizeQaApi,
  QA_DATA_SOURCE,
  QaSessionGuard,
  type QaSessionRequest,
} from "./qa-api-authorization.ts";

interface ResponseLike {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
}
export const QA_SESSION_RUNTIME = Symbol("QA_SESSION_RUNTIME");
interface RequirementRefBody {
  readonly planRef: Readonly<{ id: string; revision: number; contentHash: `sha256:${string}` }>;
  readonly requirementKey: string;
  readonly ordinal: number;
  readonly contentHash: `sha256:${string}`;
}
interface PlanItemBody {
  readonly title: string;
  readonly instructions?: string;
  readonly expectedOutcome: string;
  readonly definition: QaPlanItemDefinition;
}

const versionEtag = (version: number) => `W/"${version}"`;
const parseEtag = (value: string | undefined): number =>
  Number(
    /^(?:W\/)?"(?:qa-session:)?([0-9]+)(?::sha256:[a-f0-9]{64})?"$/u.exec(value ?? "")?.[1] ??
      Number.NaN,
  );
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

const sessionEtag = (session: QaTestSession) =>
  strongSessionEtag({
    sourceId: session.id,
    sourceVersion: session.resourceVersion,
    semanticHash: qaAggregateSnapshotHash(session as never),
  });

function requireVersion(ifMatch: string | undefined): number {
  const version = parseEtag(ifMatch);
  if (!Number.isFinite(version)) throw new ConflictException("QA_IF_MATCH_REQUIRED");
  return version;
}

function planItemDraft(item: QaPlanItem) {
  return {
    id: item.id,
    title: item.title,
    ...(item.instructions === undefined ? {} : { instructions: item.instructions }),
    expectedOutcome: item.expectedOutcome,
    definition: item.definition,
    createdAt: item.createdAt,
  };
}

function publicPlanItem(item: QaPlanItem) {
  return {
    schemaVersion: 1,
    planItemId: item.id,
    workspaceId: item.workspaceId,
    projectId: item.projectId,
    workItemId: item.workItemId,
    sessionId: item.sessionId,
    ordinal: item.ordinal,
    mode: item.mode,
    title: item.title,
    ...(item.instructions === undefined ? {} : { instructions: item.instructions }),
    expectedOutcome: item.expectedOutcome,
    definition: item.definition,
    state: item.state,
    ...(item.latestResultRevisionRef === undefined
      ? {}
      : { latestResultRevisionRef: item.latestResultRevisionRef }),
    ...(item.waiverRef === undefined ? {} : { waiverRef: item.waiverRef }),
    resourceVersion: item.resourceVersion,
    createdBy: item.createdBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function publicSession(session: QaTestSession) {
  const reachedMilestone =
    session.state === "BLOCKED" || session.state === "CANCELLED"
      ? (session.blockedFrom ?? session.cancelledFrom ?? "PLANNED")
      : session.state === "COMPLETED"
        ? "REVIEW_REQUIRED"
        : session.state;
  return {
    schemaVersion: 1,
    sessionId: session.id,
    workspaceId: session.workspaceId,
    projectId: session.projectId,
    workItemId: session.workItemId,
    requiredSessionPlanRef: {
      id: session.planRevisionRef.id,
      revision: session.planRevisionRef.version,
      contentHash: session.planRevisionRef.contentHash,
    },
    requiredSessionRequirementRef: {
      planRef: {
        id: session.planRevisionRef.id,
        revision: session.planRevisionRef.version,
        contentHash: session.planRevisionRef.contentHash,
      },
      requirementKey: session.requirementRef.requirementKey,
      ordinal: session.requirementRef.ordinal ?? session.ordinal,
      contentHash: session.requirementRef.contentHash,
    },
    ordinal: session.ordinal,
    ...(session.parentSessionId === undefined ? {} : { parentSessionId: session.parentSessionId }),
    mode: session.mode,
    purpose: session.scopeSnapshot.purpose,
    state: session.state,
    owner: { ...session.createdBy, principalId: session.ownerId },
    requiredCapabilities: session.requiredCapabilities,
    structureRevision: session.structureRevision,
    structureHash: session.structureHash,
    readyAgainstStructureHash: session.readyAgainstStructureHash,
    ...(session.structureRevision === 1
      ? {}
      : {
          latestStructureChange: {
            reasonCode: "STRUCTURE_CHANGED",
            previousStructureRevision: session.structureRevision - 1,
            previousStructureHash: session.previousStructureHash,
            previousState: session.previousStructureState,
            ...(session.previousReadyAgainstStructureHash === undefined
              ? {}
              : { previousReadyAgainstStructureHash: session.previousReadyAgainstStructureHash }),
            changedBy: session.lastTransitionActor,
            changedAt: session.readyAt ?? session.createdAt,
          },
        }),
    ...(session.readyAt === undefined
      ? {}
      : {
          targetSnapshotRef: { id: session.id, contentHash: session.targetSnapshot.contentHash },
          scopeSnapshotRef: { id: session.id, contentHash: session.scopeSnapshot.contentHash },
          targetSnapshotHash: session.targetSnapshot.contentHash,
          scopeSnapshotHash: session.scopeSnapshot.contentHash,
          readyBy: session.readyBy ?? session.createdBy,
          readyAt: session.readyAt,
        }),
    ...(session.startedAt === undefined
      ? {}
      : { startedBy: session.startedBy ?? session.createdBy, startedAt: session.startedAt }),
    ...(session.latestSessionReviewId === undefined
      ? {}
      : { latestSessionReviewRef: { id: session.latestSessionReviewId } }),
    ...(session.sessionOutcome === undefined ? {} : { sessionOutcome: session.sessionOutcome }),
    ...(session.adjudicativeManifestRevisionId === undefined
      ? {}
      : {
          adjudicativeEvidenceManifestRevisionRef: { id: session.adjudicativeManifestRevisionId },
        }),
    ...(session.completedAt === undefined
      ? {}
      : { completedBy: session.lastTransitionActor, completedAt: session.completedAt }),
    ...(session.state === "BLOCKED"
      ? {
          blockedReason: session.stateReason,
          blockedBy: session.lastTransitionActor,
          blockedAt: session.blockedAt,
          interruptedFromState: session.blockedFrom,
          reachedMilestone,
        }
      : {}),
    ...(session.state === "CANCELLED"
      ? {
          cancelledReason: session.stateReason,
          cancelledBy: session.lastTransitionActor,
          cancelledAt: session.cancelledAt,
          interruptedFromState: session.cancelledFrom,
          reachedMilestone,
        }
      : {}),
    resourceVersion: session.resourceVersion,
    createdBy: session.createdBy,
    createdAt: session.createdAt,
    updatedAt:
      session.blockedAt ??
      session.cancelledAt ??
      session.startedAt ??
      session.readyAt ??
      session.createdAt,
    correlationId: session.id,
  };
}

@Controller("api/v1/workspaces/:workspaceId/projects/:projectId/work-items/:workItemId/qa/sessions")
@UseGuards(QaSessionGuard)
@UseFilters(PublishedOnboardingProblemFilter)
export class QaSessionsController {
  constructor(
    @Inject(QA_DATA_SOURCE) private readonly source: DataSource,
    @Inject(QA_SESSION_RUNTIME) private readonly runtime: QaSessionRuntime,
  ) {}

  @Get()
  async list(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read");
    return (
      await new TypeOrmManualSessionRepository(this.source).list(
        { workspaceId, projectId },
        workItemId,
      )
    ).map(publicSession);
  }

  @Post()
  async create(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body()
    body: Readonly<{ requiredSessionRequirementRef: RequirementRefBody; parentSessionId?: string }>,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.session.plan",
    );
    const expectedCreationVersion = requireVersion(ifMatch);
    const material = await this.material(workspaceId, projectId, workItemId);
    if (!body.parentSessionId && expectedCreationVersion !== material.plan.version)
      throw new ConflictException("QA_REQUIRED_SESSION_PLAN_STALE_VERSION");
    const requirement = material.plan.requirements.find(
      ({ requirementKey }) => requirementKey === body.requiredSessionRequirementRef.requirementKey,
    );
    if (
      !requirement ||
      body.requiredSessionRequirementRef.planRef.id !== material.plan.id ||
      body.requiredSessionRequirementRef.planRef.revision !== material.plan.version ||
      body.requiredSessionRequirementRef.planRef.contentHash !== material.plan.contentHash ||
      body.requiredSessionRequirementRef.ordinal !== requirement.ordinal ||
      body.requiredSessionRequirementRef.contentHash !== requirement.contentHash
    )
      throw new ConflictException("QA_SESSION_REQUIREMENT_REF_STALE");
    const target = material.input.requestedTarget;
    const buildRef = target?.buildRef ?? material.input.sourceBuildRef;
    const environment = material.context.allowedEnvironments.find(
      ({ environmentId, revision }) =>
        environmentId === target?.environmentId && revision === target?.environmentRevision,
    );
    if (!target || !buildRef || !environment)
      throw new ConflictException("QA_SESSION_TARGET_INPUTS_INCOMPLETE");
    const authority = this.runtimeAuthority(request, workspaceId, projectId, authorization.actor);
    const profileRefs = await this.runtime.profiles(
      this.source,
      authority,
      material.input.operationalBindingRef,
      "qa.session.plan",
    );
    const targetSnapshot = buildTargetSnapshot({
      scope: { workspaceId, projectId },
      buildRef,
      environmentRef: {
        id: environment.environmentId,
        revision: environment.revision,
        scope: environment.scope,
      },
      allowedEnvironments: material.context.allowedEnvironments,
      ...(target.testDataRef ? { testDataRef: target.testDataRef } : {}),
      ...(target.accountLeaseRef ? { accountLeaseRef: target.accountLeaseRef } : {}),
      checklistRefs: requirement.checklistPolicyRefs,
      bindingRef: material.input.operationalBindingRef,
      profileRefs,
    });
    const scopeSnapshot = buildScopeSnapshot({
      purpose: requirement.purpose,
      agreedScope: material.input.scope ?? "Confirmed request scope",
      acceptanceOutcome: material.input.acceptanceOutcome ?? "Confirmed acceptance outcome",
      inclusions: [material.input.scope ?? requirement.purpose],
      exclusions: ["production"],
      checklistDefinition: requirement.scopePolicyRef,
    });
    const createdAt = new Date().toISOString();
    const session = await this.source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `qa-request:${workspaceId}:${projectId}:${workItemId}`,
      ]);
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `qa-session:${workspaceId}:${projectId}:${workItemId}`,
      ]);
      const currentMaterial = await this.material(workspaceId, projectId, workItemId, manager);
      const currentProfiles = await this.runtime.profiles(
        manager,
        authority,
        currentMaterial.input.operationalBindingRef,
        "qa.session.plan",
      );
      if (
        qaAggregateSnapshotHash(material as never) !==
          qaAggregateSnapshotHash(currentMaterial as never) ||
        !this.profilesMatch(profileRefs, currentProfiles)
      )
        throw new ConflictException("QA_SESSION_CONFIGURATION_CHANGED");
      const currentAuthorization = await authority.authorize("qa.session.plan");
      if (currentAuthorization.actor.principalId !== authorization.actor.principalId)
        throw new ConflictException("QA_SESSION_AUTHORITY_CHANGED");
      const repository = new TypeOrmManualSessionRepository(manager);
      const existing = await repository.list({ workspaceId, projectId }, workItemId);
      const parent = body.parentSessionId
        ? existing.find(({ id }) => id === body.parentSessionId)
        : undefined;
      if (body.parentSessionId && (!parent || parent.resourceVersion !== expectedCreationVersion))
        throw new ConflictException("QA_LINKED_SESSION_PARENT_STALE_VERSION");
      const next = parent
        ? createLinkedReplacementSession({
            original: parent,
            id: randomUUID(),
            ordinal: Math.max(0, ...existing.map(({ ordinal }) => ordinal)) + 1,
            targetSnapshot,
            scopeSnapshot,
            actor: authorization.actor,
            createdAt,
          })
        : planManualSession({
            id: randomUUID(),
            plan: material.plan,
            requirementKey: requirement.requirementKey,
            confirmedOperationalReady: material.operationalState === "READY",
            existingSessions: existing,
            ownerId: authorization.actor.principalId,
            targetSnapshot,
            scopeSnapshot,
            actor: authorization.actor,
            createdAt,
          });
      await repository.insert(next);
      await this.recordPlanned(
        manager,
        next,
        currentAuthorization.actor,
        currentAuthorization.basis,
        material.classificationKey,
        createdAt,
      );
      return next;
    });
    response.setHeader("ETag", sessionEtag(session));
    response.setHeader(
      "Location",
      `/api/v1/workspaces/${workspaceId}/projects/${projectId}/work-items/${workItemId}/qa/sessions/${session.id}`,
    );
    return publicSession(session);
  }

  @Get(":sessionId")
  async get(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("sessionId") sessionId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read");
    const session = await this.session(workspaceId, projectId, workItemId, sessionId);
    response.setHeader("ETag", sessionEtag(session));
    return publicSession(session);
  }

  @Post(":sessionId/transitions")
  async transition(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("sessionId") sessionId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body()
    body: Readonly<{
      requestedState: "READY" | "RUNNING" | "REVIEW_REQUIRED" | "BLOCKED" | "CANCELLED";
      reason?: string;
      targetInputFingerprint?: string;
      scopeInputFingerprint?: string;
      expectedStructureHash?: string;
      overrideIntent?: Readonly<{ reason: string; expiresAt: string }>;
    }>,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const permission = body.requestedState === "READY" ? "qa.session.plan" : "qa.session.execute";
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      permission,
    );
    const expectedResourceVersion = requireVersion(ifMatch);
    const at = new Date().toISOString();
    const correlationId = randomUUID();
    const causationId = randomUUID();
    const result = await this.source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `qa-session:${workspaceId}:${projectId}:${sessionId}`,
      ]);
      const currentAuthorization = await authorizeQaApi(
        this.source,
        request,
        workspaceId,
        projectId,
        permission,
      );
      if (currentAuthorization.actor.principalId !== authorization.actor.principalId)
        throw new ConflictException("QA_SESSION_AUTHORITY_CHANGED");
      const repository = new TypeOrmManualSessionRepository(manager);
      const previous = await repository.get({ workspaceId, projectId }, sessionId);
      if (!previous || previous.workItemId !== workItemId)
        throw new NotFoundException("QA_SESSION_NOT_FOUND");
      if (previous.resourceVersion !== expectedResourceVersion)
        throw new ConflictException("QA_SESSION_STALE_VERSION");
      if (body.requestedState === "RUNNING" || body.requestedState === "REVIEW_REQUIRED") {
        try {
          assertStrongSessionIfMatch(ifMatch, {
            sourceId: previous.id,
            sourceVersion: previous.resourceVersion,
            semanticHash: qaAggregateSnapshotHash(previous as never),
          });
        } catch {
          throw new ConflictException("CAPACITY_ADMISSION_SESSION_ETAG_STALE");
        }
      }
      const planItems = await new TypeOrmManualPlanItemRepository(manager).list(
        { workspaceId, projectId },
        sessionId,
      );
      const executionFacts = await new TypeOrmManualExecutionRepository(manager).executionFacts(
        { workspaceId, projectId },
        sessionId,
      );
      const material = await this.material(workspaceId, projectId, workItemId, manager);
      let candidate: QaTestSession;
      if (body.requestedState === "READY") {
        candidate =
          previous.state === "BLOCKED" && previous.blockedFrom === "READY"
            ? resumeBlockedTestSession(previous, {
                actor: authorization.actor,
                at,
                target: "READY",
                expectedResourceVersion,
              })
            : prepareManualSession({
                session: previous,
                planItems,
                actor: authorization.actor,
                at,
                expectedResourceVersion,
              });
      } else if (body.requestedState === "RUNNING") {
        if (
          body.targetInputFingerprint !== previous.targetSnapshot.contentHash ||
          body.scopeInputFingerprint !== previous.scopeSnapshot.contentHash ||
          body.expectedStructureHash !== previous.structureHash
        )
          throw new ConflictException("QA_SESSION_START_FINGERPRINT_STALE");
        const currentEnvironment = material.context.allowedEnvironments.find(
          ({ environmentId }) => environmentId === previous.targetSnapshot.environmentRef.id,
        );
        const currentProfiles = await this.runtime.profiles(
          manager,
          this.runtimeAuthority(request, workspaceId, projectId, currentAuthorization.actor),
          material.input.operationalBindingRef,
          "qa.session.execute",
        );
        assertSessionStartGuards({
          confirmedOperationalReady: material.operationalState === "READY",
          environment: {
            scope: currentEnvironment?.scope ?? "PRODUCTION",
            currentRevision: currentEnvironment?.revision ?? -1,
            snapshotRevision: previous.targetSnapshot.environmentRef.revision,
          },
          buildPinned: previous.targetSnapshot.buildRef.contentHash.startsWith("sha256:"),
          testDataOrAccountPinned: Boolean(
            previous.targetSnapshot.testDataRef || previous.targetSnapshot.accountLeaseRef,
          ),
          checklistPinned: previous.targetSnapshot.checklistRefs.length > 0,
          bindingCompatible:
            previous.targetSnapshot.bindingRef.id === material.input.operationalBindingRef.id &&
            previous.targetSnapshot.bindingRef.version ===
              material.input.operationalBindingRef.version,
          profilesCompatible: this.profilesMatch(
            previous.targetSnapshot.profileRefs,
            currentProfiles,
          ),
          readyAgainstCurrentStructure:
            previous.readyAgainstStructureHash === previous.structureHash,
        });
        candidate =
          previous.state === "BLOCKED" && previous.blockedFrom === "RUNNING"
            ? resumeBlockedTestSession(previous, {
                actor: authorization.actor,
                at,
                target: "RUNNING",
                expectedResourceVersion,
              })
            : startPreparedTestSession(previous, {
                actor: authorization.actor,
                at,
                expectedResourceVersion,
                confirmedOperationalReady: true,
              });
      } else {
        candidate = transitionExecutionSession({
          session: previous,
          requestedState: body.requestedState,
          actor: authorization.actor,
          at,
          ...(body.reason === undefined ? {} : { reason: body.reason }),
          expectedResourceVersion,
          executionFacts,
        });
      }
      const admission = this.runtime.admission(manager, {
        ...this.runtimeAuthority(request, workspaceId, projectId, currentAuthorization.actor),
        correlationId,
        causationId,
        ...(body.overrideIntent ? { overrideIntent: body.overrideIntent } : {}),
      });
      const persisted = await new ManualExecutionUnitOfWork(manager, admission).persistTransition(
        previous,
        candidate,
      );
      if (!persisted.persisted)
        return Object.freeze({
          state: "DENIED" as const,
          previous,
          admission: persisted.admission,
        });
      if (candidate.state === "RUNNING") await captureOnboardingSessionTarget(manager, candidate);
      await this.recordTransition(
        manager,
        previous,
        candidate,
        currentAuthorization.actor,
        currentAuthorization.basis,
        material.classificationKey,
        at,
        correlationId,
        causationId,
      );
      return Object.freeze({ state: "PERSISTED" as const, next: candidate });
    });
    if (result.state === "DENIED") {
      response.setHeader("ETag", sessionEtag(result.previous));
      const candidate = result.admission?.overrideCandidate;
      if (candidate) {
        response.status(202);
        response.setHeader(
          "Location",
          `/api/v1/workspaces/${workspaceId}/projects/${projectId}/approvals/${candidate.approvalId}`,
        );
      }
      return Object.freeze({
        schemaVersion: candidate
          ? "capacity-admission-override-candidate-response@1.0.0"
          : "capacity-admission-response@1.0.0",
        decision: Object.freeze({
          outcome: "DENIED",
          decisionRef: result.admission?.decisionRef,
          replayed: result.admission?.replayed ?? false,
        }),
        ...(candidate
          ? {
              overrideCandidate: Object.freeze({
                schemaVersion: "queue-action-receipt@1.0.0",
                actionId: candidate.actionId,
                actionKind: "WIP_ADMISSION_OVERRIDE",
                state: "PENDING_APPROVAL",
                resourceVersion: 1,
                publicIntentHash: candidate.publicIntentHash,
                approvalRequired: true,
                approvalRef: Object.freeze({
                  sourceType: "APPROVAL_SUBJECT_V2",
                  sourceId: candidate.approvalId,
                  sourceVersion: 1,
                  semanticHash: candidate.approvalSubjectHash,
                }),
                requestedAt: at,
                expiresAt: candidate.expiresAt,
              }),
            }
          : {}),
      });
    }
    response.setHeader("ETag", sessionEtag(result.next));
    return publicSession(result.next);
  }

  @Get(":sessionId/plan-items")
  async listPlanItems(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("sessionId") sessionId: string,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read");
    await this.session(workspaceId, projectId, workItemId, sessionId);
    return (
      await new TypeOrmManualPlanItemRepository(this.source).list(
        { workspaceId, projectId },
        sessionId,
      )
    ).map(publicPlanItem);
  }

  @Post(":sessionId/plan-items")
  async createPlanItem(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("sessionId") sessionId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: PlanItemBody,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const result = await this.mutatePlanItems(
      request,
      workspaceId,
      projectId,
      workItemId,
      sessionId,
      requireVersion(ifMatch),
      (items) => [...items.map(planItemDraft), { id: randomUUID(), ...body }],
    );
    const planItem = result.items.at(-1)!;
    response.setHeader("ETag", sessionEtag(result.session));
    response.setHeader(
      "Location",
      `/api/v1/workspaces/${workspaceId}/projects/${projectId}/work-items/${workItemId}/qa/sessions/${sessionId}/plan-items/${planItem.id}`,
    );
    return {
      mutationResult: "STRUCTURE_CHANGED",
      session: publicSession(result.session),
      planItem: publicPlanItem(planItem),
    };
  }

  @Get(":sessionId/plan-items/:planItemId")
  async getPlanItem(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("sessionId") sessionId: string,
    @Param("planItemId") planItemId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    await authorizeQaApi(this.source, request, workspaceId, projectId, "work-item.read");
    await this.session(workspaceId, projectId, workItemId, sessionId);
    const item = await new TypeOrmManualPlanItemRepository(this.source).get(
      { workspaceId, projectId },
      sessionId,
      planItemId,
    );
    if (!item) throw new NotFoundException("QA_PLAN_ITEM_NOT_FOUND");
    response.setHeader("ETag", versionEtag(item.resourceVersion));
    return publicPlanItem(item);
  }

  @Patch(":sessionId/plan-items/:planItemId")
  async updatePlanItem(
    @Req() request: QaSessionRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("workItemId") workItemId: string,
    @Param("sessionId") sessionId: string,
    @Param("planItemId") planItemId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: Partial<PlanItemBody>,
    @Res({ passthrough: true }) response: ResponseLike,
  ) {
    const result = await this.mutatePlanItems(
      request,
      workspaceId,
      projectId,
      workItemId,
      sessionId,
      requireVersion(ifMatch),
      (items) =>
        items.map((item) =>
          item.id === planItemId ? { ...planItemDraft(item), ...body } : planItemDraft(item),
        ),
    );
    const planItem = result.items.find(({ id }) => id === planItemId);
    if (!planItem) throw new NotFoundException("QA_PLAN_ITEM_NOT_FOUND");
    response.setHeader("ETag", sessionEtag(result.session));
    return {
      mutationResult: "STRUCTURE_CHANGED",
      session: publicSession(result.session),
      planItem: publicPlanItem(planItem),
    };
  }

  private async session(
    workspaceId: string,
    projectId: string,
    workItemId: string,
    sessionId: string,
  ): Promise<QaTestSession> {
    const session = await new TypeOrmManualSessionRepository(this.source).get(
      { workspaceId, projectId },
      sessionId,
    );
    if (!session || session.workItemId !== workItemId)
      throw new NotFoundException("QA_SESSION_NOT_FOUND");
    return session;
  }

  private runtimeAuthority(
    request: QaSessionRequest,
    workspaceId: string,
    projectId: string,
    actor: QaSessionRuntimeAuthority["actor"],
  ): QaSessionRuntimeAuthority {
    return {
      workspaceId,
      projectId,
      actor,
      authorize: (permission) =>
        authorizeQaApi(this.source, request, workspaceId, projectId, permission),
    };
  }
  private profilesMatch(
    left: readonly Readonly<{ id: string; version: number }>[],
    right: readonly Readonly<{ id: string; version: number }>[],
  ): boolean {
    return (
      left.length === right.length &&
      left.length > 0 &&
      left.every((ref) =>
        right.some((other) => ref.id === other.id && ref.version === other.version),
      )
    );
  }

  private async material(
    workspaceId: string,
    projectId: string,
    workItemId: string,
    source: DataSource | EntityManager = this.source,
  ) {
    const requests = new QaRequestRepository(source);
    const extension = await requests.byWorkItem({ workspaceId, projectId }, workItemId);
    if (!extension) throw new NotFoundException("QA_REQUEST_NOT_FOUND");
    const input = await new QaRequestInputRepository(source).get(
      { workspaceId, projectId },
      workItemId,
      extension.currentRequestInputRevisionRef.version,
    );
    if (!input) throw new NotFoundException("QA_REQUEST_INPUT_NOT_FOUND");
    const context =
      (await onboardingSessionContext(
        source,
        { workspaceId, projectId },
        extension.projectContextRef,
      )) ??
      (await new QaProjectPolicyRepository(source).currentProjectContext(
        { workspaceId, projectId },
        extension.projectContextRef.id,
      ));
    if (!context) throw new NotFoundException("QA_PROJECT_CONTEXT_NOT_FOUND");
    const rows = (await source.query(
      "SELECT v.content,w.state,w.classification_key FROM qa_required_session_plans h JOIN qa_required_session_plan_versions v ON v.plan_version_id=h.current_version_id JOIN work_items w ON w.workspace_id=h.workspace_id AND w.project_id=h.project_id AND w.id=h.work_item_id WHERE h.workspace_id=$1 AND h.project_id=$2 AND h.work_item_id=$3",
      [workspaceId, projectId, workItemId],
    )) as readonly { content: unknown; state: string; classification_key: string }[];
    if (!rows[0]) throw new ConflictException("QA_REQUIRED_SESSION_PLAN_NOT_PUBLISHED");
    return {
      extension,
      input,
      context,
      plan: json<QaRequiredSessionPlanRevision>(rows[0].content),
      operationalState: rows[0].state,
      classificationKey: rows[0].classification_key,
    };
  }

  private async mutatePlanItems(
    request: QaSessionRequest,
    workspaceId: string,
    projectId: string,
    workItemId: string,
    sessionId: string,
    expectedResourceVersion: number,
    transform: (
      items: readonly QaPlanItem[],
    ) => readonly Parameters<typeof replacePlannedItems>[0]["items"][number][],
  ) {
    const authorization = await authorizeQaApi(
      this.source,
      request,
      workspaceId,
      projectId,
      "qa.session.plan",
    );
    const at = new Date().toISOString();
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `qa-session:${workspaceId}:${projectId}:${sessionId}`,
      ]);
      const sessions = new TypeOrmManualSessionRepository(manager);
      const previous = await sessions.get({ workspaceId, projectId }, sessionId);
      if (!previous || previous.workItemId !== workItemId)
        throw new NotFoundException("QA_SESSION_NOT_FOUND");
      if (previous.resourceVersion !== expectedResourceVersion)
        throw new ConflictException("QA_SESSION_STALE_VERSION");
      const items = await new TypeOrmManualPlanItemRepository(manager).list(
        { workspaceId, projectId },
        sessionId,
      );
      const drafts = transform(items);
      if (drafts.some((draft) => draft.id.length === 0))
        throw new NotFoundException("QA_PLAN_ITEM_NOT_FOUND");
      const result = replacePlannedItems({
        session: previous,
        expectedResourceVersion,
        actor: authorization.actor,
        at,
        reason: "Plan Item structure changed",
        items: drafts,
      });
      await new ManualExecutionUnitOfWork(manager).replacePlanItems(
        previous,
        result.session,
        result.items,
      );
      const material = await this.material(workspaceId, projectId, workItemId, manager);
      await this.recordTransition(
        manager,
        previous,
        result.session,
        authorization.actor,
        authorization.basis,
        material.classificationKey,
        at,
      );
      return result;
    });
  }

  private async recordTransition(
    manager: EntityManager,
    previous: QaTestSession,
    next: QaTestSession,
    actor: Parameters<typeof qaSessionStateChangedEvent>[0]["context"]["actor"],
    basis: Parameters<typeof qaSessionStateChangedEvent>[0]["context"]["authorizationBasis"],
    classificationKey: string,
    at: string,
    sharedCorrelationId?: string,
    sharedCausationId?: string,
  ): Promise<void> {
    const correlationId = sharedCorrelationId ?? randomUUID();
    const causationId = sharedCausationId ?? randomUUID();
    const context = {
      actor,
      scope: { kind: "PROJECT" as const, workspaceId: next.workspaceId, projectId: next.projectId },
      correlationId,
      causationId,
      ...(basis === undefined ? {} : { authorizationBasis: basis }),
    };
    const event = qaSessionStateChangedEvent({
      context,
      eventId: randomUUID(),
      previousState: previous.state,
      session: next,
      occurredAt: at,
      classificationKey,
    });
    const audit = qaSessionPlanningAudit(previous, next);
    await manager.query(
      "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'READY',$7)",
      [
        randomUUID(),
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
        randomUUID(),
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

  private async recordPlanned(
    manager: EntityManager,
    session: QaTestSession,
    actor: Parameters<typeof qaSessionStateChangedEvent>[0]["context"]["actor"],
    basis: Parameters<typeof qaSessionStateChangedEvent>[0]["context"]["authorizationBasis"],
    classificationKey: string,
    at: string,
  ): Promise<void> {
    const correlationId = randomUUID();
    const causationId = randomUUID();
    const context = {
      actor,
      scope: {
        kind: "PROJECT" as const,
        workspaceId: session.workspaceId,
        projectId: session.projectId,
      },
      correlationId,
      causationId,
      ...(basis === undefined ? {} : { authorizationBasis: basis }),
    };
    const event = qaSessionStateChangedEvent({
      context,
      eventId: randomUUID(),
      previousState: null,
      session,
      occurredAt: at,
      classificationKey,
    });
    const audit = qaSessionPlannedAudit(session);
    await manager.query(
      "INSERT INTO event_outbox(id,workspace_id,project_id,event_type,envelope,envelope_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'READY',$7)",
      [
        randomUUID(),
        session.workspaceId,
        session.projectId,
        event.eventType,
        JSON.stringify(event.payload),
        qaAggregateSnapshotHash(event.payload as never),
        at,
      ],
    );
    await manager.query(
      "INSERT INTO audit_events(id,workspace_id,project_id,occurred_at,actor,action,outcome,reason_code,correlation_id,causation_id,authorization_basis,classification_key,attributes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [
        randomUUID(),
        session.workspaceId,
        session.projectId,
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
}
