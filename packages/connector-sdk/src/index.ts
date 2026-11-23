import type { ConnectorRuntimeContext } from "./runtime-context.ts";

export type IdempotencyStrategy = "NATIVE_KEY" | "NATURAL_KEY_LOOKUP" | "RECONCILIATION";
export type ConfirmationMode = "SYNC_RECEIPT" | "READ_BACK" | "WEBHOOK";

export type { ConnectorRuntimeContext } from "./runtime-context.ts";

export interface TypedConnectorOperation<TTarget, TInput, TResult> {
  invoke(context: ConnectorRuntimeContext, target: TTarget, input: TInput): Promise<TResult>;
}

export interface ConnectorOperationDeclaration<TTarget, TInput, TResult> {
  readonly capabilityKey: string;
  readonly exactContractVersion: string;
  readonly operation: string;
  readonly idempotencyStrategies: readonly IdempotencyStrategy[];
  readonly confirmationModes: readonly ConfirmationMode[];
  readonly handler: TypedConnectorOperation<TTarget, TInput, TResult>;
}

export interface TypedConnector<
  TDeclarations extends Record<string, ConnectorOperationDeclaration<unknown, unknown, unknown>>,
> {
  readonly key: string;
  readonly version: string;
  readonly operations: TDeclarations;
}

export function defineConnectorOperation<TTarget, TInput, TResult>(
  declaration: ConnectorOperationDeclaration<TTarget, TInput, TResult>,
): ConnectorOperationDeclaration<TTarget, TInput, TResult> {
  return Object.freeze(declaration);
}

export * from "./ci-artifacts.ts";
export * from "./connector-ingress.ts";
export * from "./messaging.ts";
export * from "./operational-provider-ports.ts";
export * from "./operational-work-item.ts";
export * from "./presentation-materializer.ts";
export * from "./source-context.ts";
export * from "./test-executor.ts";
