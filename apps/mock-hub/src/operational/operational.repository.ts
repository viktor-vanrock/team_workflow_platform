import type { DataSource, EntityManager } from "typeorm";

export interface MockOperationalRequestInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly authorityScopeKey: string;
  readonly naturalKey: string;
  readonly sourceDraftId: string;
  readonly requestKind: string;
  readonly summary: string;
  readonly description?: string;
  readonly acceptanceOutcome?: string;
  readonly dataClassificationKey: string;
  readonly profileRef: Readonly<{ id: string; version: number }>;
}

export interface MockOperationalRequest {
  readonly externalEntityId: string;
  readonly externalDisplayKey: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly authorityScopeKey: string;
  readonly naturalKey: string;
  readonly sourceDraftId: string;
  readonly requestKind: string;
  readonly summary: string;
  readonly description?: string;
  readonly acceptanceOutcome?: string;
  readonly dataClassificationKey: string;
  readonly externalVersion: string;
  readonly rawExternalState: "MOCK_NEW" | "MOCK_READY" | "MOCK_DONE";
  readonly normalizedStatus: "NEW" | "READY" | "DONE";
  readonly completionSummary?: Readonly<Record<string, unknown>> | undefined;
  readonly completionSummaryDigest?: string | undefined;
  readonly completionSummaryReceipt?: Readonly<{ id: string; contentHash: string }> | undefined;
  readonly profileRef: Readonly<{ id: string; version: number }>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MockOperationalRequestResult {
  readonly operation: "request.create";
  readonly entityKind: "REQUEST";
  readonly externalEntityId: string;
  readonly externalDisplayKey: string;
  readonly externalVersion: string;
  readonly rawExternalState: "MOCK_NEW";
  readonly normalizedStatus: "NEW";
  readonly naturalKey: string;
  readonly effectId: string;
  readonly observedAt: string;
  readonly scope: Readonly<{ workspaceId: string; projectId: string }>;
  readonly profileRef: Readonly<{ id: string; version: number }>;
}

export interface MockOperationalTransitionResult {
  readonly operation: "request.transition";
  readonly entityKind: "REQUEST";
  readonly externalEntityId: string;
  readonly externalDisplayKey: string;
  readonly externalVersion: string;
  readonly rawExternalState: "MOCK_READY" | "MOCK_DONE";
  readonly normalizedStatus: "READY" | "DONE";
  readonly naturalKey: string;
  readonly effectId: string;
  readonly observedAt: string;
  readonly scope: Readonly<{ workspaceId: string; projectId: string }>;
  readonly profileRef: Readonly<{ id: string; version: number }>;
  readonly completionSummaryReceipt?: Readonly<{ id: string; contentHash: `sha256:${string}` }>;
}

export interface MockOperationalDefectInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly authorityScopeKey: string;
  readonly naturalKey: string;
  readonly sourceWorkItemId: string;
  readonly summary: string;
  readonly description: string;
  readonly dataClassificationKey: string;
  readonly sourceRefs: readonly unknown[];
  readonly profileRef: Readonly<{ id: string; version: number }>;
}
export interface MockOperationalDefect {
  readonly externalEntityId: string;
  readonly externalDisplayKey: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly authorityScopeKey: string;
  readonly naturalKey: string;
  readonly sourceWorkItemId: string;
  readonly summary: string;
  readonly description: string;
  readonly dataClassificationKey: string;
  readonly sourceRefs: readonly unknown[];
  readonly externalVersion: "1";
  readonly rawExternalState: "MOCK_NEW";
  readonly normalizedStatus: "NEW";
  readonly profileRef: Readonly<{ id: string; version: number }>;
  readonly createdAt: string;
}
export interface MockOperationalDefectResult {
  readonly operation: "defect.create";
  readonly entityKind: "DEFECT";
  readonly externalEntityId: string;
  readonly externalDisplayKey: string;
  readonly externalVersion: string;
  readonly rawExternalState: "MOCK_NEW";
  readonly normalizedStatus: "NEW";
  readonly naturalKey: string;
  readonly effectId: string;
  readonly observedAt: string;
  readonly scope: Readonly<{ workspaceId: string; projectId: string }>;
  readonly profileRef: Readonly<{ id: string; version: number }>;
}
export interface MockOperationalDefectEffect {
  readonly effectIdempotencyKey: string;
  readonly requestHash: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly profileRef: Readonly<{ id: string; version: number }>;
  readonly externalEntityId: string;
  readonly result: MockOperationalDefectResult;
  readonly effectCount: 1;
  readonly recordedAt: string;
}

