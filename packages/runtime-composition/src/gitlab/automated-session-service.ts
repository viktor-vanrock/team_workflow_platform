import {
  type AutomatedSessionPersistenceContext,
  planAutomatedSession,
  type PlannedAutomatedSession,
  type QaAutomatedConfigurationPin,
  type QaAutomatedRequiredSession,
  type QaAutomationSuiteVersion,
  type QaAutomationTarget,
  type QaExactReference,
  type QaExternalImmutableRef,
  type QaHumanActor,
  type QaScope,
  type QaScopeSnapshot,
} from "@awp/competency-qa/node";

import type { RuntimeQaAutomationAvailability } from "../qa/automation-availability.ts";

export interface AutomatedSessionSelectionRequest {
  readonly scope: QaScope;
  readonly workItemId: string;
  readonly suiteBindingKey: string;
  readonly targetType: QaAutomationTarget["type"];
  readonly targetRef: string;
  readonly environmentRef: string;
  readonly acceptedParameters: Readonly<Record<string, unknown>>;
}

export interface AuthoritativeAutomatedSessionSelection {
  readonly planRef: QaExactReference;
  readonly requirement: QaAutomatedRequiredSession;
  readonly suite: QaAutomationSuiteVersion;
  readonly configurationPins: readonly QaAutomatedConfigurationPin[];
  readonly existingSessionOrdinals: readonly number[];
  readonly ownerId: string;
  readonly sourceIssueKey: string;
  readonly target: QaAutomationTarget;
  readonly environment: Readonly<{
    environmentRef: string;
    revision: number;
    class: "LOCAL" | "DEVELOPMENT" | "TEST";
  }>;
  readonly parameterValidation: Readonly<{ valid: boolean; schemaRef: QaExactReference }>;
  readonly browser?: "chromium" | "firefox" | "webkit";
  readonly testDataRefs: readonly QaExternalImmutableRef[];
  readonly accountLeaseRefs: readonly QaExternalImmutableRef[];
  readonly scopeSnapshot: QaScopeSnapshot;
}

export interface AutomatedSessionAuthorityProjection {
  resolve(
    request: AutomatedSessionSelectionRequest,
  ): Promise<AuthoritativeAutomatedSessionSelection>;
}

export interface AutomatedSessionWriter {
  persist(
    planned: PlannedAutomatedSession,
    context: AutomatedSessionPersistenceContext,
  ): Promise<PlannedAutomatedSession>;
}

export interface AutomatedSessionLineageProjection {
  current(
    scope: QaScope,
    sessionId: string,
  ): Promise<
    | Readonly<{
        id: string;
        workspaceId: string;
        projectId: string;
        workItemId: string;
        startedAt?: string;
        targetSnapshotHash: `sha256:${string}`;
      }>
    | undefined
  >;
  recordPreStartRevision(
    input: Readonly<{
      scope: QaScope;
      sessionId: string;
      previousTargetSnapshotHash: `sha256:${string}`;
      selection: AuthoritativeAutomatedSessionSelection;
      actor: QaHumanActor;
      at: string;
      context: AutomatedSessionPersistenceContext;
    }>,
  ): Promise<Readonly<{ kind: "PRE_START_REVISION"; targetSnapshotHash: `sha256:${string}` }>>;
}

export type AutomatedTargetChangeResult =
  | Readonly<{ kind: "PRE_START_REVISION"; targetSnapshotHash: `sha256:${string}` }>
  | Readonly<{ kind: "LINKED_SESSION"; planned: PlannedAutomatedSession }>;

export class GitLabAutomatedSessionService {
  constructor(
    private readonly availability: RuntimeQaAutomationAvailability,
    private readonly authority: AutomatedSessionAuthorityProjection,
    private readonly writer: AutomatedSessionWriter,
    private readonly lineage: AutomatedSessionLineageProjection,
  ) {}

  async create(
    input: Readonly<{
      sessionId: string;
      request: AutomatedSessionSelectionRequest;
      actor: QaHumanActor;
      createdAt: string;
      context: AutomatedSessionPersistenceContext;
    }>,
  ): Promise<PlannedAutomatedSession> {
    await this.#assertFullQa(input.request.scope);
    const selection = await this.#selection(input.request);
    return await this.writer.persist(
      planAutomatedSession({
        sessionId: input.sessionId,
        ...selection,
        acceptedParameters: input.request.acceptedParameters,
        actor: input.actor,
        createdAt: input.createdAt,
      }),
      input.context,
    );
  }

  async changeTarget(
    input: Readonly<{
      originalSessionId: string;
      replacementSessionId: string;
      request: AutomatedSessionSelectionRequest;
      actor: QaHumanActor;
      changedAt: string;
      context: AutomatedSessionPersistenceContext;
    }>,
  ): Promise<AutomatedTargetChangeResult> {
    await this.#assertFullQa(input.request.scope);
    const original = await this.lineage.current(input.request.scope, input.originalSessionId);
    if (
      !original ||
      original.workspaceId !== input.request.scope.workspaceId ||
      original.projectId !== input.request.scope.projectId ||
      original.workItemId !== input.request.workItemId
    )
      throw new Error("QA_AUTOMATED_SESSION_LINEAGE_SCOPE_MISMATCH");
    const selection = await this.#selection(input.request);
    if (original.startedAt === undefined) {
      return await this.lineage.recordPreStartRevision({
        scope: input.request.scope,
        sessionId: original.id,
        previousTargetSnapshotHash: original.targetSnapshotHash,
        selection,
        actor: input.actor,
        at: input.changedAt,
        context: input.context,
      });
    }
    const planned = planAutomatedSession({
      sessionId: input.replacementSessionId,
      ...selection,
      acceptedParameters: input.request.acceptedParameters,
      parentSession: Object.freeze({
        id: original.id,
        targetSnapshotHash: original.targetSnapshotHash,
      }),
      replacementReason: "TARGET_CHANGED",
      actor: input.actor,
      createdAt: input.changedAt,
    });
    return Object.freeze({
      kind: "LINKED_SESSION",
      planned: await this.writer.persist(planned, input.context),
    });
  }

  async #assertFullQa(scope: QaScope): Promise<void> {
    const current = await this.availability.current(scope);
    if (current.capabilityMode !== "FULL_QA")
      throw new Error(`QA_AUTOMATION_MANUAL_ONLY:${current.configurationReasonCodes.join(",")}`);
  }

  async #selection(
    request: AutomatedSessionSelectionRequest,
  ): Promise<AuthoritativeAutomatedSessionSelection> {
    const selected = await this.authority.resolve(Object.freeze(structuredClone(request)));
    if (
      selected.requirement.workspaceId !== request.scope.workspaceId ||
      selected.requirement.projectId !== request.scope.projectId ||
      selected.requirement.workItemId !== request.workItemId ||
      selected.suite.suiteKey !== request.suiteBindingKey ||
      selected.target.type !== request.targetType ||
      selected.environment.environmentRef !== request.environmentRef
    ) {
      throw new Error("QA_AUTOMATED_SESSION_AUTHORITY_PROJECTION_MISMATCH");
    }
    return selected;
  }
}
