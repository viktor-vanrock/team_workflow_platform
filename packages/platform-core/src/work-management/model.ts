import {
  type Clock,
  type IdGenerator,
  requireProjectScope,
  type SchemaBoundValue,
  type SchemaReference,
  type Sha256Digest,
  type WorkspaceContext,
} from "../shared/primitives.ts";

export interface WorkTypeDefinitionPin {
  readonly id: string;
  readonly key: string;
  readonly version: string;
  readonly definitionHash: Sha256Digest;
  readonly intakeSchemaRef: SchemaReference;
}

export interface IntakeDraft<T = unknown> {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly definition: WorkTypeDefinitionPin;
  readonly createdBy: string;
  readonly state: "DRAFT" | "SUBMITTED" | "CANCELLED";
  readonly payload: SchemaBoundValue<T>;
  readonly rowVersion: number;
  readonly createdAt: Date;
  readonly submittedAt?: Date;
}

export interface WorkItem {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly definition: WorkTypeDefinitionPin;
  readonly sourceDraftId: string;
  readonly createdBy: string;
  readonly state: "OPEN" | "CLOSED";
  readonly classificationKey: string;
  readonly rowVersion: number;
  readonly createdAt: Date;
}

export interface WorkspaceWorkTypeState {
  readonly workspaceId: string;
  readonly workTypeKey: string;
  readonly definition: WorkTypeDefinitionPin;
  readonly intakeState: "ENABLED" | "DISABLED";
  readonly rowVersion: number;
  readonly changedBy: string;
  readonly changedAt: Date;
  readonly reason: string;
}

export interface WorkManagementRepository {
  getEnablement(
    workspaceId: string,
    workTypeKey: string,
  ): Promise<WorkspaceWorkTypeState | undefined>;
  saveEnablement(state: WorkspaceWorkTypeState, expectedVersion: number | undefined): Promise<void>;
  insertDraft(draft: IntakeDraft): Promise<void>;
  getDraft(
    workspaceId: string,
    projectId: string,
    draftId: string,
  ): Promise<IntakeDraft | undefined>;
  submitDraft(draft: IntakeDraft, workItem: WorkItem, expectedVersion: number): Promise<void>;
  getWorkItem(
    workspaceId: string,
    projectId: string,
    workItemId: string,
  ): Promise<WorkItem | undefined>;
}