export interface MockOperationalEffect {
  readonly effectIdempotencyKey: string;
  readonly requestHash: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly profileRef: Readonly<{ id: string; version: number }>;
  readonly externalEntityId: string;
  readonly result: MockOperationalRequestResult | MockOperationalTransitionResult;
  readonly effectCount: 1;
  readonly recordedAt: string;
}

export interface MockOperationalRepository {
  createRequest(
    input: Readonly<{
      effectIdempotencyKey: string;
      requestHash: string;
      request: MockOperationalRequestInput;
      observedAt: string;
    }>,
  ): Promise<Readonly<{ request: MockOperationalRequest; effect: MockOperationalEffect }>>;
  transitionRequest(
    input: Readonly<{
      effectIdempotencyKey: string;
      requestHash: string;
      workspaceId: string;
      projectId: string;
      externalEntityId: string;
      expectedExternalVersion: string;
      requestedNormalizedStatus: "READY" | "DONE";
      completionSummary?: Readonly<Record<string, unknown>> &
        Readonly<{ contentHash: `sha256:${string}` }>;
      profileRef: Readonly<{ id: string; version: number }>;
      observedAt: string;
    }>,
  ): Promise<
    Readonly<{
      request: MockOperationalRequest;
      effect: MockOperationalEffect & Readonly<{ result: MockOperationalTransitionResult }>;
    }>
  >;
  requestById(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    externalEntityId: string,
  ): Promise<MockOperationalRequest | undefined>;
  effectByKey(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    effectIdempotencyKey: string,
  ): Promise<MockOperationalEffect | undefined>;
  effectCount(): Promise<number>;
  createDefect(
    input: Readonly<{
      effectIdempotencyKey: string;
      requestHash: string;
      defect: MockOperationalDefectInput;
      observedAt: string;
    }>,
  ): Promise<Readonly<{ defect: MockOperationalDefect; effect: MockOperationalDefectEffect }>>;
  defectById(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    externalEntityId: string,
  ): Promise<MockOperationalDefect | undefined>;
  defectEffectByKey(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    effectIdempotencyKey: string,
  ): Promise<MockOperationalDefectEffect | undefined>;
  defectEffectCount(): Promise<number>;
}

function externalId(naturalKey: string): string {
  return `REQ-${naturalKey}`;
}

function makeRequest(
  input: MockOperationalRequestInput,
  observedAt: string,
): MockOperationalRequest {
  const id = externalId(input.naturalKey);
  return Object.freeze({
    externalEntityId: id,
    externalDisplayKey: id,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    authorityScopeKey: input.authorityScopeKey,
    naturalKey: input.naturalKey,
    sourceDraftId: input.sourceDraftId,
    requestKind: input.requestKind,
    summary: input.summary,
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.acceptanceOutcome === undefined
      ? {}
      : { acceptanceOutcome: input.acceptanceOutcome }),
    dataClassificationKey: input.dataClassificationKey,
    externalVersion: "1",
    rawExternalState: "MOCK_NEW",
    normalizedStatus: "NEW",
    profileRef: structuredClone(input.profileRef),
    createdAt: observedAt,
    updatedAt: observedAt,
  });
}

function makeEffect(
  effectIdempotencyKey: string,
  requestHash: string,
  request: MockOperationalRequest,
  observedAt: string,
): MockOperationalEffect {
  return Object.freeze({
    effectIdempotencyKey,
    requestHash,
    workspaceId: request.workspaceId,
    projectId: request.projectId,
    profileRef: request.profileRef,
    externalEntityId: request.externalEntityId,
    result: Object.freeze({
      operation: "request.create",
      entityKind: "REQUEST",
      externalEntityId: request.externalEntityId,
      externalDisplayKey: request.externalDisplayKey,
      externalVersion: request.externalVersion,
      rawExternalState: "MOCK_NEW",
      normalizedStatus: "NEW",
      naturalKey: request.naturalKey,
      effectId: effectIdempotencyKey,
      observedAt,
      scope: Object.freeze({ workspaceId: request.workspaceId, projectId: request.projectId }),
      profileRef: request.profileRef,
    }),
    effectCount: 1,
    recordedAt: observedAt,
  });
}

