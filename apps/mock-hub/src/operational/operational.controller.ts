import { createHash } from "node:crypto";

import { Body, Controller, Get, HttpException, Inject, Param, Post, Query } from "@nestjs/common";

import type { MockStateRepository } from "../persistence/mock-state.repository.ts";
import { MockScenarioError } from "../scenario-error.ts";
import type {
  MockOperationalDefect,
  MockOperationalDefectEffect,
  MockOperationalDefectResult,
  MockOperationalEffect,
  MockOperationalRepository,
  MockOperationalRequest,
  MockOperationalRequestResult,
  MockOperationalTransitionResult,
} from "./operational.repository.ts";
import { consumeOperationalCreateScenario } from "./operational-scenarios.ts";

export interface OperationalRequestCreateEnvelope {
  readonly effectIdempotencyKey: string;
  readonly correlationId: string;
  readonly scope: Readonly<{ workspaceId: string; projectId: string }>;
  readonly profileRef: Readonly<{ id: string; version: number }>;
  readonly target: Readonly<{
    workspaceId: string;
    projectId: string;
    entityKind: "REQUEST";
    authorityScopeKey: string;
    naturalKey: string;
  }>;
  readonly payload: Readonly<{
    sourceDraftId: string;
    workTypeKey: "qa.validation";
    workTypeVersion: "1.0.0";
    requestKind: "feature-validation" | "smoke" | "regression" | "retest" | "investigation";
    summary: string;
    description?: string;
    acceptanceOutcome?: string;
    sourceRefs?: readonly unknown[];
    requestedNormalizedStatus: "NEW";
    dataClassificationKey: string;
  }>;
}