export class WorkManagementService {
  constructor(
    private readonly repository: WorkManagementRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async changeEnablement(
    context: WorkspaceContext,
    definition: WorkTypeDefinitionPin,
    state: "ENABLED" | "DISABLED",
    reason: string,
    expectedVersion?: number,
  ): Promise<WorkspaceWorkTypeState> {
    const current = await this.repository.getEnablement(context.scope.workspaceId, definition.key);
    const expected = expectedVersion ?? current?.rowVersion;
    if (current && expected !== current.rowVersion)
      throw new Error("OPTIMISTIC_CONCURRENCY_CONFLICT");
    const next = Object.freeze({
      workspaceId: context.scope.workspaceId,
      workTypeKey: definition.key,
      definition,
      intakeState: state,
      rowVersion: (current?.rowVersion ?? 0) + 1,
      changedBy: context.actor.principalId,
      changedAt: this.clock.now(),
      reason,
    });
    await this.repository.saveEnablement(next, expected);
    return next;
  }

  async createDraft<T>(
    context: WorkspaceContext,
    workTypeKey: string,
    payload: SchemaBoundValue<T>,
  ): Promise<IntakeDraft<T>> {
    const scope = requireProjectScope(context.scope);
    const enablement = await this.repository.getEnablement(scope.workspaceId, workTypeKey);
    if (!enablement || enablement.intakeState !== "ENABLED")
      throw new Error("WORK_TYPE_INTAKE_DISABLED");
    if (
      payload.schemaRef.digest !== enablement.definition.intakeSchemaRef.digest ||
      payload.schemaRef.id !== enablement.definition.intakeSchemaRef.id
    )
      throw new Error("INTAKE_SCHEMA_PIN_MISMATCH");
    const draft: IntakeDraft<T> = Object.freeze({
      id: this.ids.next(),
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      definition: enablement.definition,
      createdBy: context.actor.principalId,
      state: "DRAFT",
      payload,
      rowVersion: 1,
      createdAt: this.clock.now(),
    });
    await this.repository.insertDraft(draft);
    return draft;
  }

  async submitDraft(
    context: WorkspaceContext,
    draftId: string,
    expectedVersion: number,
    classificationKey = "INTERNAL",
  ): Promise<WorkItem> {
    const scope = requireProjectScope(context.scope);
    const draft = await this.repository.getDraft(scope.workspaceId, scope.projectId, draftId);
    if (!draft || draft.state !== "DRAFT") throw new Error("INTAKE_DRAFT_NOT_SUBMITTABLE");
    if (draft.rowVersion !== expectedVersion) throw new Error("OPTIMISTIC_CONCURRENCY_CONFLICT");
    const workItem: WorkItem = Object.freeze({
      id: this.ids.next(),
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      definition: draft.definition,
      sourceDraftId: draft.id,
      createdBy: context.actor.principalId,
      state: "OPEN",
      classificationKey,
      rowVersion: 1,
      createdAt: this.clock.now(),
    });
    await this.repository.submitDraft(
      {
        ...draft,
        state: "SUBMITTED",
        rowVersion: draft.rowVersion + 1,
        submittedAt: this.clock.now(),
      },
      workItem,
      expectedVersion,
    );
    return workItem;
  }

  getWorkItem(context: WorkspaceContext, id: string): Promise<WorkItem | undefined> {
    const scope = requireProjectScope(context.scope);
    return this.repository.getWorkItem(scope.workspaceId, scope.projectId, id);
  }
}

export class InMemoryWorkManagementRepository implements WorkManagementRepository {
  readonly #enablements = new Map<string, WorkspaceWorkTypeState>();
  readonly #drafts = new Map<string, IntakeDraft>();
  readonly #workItems = new Map<string, WorkItem>();
  #scope(workspaceId: string, key: string): string {
    return `${workspaceId}:${key}`;
  }
  async getEnablement(
    workspaceId: string,
    workTypeKey: string,
  ): Promise<WorkspaceWorkTypeState | undefined> {
    return this.#enablements.get(this.#scope(workspaceId, workTypeKey));
  }
  async saveEnablement(
    state: WorkspaceWorkTypeState,
    expectedVersion: number | undefined,
  ): Promise<void> {
    const key = this.#scope(state.workspaceId, state.workTypeKey);
    const current = this.#enablements.get(key);
    if (current?.rowVersion !== expectedVersion) throw new Error("OPTIMISTIC_CONCURRENCY_CONFLICT");
    this.#enablements.set(key, state);
  }
  async insertDraft(draft: IntakeDraft): Promise<void> {
    this.#drafts.set(this.#scope(draft.workspaceId, `${draft.projectId}:${draft.id}`), draft);
  }
  async getDraft(
    workspaceId: string,
    projectId: string,
    draftId: string,
  ): Promise<IntakeDraft | undefined> {
    return this.#drafts.get(this.#scope(workspaceId, `${projectId}:${draftId}`));
  }
  async submitDraft(
    draft: IntakeDraft,
    workItem: WorkItem,
    expectedVersion: number,
  ): Promise<void> {
    const key = this.#scope(draft.workspaceId, `${draft.projectId}:${draft.id}`);
    const current = this.#drafts.get(key);
    if (!current || current.rowVersion !== expectedVersion)
      throw new Error("OPTIMISTIC_CONCURRENCY_CONFLICT");
    this.#drafts.set(key, draft);
    this.#workItems.set(
      this.#scope(workItem.workspaceId, `${workItem.projectId}:${workItem.id}`),
      workItem,
    );
  }
  async getWorkItem(
    workspaceId: string,
    projectId: string,
    workItemId: string,
  ): Promise<WorkItem | undefined> {
    return this.#workItems.get(this.#scope(workspaceId, `${projectId}:${workItemId}`));
  }
}