export class InMemoryMockOperationalRepository implements MockOperationalRepository {
  readonly #requests = new Map<string, MockOperationalRequest>();
  readonly #effects = new Map<string, MockOperationalEffect>();
  readonly #defects = new Map<string, MockOperationalDefect>();
  readonly #defectEffects = new Map<string, MockOperationalDefectEffect>();

  async createRequest(
    input: Readonly<{
      effectIdempotencyKey: string;
      requestHash: string;
      request: MockOperationalRequestInput;
      observedAt: string;
    }>,
  ) {
    const existing = this.#effects.get(input.effectIdempotencyKey);
    if (existing) {
      if (existing.requestHash !== input.requestHash)
        throw new Error("EFFECT_IDEMPOTENCY_CONFLICT");
      return Object.freeze({
        request: this.#requests.get(existing.externalEntityId)!,
        effect: existing,
      });
    }
    const request = makeRequest(input.request, input.observedAt);
    const scopedNaturalKey = `${request.workspaceId}\0${request.projectId}\0${request.naturalKey}`;
    if (
      [...this.#requests.values()].some(
        (value) =>
          `${value.workspaceId}\0${value.projectId}\0${value.naturalKey}` === scopedNaturalKey,
      )
    ) {
      throw new Error("OPERATIONAL_NATURAL_KEY_CONFLICT");
    }
    const effect = makeEffect(
      input.effectIdempotencyKey,
      input.requestHash,
      request,
      input.observedAt,
    );
    this.#requests.set(request.externalEntityId, request);
    this.#effects.set(input.effectIdempotencyKey, effect);
    return structuredClone({ request, effect });
  }

  async transitionRequest(
    input: Readonly<{
      effectIdempotencyKey: string;
      requestHash: string;
      workspaceId: string;
      projectId: string;
      externalEntityId: string;
      expectedExternalVersion: string;
      requestedNormalizedStatus: "READY" | "DONE";
      completionSummary?: Readonly<Record<string, unknown>> &
        Readonly<{ contentHash: `sha256:${string}` }>;
      profileRef: Readonly<{ id: string; version: number }>;
      observedAt: string;
    }>,
  ) {
    const existing = this.#effects.get(input.effectIdempotencyKey);
    if (existing) {
      if (
        existing.requestHash !== input.requestHash ||
        existing.result.operation !== "request.transition"
      )
        throw new Error("EFFECT_IDEMPOTENCY_CONFLICT");
      return structuredClone({
        request: this.#requests.get(existing.externalEntityId)!,
        effect: existing as MockOperationalEffect & { result: MockOperationalTransitionResult },
      });
    }
    const current = this.#requests.get(input.externalEntityId);
    if (
      !current ||
      current.workspaceId !== input.workspaceId ||
      current.projectId !== input.projectId
    )
      throw new Error("OPERATIONAL_REQUEST_NOT_FOUND");
    if (current.externalVersion !== input.expectedExternalVersion)
      throw new Error("EXPECTED_STATE_CONFLICT");
    if (
      input.requestedNormalizedStatus === "DONE" &&
      (current.normalizedStatus !== "READY" || input.completionSummary === undefined)
    )
      throw new Error("EXPECTED_STATE_CONFLICT");
    const receipt =
      input.requestedNormalizedStatus === "DONE"
        ? Object.freeze({
            id: `comment:${input.effectIdempotencyKey}`,
            contentHash: input.completionSummary!.contentHash,
          })
        : undefined;
    const request = Object.freeze({
      ...current,
      externalVersion: String(Number(current.externalVersion) + 1),
      rawExternalState:
        input.requestedNormalizedStatus === "DONE"
          ? ("MOCK_DONE" as const)
          : ("MOCK_READY" as const),
      normalizedStatus: input.requestedNormalizedStatus,
      profileRef: structuredClone(input.profileRef),
      updatedAt: input.observedAt,
      ...(input.completionSummary === undefined
        ? {}
        : {
            completionSummary: structuredClone(input.completionSummary),
            completionSummaryDigest: input.completionSummary.contentHash,
            completionSummaryReceipt: receipt,
          }),
    });
    const result: MockOperationalTransitionResult = Object.freeze({
      operation: "request.transition",
      entityKind: "REQUEST",
      externalEntityId: request.externalEntityId,
      externalDisplayKey: request.externalDisplayKey,
      externalVersion: request.externalVersion,
      rawExternalState: request.rawExternalState,
      normalizedStatus: request.normalizedStatus,
      naturalKey: request.naturalKey,
      effectId: input.effectIdempotencyKey,
      observedAt: input.observedAt,
      scope: { workspaceId: request.workspaceId, projectId: request.projectId },
      profileRef: request.profileRef,
      ...(receipt === undefined ? {} : { completionSummaryReceipt: receipt }),
    });
    const effect = Object.freeze({
      effectIdempotencyKey: input.effectIdempotencyKey,
      requestHash: input.requestHash,
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      profileRef: request.profileRef,
      externalEntityId: request.externalEntityId,
      result,
      effectCount: 1 as const,
      recordedAt: input.observedAt,
    });
    this.#requests.set(request.externalEntityId, request);
    this.#effects.set(input.effectIdempotencyKey, effect);
    return structuredClone({ request, effect });
  }

