import {
  createOperationalWorkItemMockConnector,
  HttpOperationalMockTransport,
} from "@awp/connector-mock";
import type {
  ConnectorRuntimeContext,
  OperationalDefectCreateInput,
  OperationalDefectCreateResult,
  OperationalRequestCreateInput,
  OperationalRequestCreateResult,
  OperationalRequestTransitionInput,
  OperationalRequestTransitionResult,
  OperationalWorkItemTarget,
} from "@awp/connector-sdk";

import type { RuntimeEnvironment } from "../config/environment.ts";
import { assertEffectEndpointAllowed } from "../security/local-security.ts";

export const qaUs1OperationalRoute = "operational-work-item@1.0.0/request.create" as const;
export const qaUs2OperationalTransitionRoute =
  "operational-work-item@1.0.0/request.transition" as const;
export const qaUs4OperationalDefectRoute = "operational-work-item@1.0.0/defect.create" as const;

export interface QaUs1OperationalBrokerOperation {
  readonly invoke: (
    context: ConnectorRuntimeContext,
    target: OperationalWorkItemTarget,
    input: OperationalRequestCreateInput,
  ) => Promise<OperationalRequestCreateResult>;
  readonly readByEffect: (
    context: ConnectorRuntimeContext,
    target: OperationalWorkItemTarget,
    effectIdempotencyKey: string,
  ) => Promise<OperationalRequestCreateResult | undefined>;
}

export type QaUs1OperationalBrokerMap = Readonly<{
  [qaUs1OperationalRoute]: QaUs1OperationalBrokerOperation;
}>;

export interface QaUs2OperationalTransitionBrokerOperation {
  readonly invoke: (
    context: ConnectorRuntimeContext,
    target: OperationalWorkItemTarget,
    input: OperationalRequestTransitionInput,
  ) => Promise<OperationalRequestTransitionResult>;
  readonly readByEffect: (
    context: ConnectorRuntimeContext,
    target: OperationalWorkItemTarget,
    effectIdempotencyKey: string,
  ) => Promise<OperationalRequestTransitionResult | undefined>;
}

export type QaLocalOperationalBrokerMap = QaUs1OperationalBrokerMap &
  Readonly<{
    [qaUs2OperationalTransitionRoute]: QaUs2OperationalTransitionBrokerOperation;
    [qaUs4OperationalDefectRoute]: Readonly<{
      invoke(
        context: ConnectorRuntimeContext,
        target: OperationalWorkItemTarget,
        input: OperationalDefectCreateInput,
      ): Promise<OperationalDefectCreateResult>;
      readByEffect(
        context: ConnectorRuntimeContext,
        target: OperationalWorkItemTarget,
        effectIdempotencyKey: string,
      ): Promise<OperationalDefectCreateResult | undefined>;
    }>;
  }>;

export function createQaLocalOperationalBrokerMap(
  environment: RuntimeEnvironment,
): QaLocalOperationalBrokerMap {
  if (environment.composition !== "qa-local") {
    throw new Error("QA_OPERATIONAL_BROKER_COMPOSITION_REQUIRED");
  }
  if (environment.profile !== "local" && environment.profile !== "test") {
    throw new Error("QA_OPERATIONAL_BROKER_PROFILE_FORBIDDEN");
  }
  if (environment.externalNetworkMode !== "deny" || !environment.mockHubUrl) {
    throw new Error("QA_OPERATIONAL_BROKER_NETWORK_BARRIER_REQUIRED");
  }
  assertEffectEndpointAllowed(environment.profile, environment.mockHubUrl);
  const connector = createOperationalWorkItemMockConnector(
    new HttpOperationalMockTransport({
      endpoint: environment.mockHubUrl,
      serviceIdentitySecretRef: "secretref://local/mock-hub",
    }),
  );
  return Object.freeze({
    [qaUs1OperationalRoute]: Object.freeze({
      invoke: async (
        context: ConnectorRuntimeContext,
        target: OperationalWorkItemTarget,
        input: OperationalRequestCreateInput,
      ) => await connector.operations.requestCreate.handler.invoke(context, target, input),
      readByEffect: async (
        context: ConnectorRuntimeContext,
        target: OperationalWorkItemTarget,
        effectIdempotencyKey: string,
      ) => await connector.readRequestCreateByEffect(context, target, effectIdempotencyKey),
    }),
    [qaUs2OperationalTransitionRoute]: Object.freeze({
      invoke: async (
        context: ConnectorRuntimeContext,
        target: OperationalWorkItemTarget,
        input: OperationalRequestTransitionInput,
      ) => await connector.operations.requestTransition.handler.invoke(context, target, input),
      readByEffect: async (
        context: ConnectorRuntimeContext,
        target: OperationalWorkItemTarget,
        effectIdempotencyKey: string,
      ) => await connector.readRequestTransitionByEffect(context, target, effectIdempotencyKey),
    }),
    [qaUs4OperationalDefectRoute]: Object.freeze({
      invoke: async (
        context: ConnectorRuntimeContext,
        target: OperationalWorkItemTarget,
        input: OperationalDefectCreateInput,
      ) => await connector.operations.defectCreate.handler.invoke(context, target, input),
      readByEffect: async (
        context: ConnectorRuntimeContext,
        target: OperationalWorkItemTarget,
        effectIdempotencyKey: string,
      ) => await connector.readDefectCreateByEffect(context, target, effectIdempotencyKey),
    }),
  });
}
