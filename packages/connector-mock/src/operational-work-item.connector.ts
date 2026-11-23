import {
  assertOperationalDefectCreate,
  assertOperationalRequestTransition,
  assertOperationalTarget,
  assertSparseRequestCreate,
  type ConnectorRuntimeContext,
  defineConnectorOperation,
  OperationalConnectorError,
  type OperationalDefectCreateInput,
  type OperationalDefectCreateResult,
  type OperationalRequestCreateInput,
  type OperationalRequestCreateResult,
  type OperationalRequestTransitionInput,
  type OperationalRequestTransitionResult,
  type OperationalWorkItemTarget,
} from "@awp/connector-sdk";

import {
  confirmOperationalDefectCreate,
  confirmOperationalRequestCreate,
  confirmOperationalRequestTransition,
  type MockOperationalDefectProviderResult,
  type MockOperationalProviderResult,
  type MockOperationalTransitionProviderResult,
  normalizeOperationalDefectCreateResult,
  normalizeOperationalRequestCreateResult,
  normalizeOperationalRequestTransitionResult,
} from "./operational-work-item-confirmation.ts";

export interface OperationalMockConnection {
  readonly endpoint: string;
  readonly serviceIdentitySecretRef: string;
}

export interface OperationalMockTransport {
  createRequest(
    request: Readonly<{
      effectIdempotencyKey: string;
      correlationId: string;
      scope: Readonly<{ workspaceId: string; projectId: string }>;
      profileRef: Readonly<{ id: string; version: number }>;
      target: OperationalWorkItemTarget & Readonly<{ entityKind: "REQUEST"; naturalKey: string }>;
      payload: OperationalRequestCreateInput;
    }>,
  ): Promise<MockOperationalProviderResult>;
  readRequestEffect(
    request: Readonly<{
      effectIdempotencyKey: string;
      scope: Readonly<{ workspaceId: string; projectId: string }>;
    }>,
  ): Promise<MockOperationalProviderResult | undefined>;
  transitionRequest(
    request: Readonly<{
      effectIdempotencyKey: string;
      correlationId: string;
      scope: Readonly<{ workspaceId: string; projectId: string }>;
      profileRef: Readonly<{ id: string; version: number }>;
      target: OperationalWorkItemTarget &
        Readonly<{ entityKind: "REQUEST"; externalEntityId: string }>;
      payload: OperationalRequestTransitionInput;
    }>,
  ): Promise<MockOperationalTransitionProviderResult>;
  readRequestTransitionEffect(
    request: Readonly<{
      effectIdempotencyKey: string;
      scope: Readonly<{ workspaceId: string; projectId: string }>;
    }>,
  ): Promise<MockOperationalTransitionProviderResult | undefined>;
  createDefect?(
    request: Readonly<{
      effectIdempotencyKey: string;
      correlationId: string;
      scope: Readonly<{ workspaceId: string; projectId: string }>;
      profileRef: Readonly<{ id: string; version: number }>;
      target: OperationalWorkItemTarget & Readonly<{ entityKind: "DEFECT"; naturalKey: string }>;
      payload: OperationalDefectCreateInput;
    }>,
  ): Promise<MockOperationalDefectProviderResult>;
  readDefectEffect?(
    request: Readonly<{
      effectIdempotencyKey: string;
      scope: Readonly<{ workspaceId: string; projectId: string }>;
    }>,
  ): Promise<MockOperationalDefectProviderResult | undefined>;
}

export function assertLocalOperationalMockConnection(connection: OperationalMockConnection): void {
  let url: URL;
  try {
    url = new URL(connection.endpoint);
  } catch {
    throw new OperationalConnectorError("OPERATION_UNAVAILABLE", false, "MOCK_ENDPOINT_INVALID");
  }
  const localHost =
    url.hostname === "mock-hub" ||
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (
    url.protocol !== "http:" ||
    !localHost ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new OperationalConnectorError(
      "OPERATION_UNAVAILABLE",
      false,
      "NON_LOCAL_MOCK_ENDPOINT_FORBIDDEN",
    );
  }
  if (!connection.serviceIdentitySecretRef.startsWith("secretref://local/")) {
    throw new OperationalConnectorError(
      "OPERATION_UNAVAILABLE",
      false,
      "NON_LOCAL_SECRET_REFERENCE_FORBIDDEN",
    );
  }
}

export class HttpOperationalMockTransport implements OperationalMockTransport {
  constructor(private readonly connection: OperationalMockConnection) {
    assertLocalOperationalMockConnection(connection);
  }