  async requestById(scope: Readonly<{ workspaceId: string; projectId: string }>, id: string) {
    const request = this.#requests.get(id);
    return request?.workspaceId === scope.workspaceId && request.projectId === scope.projectId
      ? structuredClone(request)
      : undefined;
  }

  async effectByKey(scope: Readonly<{ workspaceId: string; projectId: string }>, key: string) {
    const effect = this.#effects.get(key);
    return effect?.workspaceId === scope.workspaceId && effect.projectId === scope.projectId
      ? structuredClone(effect)
      : undefined;
  }

  async effectCount(): Promise<number> {
    return this.#effects.size;
  }
  async createDefect(
    input: Readonly<{
      effectIdempotencyKey: string;
      requestHash: string;
      defect: MockOperationalDefectInput;
      observedAt: string;
    }>,
  ) {
    const existing = this.#defectEffects.get(input.effectIdempotencyKey);
    if (existing) {
      if (existing.requestHash !== input.requestHash)
        throw new Error("EFFECT_IDEMPOTENCY_CONFLICT");
      return structuredClone({
        defect: this.#defects.get(existing.externalEntityId)!,
        effect: existing,
      });
    }
    const id = `DEF-${input.defect.naturalKey}`;
    const defect: MockOperationalDefect = Object.freeze({
      externalEntityId: id,
      externalDisplayKey: id,
      ...structuredClone(input.defect),
      externalVersion: "1",
      rawExternalState: "MOCK_NEW",
      normalizedStatus: "NEW",
      createdAt: input.observedAt,
    });
    if (
      [...this.#defects.values()].some(
        (value) =>
          value.workspaceId === defect.workspaceId &&
          value.projectId === defect.projectId &&
          value.naturalKey === defect.naturalKey,
      )
    )
      throw new Error("OPERATIONAL_NATURAL_KEY_CONFLICT");
    const result: MockOperationalDefectResult = Object.freeze({
      operation: "defect.create",
      entityKind: "DEFECT",
      externalEntityId: id,
      externalDisplayKey: id,
      externalVersion: "1",
      rawExternalState: "MOCK_NEW",
      normalizedStatus: "NEW",
      naturalKey: defect.naturalKey,
      effectId: input.effectIdempotencyKey,
      observedAt: input.observedAt,
      scope: { workspaceId: defect.workspaceId, projectId: defect.projectId },
      profileRef: defect.profileRef,
    });
    const effect: MockOperationalDefectEffect = Object.freeze({
      effectIdempotencyKey: input.effectIdempotencyKey,
      requestHash: input.requestHash,
      workspaceId: defect.workspaceId,
      projectId: defect.projectId,
      profileRef: defect.profileRef,
      externalEntityId: id,
      result,
      effectCount: 1,
      recordedAt: input.observedAt,
    });
    this.#defects.set(id, defect);
    this.#defectEffects.set(input.effectIdempotencyKey, effect);
    return structuredClone({ defect, effect });
  }
  async defectById(scope: Readonly<{ workspaceId: string; projectId: string }>, id: string) {
    const defect = this.#defects.get(id);
    return defect?.workspaceId === scope.workspaceId && defect.projectId === scope.projectId
      ? structuredClone(defect)
      : undefined;
  }
  async defectEffectByKey(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    key: string,
  ) {
    const effect = this.#defectEffects.get(key);
    return effect?.workspaceId === scope.workspaceId && effect.projectId === scope.projectId
      ? structuredClone(effect)
      : undefined;
  }
  async defectEffectCount(): Promise<number> {
    return this.#defectEffects.size;
  }
}

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] =>
  Array.isArray(value) && Array.isArray(value[0]) ? (value[0] as Row[]) : (value as Row[]);