export interface OperationalRequestTransitionEnvelope {
  readonly effectIdempotencyKey: string;
  readonly correlationId: string;
  readonly scope: Readonly<{ workspaceId: string; projectId: string }>;
  readonly profileRef: Readonly<{ id: string; version: number }>;
  readonly target: Readonly<{
    workspaceId: string;
    projectId: string;
    entityKind: "REQUEST";
    authorityScopeKey: string;
    externalEntityId: string;
  }>;
  readonly payload: Readonly<{
    requestedNormalizedStatus: "READY" | "DONE";
    expectedExternalVersion: string;
    completionSummary?: Readonly<Record<string, unknown>> &
      Readonly<{
        schemaVersion: 1;
        verdict: string;
        summary: string;
        contentHash: `sha256:${string}`;
      }>;
  }>;
}
export interface OperationalDefectCreateEnvelope {
  readonly effectIdempotencyKey: string;
  readonly correlationId: string;
  readonly scope: Readonly<{ workspaceId: string; projectId: string }>;
  readonly profileRef: Readonly<{ id: string; version: number }>;
  readonly target: Readonly<{
    workspaceId: string;
    projectId: string;
    entityKind: "DEFECT";
    authorityScopeKey: string;
    naturalKey: string;
  }>;
  readonly payload: Readonly<{
    sourceWorkItemId: string;
    summary: string;
    description: string;
    dataClassificationKey: string;
    sourceRefs: readonly unknown[];
  }>;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
    .join(",")}}`;
}

function requestHash(request: OperationalRequestCreateEnvelope): string {
  return `sha256:${createHash("sha256")
    .update(
      stableJson({
        scope: request.scope,
        profileRef: request.profileRef,
        target: request.target,
        payload: request.payload,
      }),
    )
    .digest("hex")}`;
}

function assertEnvelope(request: OperationalRequestCreateEnvelope): void {
  if (
    request.effectIdempotencyKey.length === 0 ||
    request.correlationId.length === 0 ||
    request.scope.workspaceId !== request.target.workspaceId ||
    request.scope.projectId !== request.target.projectId ||
    request.target.entityKind !== "REQUEST" ||
    request.target.authorityScopeKey.length === 0 ||
    request.target.naturalKey.length < 8 ||
    request.payload.summary.trim().length === 0 ||
    request.payload.dataClassificationKey.length === 0 ||
    request.payload.requestedNormalizedStatus !== "NEW" ||
    request.profileRef.version < 1
  ) {
    throw new MockScenarioError("SCHEMA_DRIFT", "Invalid operational request envelope", false);
  }
  if (
    request.payload.description !== undefined &&
    request.payload.description.trim().length === 0
  ) {
    throw new MockScenarioError("SCHEMA_DRIFT", "Empty optional description", false);
  }
  if (
    request.payload.acceptanceOutcome !== undefined &&
    request.payload.acceptanceOutcome.trim().length === 0
  ) {
    throw new MockScenarioError("SCHEMA_DRIFT", "Empty optional acceptance outcome", false);
  }
}

export class MockOperationalService {
  constructor(
    private readonly repository: MockOperationalRepository,
    private readonly scenarios: MockStateRepository,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async createRequest(
    request: OperationalRequestCreateEnvelope,
  ): Promise<MockOperationalRequestResult> {
    assertEnvelope(request);
    const hash = requestHash(request);
    await this.scenarios.recordCall({
      effectIdempotencyKey: request.effectIdempotencyKey,
      requestHash: hash,
    });
    const scenario = await consumeOperationalCreateScenario(this.scenarios);
    const observedAt = this.now();
    const created = await this.repository.createRequest({
      effectIdempotencyKey: request.effectIdempotencyKey,
      requestHash: hash,
      observedAt,
      request: {
        workspaceId: request.scope.workspaceId,
        projectId: request.scope.projectId,
        authorityScopeKey: request.target.authorityScopeKey,
        naturalKey: request.target.naturalKey,
        sourceDraftId: request.payload.sourceDraftId,
        requestKind: request.payload.requestKind,
        summary: request.payload.summary,
        ...(request.payload.description === undefined
          ? {}
          : { description: request.payload.description }),
        ...(request.payload.acceptanceOutcome === undefined
          ? {}
          : { acceptanceOutcome: request.payload.acceptanceOutcome }),
        dataClassificationKey: request.payload.dataClassificationKey,
        profileRef: request.profileRef,
      },
    });
    const eventId = `operational:${request.effectIdempotencyKey}`;
    if (scenario === "DUPLICATE_EVENT") {
      await this.scenarios.appendEvents([
        { eventId, scenario, externalRecordId: created.request.externalEntityId },
        { eventId, scenario, externalRecordId: created.request.externalEntityId },
      ]);
    } else if (scenario === "OUT_OF_ORDER_EVENT") {
      await this.scenarios.appendEvents([
        { eventId: `${eventId}:2`, scenario, externalRecordId: created.request.externalEntityId },
        { eventId: `${eventId}:1`, scenario, externalRecordId: created.request.externalEntityId },
      ]);
    }
    return structuredClone(created.effect.result as MockOperationalRequestResult);
  }

  async transitionRequest(
    externalEntityId: string,
    request: OperationalRequestTransitionEnvelope,
  ): Promise<MockOperationalTransitionResult> {
    const done = request.payload.requestedNormalizedStatus === "DONE";
    if (
      request.target.externalEntityId !== externalEntityId ||
      request.target.workspaceId !== request.scope.workspaceId ||
      request.target.projectId !== request.scope.projectId ||
      request.payload.expectedExternalVersion.length === 0 ||
      request.profileRef.version < (done ? 4 : 2) ||
      (done
        ? request.payload.completionSummary === undefined ||
          request.payload.completionSummary.schemaVersion !== 1 ||
          !request.payload.completionSummary.verdict ||
          !request.payload.completionSummary.summary.trim() ||
          !request.payload.completionSummary.contentHash.startsWith("sha256:")
        : request.payload.completionSummary !== undefined)
    )
      throw new MockScenarioError("SCHEMA_DRIFT", "Invalid operational transition envelope", false);
    const hash = requestHash(request as never);
    await this.scenarios.recordCall({
      effectIdempotencyKey: request.effectIdempotencyKey,
      requestHash: hash,
    });
    const scenario = await consumeOperationalCreateScenario(this.scenarios);
    const transitioned = await this.repository.transitionRequest({
      effectIdempotencyKey: request.effectIdempotencyKey,
      requestHash: hash,
      workspaceId: request.scope.workspaceId,
      projectId: request.scope.projectId,
      externalEntityId,
      expectedExternalVersion: request.payload.expectedExternalVersion,
      requestedNormalizedStatus: request.payload.requestedNormalizedStatus,
      ...(request.payload.completionSummary === undefined
        ? {}
        : { completionSummary: request.payload.completionSummary }),
      profileRef: request.profileRef,
      observedAt: this.now(),
    });
    if (done && scenario === "PARTIAL_EFFECT")
      throw new MockScenarioError(
        "TIMEOUT",
        "Completion effect was applied; reconcile by original effect key",
        true,
      );
    return structuredClone(transitioned.effect.result);
  }
  async createDefect(
    request: OperationalDefectCreateEnvelope,
  ): Promise<MockOperationalDefectResult> {
    if (
      !request.effectIdempotencyKey ||
      request.scope.workspaceId !== request.target.workspaceId ||
      request.scope.projectId !== request.target.projectId ||
      request.target.entityKind !== "DEFECT" ||
      request.target.naturalKey.length < 8 ||
      request.profileRef.version < 3 ||
      !request.payload.sourceWorkItemId ||
      !request.payload.summary.trim() ||
      !request.payload.description.trim() ||
      !request.payload.dataClassificationKey ||
      !request.payload.sourceRefs.length
    )
      throw new MockScenarioError("SCHEMA_DRIFT", "Invalid operational defect envelope", false);
    const hash = requestHash(request as never);
    await this.scenarios.recordCall({
      effectIdempotencyKey: request.effectIdempotencyKey,
      requestHash: hash,
    });
    await consumeOperationalCreateScenario(this.scenarios);
    const created = await this.repository.createDefect({
      effectIdempotencyKey: request.effectIdempotencyKey,
      requestHash: hash,
      observedAt: this.now(),
      defect: {
        workspaceId: request.scope.workspaceId,
        projectId: request.scope.projectId,
        authorityScopeKey: request.target.authorityScopeKey,
        naturalKey: request.target.naturalKey,
        sourceWorkItemId: request.payload.sourceWorkItemId,
        summary: request.payload.summary,
        description: request.payload.description,
        dataClassificationKey: request.payload.dataClassificationKey,
        sourceRefs: request.payload.sourceRefs,
        profileRef: request.profileRef,
      },
    });
    return structuredClone(created.effect.result);
  }

  async request(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    externalEntityId: string,
  ): Promise<MockOperationalRequest | undefined> {
    return await this.repository.requestById(scope, externalEntityId);
  }

  async effect(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    effectIdempotencyKey: string,
  ): Promise<MockOperationalEffect | undefined> {
    return await this.repository.effectByKey(scope, effectIdempotencyKey);
  }
  async defect(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    id: string,
  ): Promise<MockOperationalDefect | undefined> {
    return await this.repository.defectById(scope, id);
  }
  async defectEffect(
    scope: Readonly<{ workspaceId: string; projectId: string }>,
    key: string,
  ): Promise<MockOperationalDefectEffect | undefined> {
    return await this.repository.defectEffectByKey(scope, key);
  }
}

function statusFor(error: MockScenarioError): number {
  if (error.code === "CONNECTOR_UNAUTHORIZED") return 401;
  if (error.code === "CONNECTOR_FORBIDDEN") return 403;
  if (error.code === "RATE_LIMITED") return 429;
  if (error.code === "SCHEMA_DRIFT") return 502;
  if (error.code === "TIMEOUT") return 504;
  return 503;
}

@Controller("operational")
export class OperationalController {
  constructor(@Inject(MockOperationalService) private readonly service: MockOperationalService) {}

  @Post("requests")
  async create(
    @Body() request: OperationalRequestCreateEnvelope,
  ): Promise<MockOperationalRequestResult> {
    try {
      return await this.service.createRequest(request);
    } catch (error) {
      if (error instanceof MockScenarioError) {
        throw new HttpException({ code: error.code, retryable: error.retryable }, statusFor(error));
      }
      throw error;
    }
  }

  @Get("requests/:externalEntityId")
  request(
    @Param("externalEntityId") externalEntityId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("projectId") projectId: string,
  ): Promise<MockOperationalRequest | undefined> {
    return this.service.request({ workspaceId, projectId }, externalEntityId);
  }

  @Post("requests/:externalEntityId/transitions")
  async transition(
    @Param("externalEntityId") externalEntityId: string,
    @Body() request: OperationalRequestTransitionEnvelope,
  ): Promise<MockOperationalTransitionResult> {
    try {
      return await this.service.transitionRequest(externalEntityId, request);
    } catch (error) {
      if (error instanceof MockScenarioError)
        throw new HttpException({ code: error.code, retryable: error.retryable }, statusFor(error));
      if (error instanceof Error && error.message === "EXPECTED_STATE_CONFLICT")
        throw new HttpException({ code: error.message, retryable: false }, 409);
      throw error;
    }
  }

  @Get("request-effects/:effectIdempotencyKey")
  effect(
    @Param("effectIdempotencyKey") effectIdempotencyKey: string,
    @Query("workspaceId") workspaceId: string,
    @Query("projectId") projectId: string,
  ): Promise<MockOperationalEffect | undefined> {
    return this.service.effect({ workspaceId, projectId }, effectIdempotencyKey);
  }
  @Post("defects")
  async createDefect(
    @Body() request: OperationalDefectCreateEnvelope,
  ): Promise<MockOperationalDefectResult> {
    try {
      return await this.service.createDefect(request);
    } catch (error) {
      if (error instanceof MockScenarioError)
        throw new HttpException({ code: error.code, retryable: error.retryable }, statusFor(error));
      if (error instanceof Error && error.message === "EFFECT_IDEMPOTENCY_CONFLICT")
        throw new HttpException({ code: error.message, retryable: false }, 409);
      throw error;
    }
  }
  @Get("defects/:externalEntityId")
  defect(
    @Param("externalEntityId") externalEntityId: string,
    @Query("workspaceId") workspaceId: string,
    @Query("projectId") projectId: string,
  ) {
    return this.service.defect({ workspaceId, projectId }, externalEntityId);
  }
  @Get("defect-effects/:effectIdempotencyKey")
  defectEffect(
    @Param("effectIdempotencyKey") effectIdempotencyKey: string,
    @Query("workspaceId") workspaceId: string,
    @Query("projectId") projectId: string,
  ) {
    return this.service.defectEffect({ workspaceId, projectId }, effectIdempotencyKey);
  }
}

export const operationalOpenApiPaths = Object.freeze({
  "/operational/requests": Object.freeze({
    post: Object.freeze({
      operationId: "createOperationalRequest",
      responses: Object.freeze({
        "200": Object.freeze({ description: "Idempotent sparse request-create receipt" }),
      }),
    }),
  }),
  "/operational/requests/{externalEntityId}": Object.freeze({
    get: Object.freeze({
      operationId: "readOperationalRequest",
      responses: Object.freeze({
        "200": Object.freeze({ description: "Scoped external request state" }),
      }),
    }),
  }),
  "/operational/requests/{externalEntityId}/transitions": Object.freeze({
    post: Object.freeze({
      operationId: "transitionOperationalRequest",
      responses: Object.freeze({
        "200": Object.freeze({
          description: "Idempotent expected-version request transition receipt",
        }),
      }),
    }),
  }),
  "/operational/request-effects/{effectIdempotencyKey}": Object.freeze({
    get: Object.freeze({
      operationId: "readOperationalRequestCreateEffect",
      responses: Object.freeze({
        "200": Object.freeze({ description: "Scoped create effect lookup" }),
      }),
    }),
  }),
  "/operational/defects": Object.freeze({
    post: Object.freeze({
      operationId: "createOperationalDefect",
      responses: Object.freeze({
        "200": Object.freeze({ description: "Idempotent defect-create receipt" }),
      }),
    }),
  }),
  "/operational/defects/{externalEntityId}": Object.freeze({
    get: Object.freeze({
      operationId: "readOperationalDefect",
      responses: Object.freeze({
        "200": Object.freeze({ description: "Scoped external defect state" }),
      }),
    }),
  }),
  "/operational/defect-effects/{effectIdempotencyKey}": Object.freeze({
    get: Object.freeze({
      operationId: "readOperationalDefectEffect",
      responses: Object.freeze({
        "200": Object.freeze({ description: "Scoped defect effect lookup" }),
      }),
    }),
  }),
});