  async createRequest(
    request: Parameters<OperationalMockTransport["createRequest"]>[0],
  ): Promise<MockOperationalProviderResult> {
    const response = await fetch(`${this.connection.endpoint}/operational/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw await this.failure(response);
    return (await response.json()) as MockOperationalProviderResult;
  }

  async readRequestEffect(
    request: Parameters<OperationalMockTransport["readRequestEffect"]>[0],
  ): Promise<MockOperationalProviderResult | undefined> {
    const query = new URLSearchParams(request.scope);
    const response = await fetch(
      `${this.connection.endpoint}/operational/request-effects/${encodeURIComponent(request.effectIdempotencyKey)}?${query}`,
    );
    if (response.status === 404 || response.status === 204) return undefined;
    if (!response.ok) throw await this.failure(response);
    const effect = (await response.json()) as
      Readonly<{ result?: MockOperationalProviderResult }> | undefined;
    return effect?.result;
  }

  async transitionRequest(
    request: Parameters<OperationalMockTransport["transitionRequest"]>[0],
  ): Promise<MockOperationalTransitionProviderResult> {
    const response = await fetch(
      `${this.connection.endpoint}/operational/requests/${encodeURIComponent(request.target.externalEntityId!)}/transitions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      },
    );
    if (!response.ok) throw await this.failure(response);
    return (await response.json()) as MockOperationalTransitionProviderResult;
  }

  async readRequestTransitionEffect(
    request: Parameters<OperationalMockTransport["readRequestTransitionEffect"]>[0],
  ): Promise<MockOperationalTransitionProviderResult | undefined> {
    const query = new URLSearchParams(request.scope);
    const response = await fetch(
      `${this.connection.endpoint}/operational/request-effects/${encodeURIComponent(request.effectIdempotencyKey)}?${query}`,
    );
    if (response.status === 404 || response.status === 204) return undefined;
    if (!response.ok) throw await this.failure(response);
    const effect = (await response.json()) as Readonly<{
      result?: MockOperationalTransitionProviderResult;
    }>;
    return effect.result;
  }

  async createDefect(
    request: Parameters<NonNullable<OperationalMockTransport["createDefect"]>>[0],
  ): Promise<MockOperationalDefectProviderResult> {
    const response = await fetch(`${this.connection.endpoint}/operational/defects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw await this.failure(response);
    return (await response.json()) as MockOperationalDefectProviderResult;
  }

  async readDefectEffect(
    request: Parameters<NonNullable<OperationalMockTransport["readDefectEffect"]>>[0],
  ): Promise<MockOperationalDefectProviderResult | undefined> {
    const query = new URLSearchParams(request.scope);
    const response = await fetch(
      `${this.connection.endpoint}/operational/defect-effects/${encodeURIComponent(request.effectIdempotencyKey)}?${query}`,
    );
    if (response.status === 404 || response.status === 204) return undefined;
    if (!response.ok) throw await this.failure(response);
    const effect = (await response.json()) as Readonly<{
      result?: MockOperationalDefectProviderResult;
    }>;
    return effect.result;
  }

  private async failure(response: Response): Promise<OperationalConnectorError> {
    const body = (await response.json().catch(() => ({}))) as Readonly<{
      code?: string;
      retryable?: boolean;
    }>;
    const byStatus =
      response.status === 401
        ? "CONNECTOR_UNAUTHORIZED"
        : response.status === 403
          ? "CONNECTOR_FORBIDDEN"
          : response.status === 429
            ? "RATE_LIMITED"
            : response.status === 502
              ? "SCHEMA_DRIFT"
              : response.status === 504
                ? "TIMEOUT"
                : "SERVER_ERROR";
    return new OperationalConnectorError(
      (body.code ?? byStatus) as ConstructorParameters<typeof OperationalConnectorError>[0],
      body.retryable ?? (response.status === 429 || response.status >= 500),
    );
  }
}

export function createOperationalWorkItemMockConnector(transport: OperationalMockTransport) {
  const requestCreate = defineConnectorOperation<
    OperationalWorkItemTarget,
    OperationalRequestCreateInput,
    OperationalRequestCreateResult
  >({
    capabilityKey: "operational-work-item",
    exactContractVersion: "1.0.0",
    operation: "request.create",
    idempotencyStrategies: ["NATIVE_KEY"],
    confirmationModes: ["SYNC_RECEIPT", "READ_BACK"],
    handler: {
      invoke: async (context, target, input) => {
        assertOperationalTarget(target);
        assertSparseRequestCreate(input);
        if (target.entityKind !== "REQUEST" || !target.naturalKey)
          throw new OperationalConnectorError("SCHEMA_DRIFT", false);
        const raw = await transport.createRequest({
          effectIdempotencyKey: context.effectIdempotencyKey,
          correlationId: context.correlationId,
          scope: context.scope,
          profileRef: context.profileRef,
          target: { ...target, entityKind: "REQUEST", naturalKey: target.naturalKey },
          payload: input,
        });
        return normalizeOperationalRequestCreateResult(
          target,
          context.profileRef,
          context.effectIdempotencyKey,
          raw,
        );
      },
    },
  });
  const requestTransition = defineConnectorOperation<
    OperationalWorkItemTarget,
    OperationalRequestTransitionInput,
    OperationalRequestTransitionResult
  >({
    capabilityKey: "operational-work-item",
    exactContractVersion: "1.0.0",
    operation: "request.transition",
    idempotencyStrategies: ["NATIVE_KEY"],
    confirmationModes: ["SYNC_RECEIPT", "READ_BACK"],
    handler: {
      invoke: async (context, target, input) => {
        assertOperationalTarget(target);
        assertOperationalRequestTransition(input);
        if (target.entityKind !== "REQUEST" || !target.externalEntityId)
          throw new OperationalConnectorError("SCHEMA_DRIFT", false);
        const raw = await transport.transitionRequest({
          effectIdempotencyKey: context.effectIdempotencyKey,
          correlationId: context.correlationId,
          scope: context.scope,
          profileRef: context.profileRef,
          target: { ...target, entityKind: "REQUEST", externalEntityId: target.externalEntityId },
          payload: input,
        });
        return normalizeOperationalRequestTransitionResult(
          target,
          context.profileRef,
          context.effectIdempotencyKey,
          raw,
        );
      },
    },
  });
  const defectCreate = defineConnectorOperation<
    OperationalWorkItemTarget,
    OperationalDefectCreateInput,
    OperationalDefectCreateResult
  >({
    capabilityKey: "operational-work-item",
    exactContractVersion: "1.0.0",
    operation: "defect.create",
    idempotencyStrategies: ["NATIVE_KEY"],
    confirmationModes: ["SYNC_RECEIPT", "READ_BACK"],
    handler: {
      invoke: async (context, target, input) => {
        assertOperationalTarget(target);
        assertOperationalDefectCreate(input);
        if (target.entityKind !== "DEFECT" || !target.naturalKey || !transport.createDefect)
          throw new OperationalConnectorError("OPERATION_UNAVAILABLE", false);
        const raw = await transport.createDefect({
          effectIdempotencyKey: context.effectIdempotencyKey,
          correlationId: context.correlationId,
          scope: context.scope,
          profileRef: context.profileRef,
          target: { ...target, entityKind: "DEFECT", naturalKey: target.naturalKey },
          payload: input,
        });
        return normalizeOperationalDefectCreateResult(
          target,
          context.profileRef,
          context.effectIdempotencyKey,
          raw,
        );
      },
    },
  });
  return Object.freeze({
    key: "operational.mock",
    version: "1.0.0",
    operations: Object.freeze({ requestCreate, requestTransition, defectCreate }),
    readRequestCreateByEffect: async (
      context: ConnectorRuntimeContext,
      target: OperationalWorkItemTarget,
      effectIdempotencyKey: string,
    ) =>
      await confirmOperationalRequestCreate({
        target,
        profileRef: context.profileRef,
        effectIdempotencyKey,
        readByEffect: async (key) =>
          await transport.readRequestEffect({ effectIdempotencyKey: key, scope: context.scope }),
      }),
    readRequestTransitionByEffect: async (
      context: ConnectorRuntimeContext,
      target: OperationalWorkItemTarget,
      effectIdempotencyKey: string,
    ) =>
      await confirmOperationalRequestTransition({
        target,
        profileRef: context.profileRef,
        effectIdempotencyKey,
        readByEffect: async (key) =>
          await transport.readRequestTransitionEffect({
            effectIdempotencyKey: key,
            scope: context.scope,
          }),
      }),
    readDefectCreateByEffect: async (
      context: ConnectorRuntimeContext,
      target: OperationalWorkItemTarget,
      effectIdempotencyKey: string,
    ) => {
      if (!transport.readDefectEffect) return undefined;
      return await confirmOperationalDefectCreate({
        target,
        profileRef: context.profileRef,
        effectIdempotencyKey,
        readByEffect: async (key) =>
          await transport.readDefectEffect!({ effectIdempotencyKey: key, scope: context.scope }),
      });
    },
  });
}