const json = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);

function requestFromRow(row: Row): MockOperationalRequest {
  return {
    externalEntityId: String(row.external_entity_id),
    externalDisplayKey: String(row.external_entity_id),
    workspaceId: String(row.workspace_id),
    projectId: String(row.project_id),
    authorityScopeKey: String(row.authority_scope_key),
    naturalKey: String(row.natural_key),
    sourceDraftId: String(row.source_draft_id),
    requestKind: String(row.request_kind),
    summary: String(row.summary),
    ...(row.description === null ? {} : { description: String(row.description) }),
    ...(row.acceptance_outcome === null
      ? {}
      : { acceptanceOutcome: String(row.acceptance_outcome) }),
    dataClassificationKey: String(row.data_classification_key),
    externalVersion: String(row.external_version),
    rawExternalState: String(row.raw_external_state) as MockOperationalRequest["rawExternalState"],
    normalizedStatus: String(row.normalized_status) as MockOperationalRequest["normalizedStatus"],
    profileRef: { id: String(row.profile_id), version: Number(row.profile_version) },
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    ...(row.completion_summary === null || row.completion_summary === undefined
      ? {}
      : { completionSummary: json<Readonly<Record<string, unknown>>>(row.completion_summary) }),
    ...(row.completion_summary_digest === null || row.completion_summary_digest === undefined
      ? {}
      : { completionSummaryDigest: String(row.completion_summary_digest) }),
    ...(row.completion_summary_receipt === null || row.completion_summary_receipt === undefined
      ? {}
      : {
          completionSummaryReceipt: json<Readonly<{ id: string; contentHash: string }>>(
            row.completion_summary_receipt,
          ),
        }),
  };
}

function effectFromRow(row: Row): MockOperationalEffect {
  return {
    effectIdempotencyKey: String(row.effect_idempotency_key),
    requestHash: String(row.request_hash),
    workspaceId: String(row.workspace_id),
    projectId: String(row.project_id),
    profileRef: { id: String(row.profile_id), version: Number(row.profile_version) },
    externalEntityId: String(row.external_entity_id),
    result: json<MockOperationalRequestResult | MockOperationalTransitionResult>(row.result),
    effectCount: 1,
    recordedAt: new Date(String(row.recorded_at)).toISOString(),
  };
}

function defectFromRow(row: Row): MockOperationalDefect {
  return {
    externalEntityId: String(row.external_entity_id),
    externalDisplayKey: String(row.external_entity_id),
    workspaceId: String(row.workspace_id),
    projectId: String(row.project_id),
    authorityScopeKey: String(row.authority_scope_key),
    naturalKey: String(row.natural_key),
    sourceWorkItemId: String(row.source_work_item_id),
    summary: String(row.summary),
    description: String(row.description),
    dataClassificationKey: String(row.data_classification_key),
    sourceRefs: json<readonly unknown[]>(row.source_refs),
    externalVersion: "1",
    rawExternalState: "MOCK_NEW",
    normalizedStatus: "NEW",
    profileRef: { id: String(row.profile_id), version: Number(row.profile_version) },
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}
function defectEffectFromRow(row: Row): MockOperationalDefectEffect {
  return {
    effectIdempotencyKey: String(row.effect_idempotency_key),
    requestHash: String(row.request_hash),
    workspaceId: String(row.workspace_id),
    projectId: String(row.project_id),
    profileRef: { id: String(row.profile_id), version: Number(row.profile_version) },
    externalEntityId: String(row.external_entity_id),
    result: json<MockOperationalDefectResult>(row.result),
    effectCount: 1,
    recordedAt: new Date(String(row.recorded_at)).toISOString(),
  };
}

export class TypeOrmMockOperationalRepository implements MockOperationalRepository {
  constructor(private readonly source: DataSource) {}

  async createRequest(
    input: Readonly<{
      effectIdempotencyKey: string;
      requestHash: string;
      request: MockOperationalRequestInput;
      observedAt: string;
    }>,
  ) {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const found = await this.effectByKeyWith(manager, input.effectIdempotencyKey);
      if (found) {
        if (found.requestHash !== input.requestHash) throw new Error("EFFECT_IDEMPOTENCY_CONFLICT");
        const request = await this.requestByIdWith(manager, found.externalEntityId);
        if (
          !request ||
          request.workspaceId !== input.request.workspaceId ||
          request.projectId !== input.request.projectId
        )
          throw new Error("OPERATIONAL_EFFECT_SCOPE_MISMATCH");
        return Object.freeze({ request, effect: found });
      }
      const request = makeRequest(input.request, input.observedAt);
      await manager.query(
        `INSERT INTO operational_requests(external_entity_id,workspace_id,project_id,authority_scope_key,natural_key,source_draft_id,request_kind,summary,description,acceptance_outcome,data_classification_key,external_version,raw_external_state,normalized_status,profile_id,profile_version,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,'MOCK_NEW','NEW',$12,$13,$14,$14)`,
        [
          request.externalEntityId,
          request.workspaceId,
          request.projectId,
          request.authorityScopeKey,
          request.naturalKey,
          request.sourceDraftId,
          request.requestKind,
          request.summary,
          request.description ?? null,
          request.acceptanceOutcome ?? null,
          request.dataClassificationKey,
          request.profileRef.id,
          request.profileRef.version,
          input.observedAt,
        ],
      );
      const effect = makeEffect(
        input.effectIdempotencyKey,
        input.requestHash,
        request,
        input.observedAt,
      );
      await manager.query(
        `INSERT INTO operational_request_effects(effect_idempotency_key,request_hash,workspace_id,project_id,profile_id,profile_version,external_entity_id,result,effect_count,recorded_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9)`,
        [
          effect.effectIdempotencyKey,
          effect.requestHash,
          effect.workspaceId,
          effect.projectId,
          effect.profileRef.id,
          effect.profileRef.version,
          effect.externalEntityId,
          JSON.stringify(effect.result),
          effect.recordedAt,
        ],
      );
      return Object.freeze({ request, effect });
    });
  }

  async transitionRequest(
    input: Readonly<{
      effectIdempotencyKey: string;
      requestHash: string;
      workspaceId: string;
      projectId: string;
      externalEntityId: string;
      expectedExternalVersion: string;
      requestedNormalizedStatus: "READY" | "DONE";
      completionSummary?: Readonly<Record<string, unknown>> &
        Readonly<{ contentHash: `sha256:${string}` }>;
      profileRef: Readonly<{ id: string; version: number }>;
      observedAt: string;
    }>,
  ) {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const found = await this.effectByKeyWith(manager, input.effectIdempotencyKey);
      if (found) {
        if (
          found.requestHash !== input.requestHash ||
          found.result.operation !== "request.transition"
        )
          throw new Error("EFFECT_IDEMPOTENCY_CONFLICT");
        const request = await this.requestByIdWith(manager, found.externalEntityId);
        if (!request) throw new Error("OPERATIONAL_REQUEST_NOT_FOUND");
        return Object.freeze({
          request,
          effect: found as MockOperationalEffect & { result: MockOperationalTransitionResult },
        });
      }
      const current = await this.requestByIdWith(manager, input.externalEntityId);
      if (
        !current ||
        current.workspaceId !== input.workspaceId ||
        current.projectId !== input.projectId
      )
        throw new Error("OPERATIONAL_REQUEST_NOT_FOUND");
      if (current.externalVersion !== input.expectedExternalVersion)
        throw new Error("EXPECTED_STATE_CONFLICT");
      if (
        input.requestedNormalizedStatus === "DONE" &&
        (current.normalizedStatus !== "READY" || input.completionSummary === undefined)
      )
        throw new Error("EXPECTED_STATE_CONFLICT");
      const receipt =
        input.requestedNormalizedStatus === "DONE"
          ? Object.freeze({
              id: `comment:${input.effectIdempotencyKey}`,
              contentHash: input.completionSummary!.contentHash,
            })
          : undefined;
      const request = Object.freeze({
        ...current,
        externalVersion: String(Number(current.externalVersion) + 1),
        rawExternalState:
          input.requestedNormalizedStatus === "DONE"
            ? ("MOCK_DONE" as const)
            : ("MOCK_READY" as const),
        normalizedStatus: input.requestedNormalizedStatus,
        profileRef: structuredClone(input.profileRef),
        updatedAt: input.observedAt,
        ...(input.completionSummary === undefined
          ? {}
          : {
              completionSummary: structuredClone(input.completionSummary),
              completionSummaryDigest: input.completionSummary.contentHash,
              completionSummaryReceipt: receipt,
            }),
      });
      await manager.query(
        "UPDATE operational_requests SET external_version=$1,raw_external_state=$2,normalized_status=$3,profile_id=$4,profile_version=$5,updated_at=$6,completion_summary=$7,completion_summary_digest=$8,completion_summary_receipt=$9 WHERE external_entity_id=$10",
        [
          request.externalVersion,
          request.rawExternalState,
          request.normalizedStatus,
          input.profileRef.id,
          input.profileRef.version,
          input.observedAt,
          input.completionSummary ? JSON.stringify(input.completionSummary) : null,
          input.completionSummary?.contentHash ?? null,
          receipt ? JSON.stringify(receipt) : null,
          input.externalEntityId,
        ],
      );
      const result: MockOperationalTransitionResult = Object.freeze({
        operation: "request.transition",
        entityKind: "REQUEST",
        externalEntityId: request.externalEntityId,
        externalDisplayKey: request.externalDisplayKey,
        externalVersion: request.externalVersion,
        rawExternalState: request.rawExternalState,
        normalizedStatus: request.normalizedStatus,
        naturalKey: request.naturalKey,
        effectId: input.effectIdempotencyKey,
        observedAt: input.observedAt,
        scope: { workspaceId: request.workspaceId, projectId: request.projectId },
        profileRef: request.profileRef,
        ...(receipt === undefined ? {} : { completionSummaryReceipt: receipt }),
      });
      const effect = Object.freeze({
        effectIdempotencyKey: input.effectIdempotencyKey,
        requestHash: input.requestHash,
        workspaceId: request.workspaceId,
        projectId: request.projectId,
        profileRef: request.profileRef,
        externalEntityId: request.externalEntityId,
        result,
        effectCount: 1 as const,
        recordedAt: input.observedAt,
      });
      await manager.query(
        `INSERT INTO operational_request_effects(effect_idempotency_key,request_hash,workspace_id,project_id,profile_id,profile_version,external_entity_id,result,effect_count,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9)`,
        [
          effect.effectIdempotencyKey,
          effect.requestHash,
          effect.workspaceId,
          effect.projectId,
          effect.profileRef.id,
          effect.profileRef.version,
          effect.externalEntityId,
          JSON.stringify(effect.result),
          effect.recordedAt,
        ],
      );
      if (input.completionSummary !== undefined && receipt !== undefined) {
        await manager.query(
          `INSERT INTO operational_completion_effects(effect_idempotency_key,request_hash,workspace_id,project_id,external_entity_id,summary,summary_digest,comment_receipt,expected_external_version,confirmed_external_version,partial_effect_ledger,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'[]'::jsonb,$11)`,
          [
            input.effectIdempotencyKey,
            input.requestHash,
            input.workspaceId,
            input.projectId,
            input.externalEntityId,
            JSON.stringify(input.completionSummary),
            input.completionSummary.contentHash,
            JSON.stringify(receipt),
            input.expectedExternalVersion,
            request.externalVersion,
            input.observedAt,
          ],
        );
      }
      return Object.freeze({ request, effect });
    });
  }

  async requestById(scope: Readonly<{ workspaceId: string; projectId: string }>, id: string) {
    const request = await this.requestByIdWith(this.source.manager, id);
    return request?.workspaceId === scope.workspaceId && request.projectId === scope.projectId
      ? request
      : undefined;
  }

  async effectByKey(scope: Readonly<{ workspaceId: string; projectId: string }>, key: string) {
    const effect = await this.effectByKeyWith(this.source.manager, key);
    return effect?.workspaceId === scope.workspaceId && effect.projectId === scope.projectId
      ? effect
      : undefined;
  }

  async effectCount(): Promise<number> {
    const result = (await this.source.query(
      "SELECT count(*) AS count FROM operational_request_effects",
    )) as readonly Row[];
    return Number(result[0]?.count ?? 0);
  }

  async createDefect(
    input: Readonly<{
      effectIdempotencyKey: string;
      requestHash: string;
      defect: MockOperationalDefectInput;
      observedAt: string;
    }>,
  ) {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const found = await this.defectEffectByKeyWith(manager, input.effectIdempotencyKey);
      if (found) {
        if (found.requestHash !== input.requestHash) throw new Error("EFFECT_IDEMPOTENCY_CONFLICT");
        const defect = await this.defectByIdWith(manager, found.externalEntityId);
        if (!defect) throw new Error("OPERATIONAL_DEFECT_NOT_FOUND");
        return Object.freeze({ defect, effect: found });
      }
      const id = `DEF-${input.defect.naturalKey}`;
      const defect: MockOperationalDefect = Object.freeze({
        externalEntityId: id,
        externalDisplayKey: id,
        ...structuredClone(input.defect),
        externalVersion: "1",
        rawExternalState: "MOCK_NEW",
        normalizedStatus: "NEW",
        createdAt: input.observedAt,
      });
      await manager.query(
        "INSERT INTO operational_defects(external_entity_id,workspace_id,project_id,authority_scope_key,natural_key,source_work_item_id,summary,description,data_classification_key,source_refs,external_version,raw_external_state,normalized_status,profile_id,profile_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,'MOCK_NEW','NEW',$11,$12,$13)",
        [
          id,
          defect.workspaceId,
          defect.projectId,
          defect.authorityScopeKey,
          defect.naturalKey,
          defect.sourceWorkItemId,
          defect.summary,
          defect.description,
          defect.dataClassificationKey,
          JSON.stringify(defect.sourceRefs),
          defect.profileRef.id,
          defect.profileRef.version,
          input.observedAt,
        ],
      );
      const result: MockOperationalDefectResult = Object.freeze({
        operation: "defect.create",
        entityKind: "DEFECT",
        externalEntityId: id,
        externalDisplayKey: id,
        externalVersion: "1",
        rawExternalState: "MOCK_NEW",
        normalizedStatus: "NEW",
        naturalKey: defect.naturalKey,
        effectId: input.effectIdempotencyKey,
        observedAt: input.observedAt,
        scope: { workspaceId: defect.workspaceId, projectId: defect.projectId },
        profileRef: defect.profileRef,
      });
      const effect: MockOperationalDefectEffect = Object.freeze({
        effectIdempotencyKey: input.effectIdempotencyKey,
        requestHash: input.requestHash,
        workspaceId: defect.workspaceId,
        projectId: defect.projectId,
        profileRef: defect.profileRef,
        externalEntityId: id,
        result,
        effectCount: 1,
        recordedAt: input.observedAt,
      });
      await manager.query(
        "INSERT INTO operational_defect_effects(effect_idempotency_key,request_hash,workspace_id,project_id,profile_id,profile_version,external_entity_id,result,effect_count,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9)",
        [
          effect.effectIdempotencyKey,
          effect.requestHash,
          effect.workspaceId,
          effect.projectId,
          effect.profileRef.id,
          effect.profileRef.version,
          effect.externalEntityId,
          JSON.stringify(effect.result),
          effect.recordedAt,
        ],
      );
      return Object.freeze({ defect, effect });
    });
  }
  async defectById(scope: Readonly<{ workspaceId: string; projectId: string }>, id: string) {
    const defect = await this.defectByIdWith(this.source.manager, id);
    return defect?.workspaceId === scope.workspaceId && defect.projectId === scope.projectId
      ? defect
      : undefined;
  }
  async defectEffectByKey(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    key: string,
  ) {
    const effect = await this.defectEffectByKeyWith(this.source.manager, key);
    return effect?.workspaceId === scope.workspaceId && effect.projectId === scope.projectId
      ? effect
      : undefined;
  }
  async defectEffectCount(): Promise<number> {
    const result = (await this.source.query(
      "SELECT count(*) AS count FROM operational_defect_effects",
    )) as readonly Row[];
    return Number(result[0]?.count ?? 0);
  }

  private async requestByIdWith(manager: Pick<EntityManager, "query">, id: string) {
    const found = rows(
      await manager.query("SELECT * FROM operational_requests WHERE external_entity_id=$1", [id]),
    );
    return found[0] ? requestFromRow(found[0]) : undefined;
  }

  private async effectByKeyWith(manager: Pick<EntityManager, "query">, key: string) {
    const found = rows(
      await manager.query(
        "SELECT * FROM operational_request_effects WHERE effect_idempotency_key=$1",
        [key],
      ),
    );
    return found[0] ? effectFromRow(found[0]) : undefined;
  }
  private async defectByIdWith(manager: Pick<EntityManager, "query">, id: string) {
    const found = rows(
      await manager.query("SELECT * FROM operational_defects WHERE external_entity_id=$1", [id]),
    );
    return found[0] ? defectFromRow(found[0]) : undefined;
  }
  private async defectEffectByKeyWith(manager: Pick<EntityManager, "query">, key: string) {
    const found = rows(
      await manager.query(
        "SELECT * FROM operational_defect_effects WHERE effect_idempotency_key=$1",
        [key],
      ),
    );
    return found[0] ? defectEffectFromRow(found[0]) : undefined;
  }
}
