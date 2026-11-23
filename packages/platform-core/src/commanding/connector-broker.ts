import type { WriteStageAuditor } from "../audit/write-stage-auditor.ts";
import type { PilotEffectContext } from "../pilot/model.ts";
import type {
  ActorReference,
  AuthorizationBasisRef,
  ClassificationReference,
  VersionedReference,
} from "../shared/primitives.ts";
import { executeProjectEffect, type ProjectEffectGuardPort } from "./project-effect-guard.ts";

export interface ConnectorEffectCommand {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actor: ActorReference;
  readonly commandType: string;
  readonly capability: Readonly<{
    key: string;
    exactContractVersion: string;
    operation: string;
    logicalRole: string;
  }>;
  readonly target: unknown;
  readonly payload: unknown;
  readonly bindingRef: VersionedReference;
  readonly profileRef: VersionedReference;
  readonly effectIdempotencyKey: string;
  readonly dataClassificationKey: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly initialAuthorizationBasis: AuthorizationBasisRef;
  readonly effectAuthorizationBasis?: AuthorizationBasisRef;
  /** Exact onboarding head observed when this new effect was authorized. */
  readonly expectedOnboardingVersion?: number;
  readonly pilotContext?: PilotEffectContext;
}

export interface ResolvedConnectorChain {
  readonly bindingRef: VersionedReference;
  readonly profileRef: VersionedReference;
  readonly connectionRef: VersionedReference;
  readonly mappingRef: VersionedReference;
  readonly connectorRef: Readonly<{ key: string; version: string }>;
  readonly classification: ClassificationReference;
  readonly retired: boolean;
}

export interface ConnectorChainResolver {
  resolve(
    command: ConnectorEffectCommand,
    options?: Readonly<{ allowRetired?: boolean }>,
  ): Promise<ResolvedConnectorChain>;
}

export interface ConnectorEffectContext {
  readonly scope: Readonly<{
    kind: "PROJECT";
    workspaceId: string;
    projectId: string;
  }>;
  readonly actor: ActorReference;
  readonly correlationId: string;
  readonly causationId: string;
  readonly effectIdempotencyKey: string;
  readonly profileRef: VersionedReference;
  readonly classification: ClassificationReference;
  readonly signal: AbortSignal;
}

export interface TypedBrokerOperation<TTarget, TInput, TResult> {
  readonly connectorKey: string;
  readonly connectorVersion: string;
  readonly capabilityKey: string;
  readonly capabilityVersion: string;
  readonly operation: string;
  readonly handler: Readonly<{
    invoke(context: ConnectorEffectContext, target: TTarget, input: TInput): Promise<TResult>;
  }>;
  lookup?(effectIdempotencyKey: string): Promise<TResult | undefined>;
}

interface RegisteredBrokerOperation {
  readonly connectorKey: string;
  readonly connectorVersion: string;
  readonly capabilityKey: string;
  readonly capabilityVersion: string;
  readonly operation: string;
  invoke(context: ConnectorEffectContext, target: unknown, payload: unknown): Promise<unknown>;
  lookup?(effectIdempotencyKey: string): Promise<unknown>;
}

export class ConnectorBroker {
  readonly #operations = new Map<string, RegisteredBrokerOperation>();

  constructor(
    private readonly chains: ConnectorChainResolver,
    private readonly audit?: WriteStageAuditor,
    private readonly effectGuard?: ProjectEffectGuardPort,
  ) {}

  register<TTarget, TInput, TResult>(
    operation: TypedBrokerOperation<TTarget, TInput, TResult>,
  ): void {
    const key = this.#key(
      operation.connectorKey,
      operation.connectorVersion,
      operation.capabilityKey,
      operation.capabilityVersion,
      operation.operation,
    );
    if (this.#operations.has(key)) {
      throw new Error("CONNECTOR_OPERATION_COLLISION");
    }
    this.#operations.set(key, {
      connectorKey: operation.connectorKey,
      connectorVersion: operation.connectorVersion,
      capabilityKey: operation.capabilityKey,
      capabilityVersion: operation.capabilityVersion,
      operation: operation.operation,
      invoke: async (context, target, payload) =>
        await operation.handler.invoke(context, target as TTarget, payload as TInput),
      ...(operation.lookup
        ? {
            lookup: async (effectIdempotencyKey: string) =>
              await operation.lookup!(effectIdempotencyKey),
          }
        : {}),
    });
  }

  async invoke(
    command: ConnectorEffectCommand,
    options: Readonly<{
      allowRetired?: boolean;
      signal?: AbortSignal;
    }> = {},
  ): Promise<unknown> {
    if (command.pilotContext && command.pilotContext.principalId !== command.actor.principalId)
      throw new Error("PILOT_ACTOR_CONFLICT");
    const chain = await this.chains.resolve(
      command,
      options.allowRetired === undefined ? undefined : { allowRetired: options.allowRetired },
    );
    if (
      chain.bindingRef.id !== command.bindingRef.id ||
      chain.bindingRef.version !== command.bindingRef.version ||
      chain.profileRef.id !== command.profileRef.id ||
      chain.profileRef.version !== command.profileRef.version
    ) {
      throw new Error("PINNED_CONFIGURATION_MISMATCH");
    }
    if (chain.classification.key !== command.dataClassificationKey) {
      throw new Error("PINNED_CLASSIFICATION_MISMATCH");
    }
    if (chain.retired && !options.allowRetired) {
      throw new Error("RETIRED_CONFIGURATION_NEW_EFFECT_FORBIDDEN");
    }
    const operation = this.operationFor(command, chain);
    if (!operation) {
      throw new Error("TYPED_CONNECTOR_OPERATION_NOT_FOUND");
    }
    const invoke = async () =>
      await operation.invoke(
        {
          scope: {
            kind: "PROJECT",
            workspaceId: command.workspaceId,
            projectId: command.projectId,
          },
          actor: command.actor,
          correlationId: command.correlationId,
          causationId: command.causationId,
          effectIdempotencyKey: command.effectIdempotencyKey,
          profileRef: command.profileRef,
          classification: chain.classification,
          signal: options.signal ?? new AbortController().signal,
        },
        command.target,
        command.payload,
      );
    const result = this.effectGuard
      ? await executeProjectEffect(
          this.effectGuard,
          { workspaceId: command.workspaceId, projectId: command.projectId },
          command.expectedOnboardingVersion,
          invoke,
          command.pilotContext,
        )
      : await invoke();
    await this.audit?.record({
      stage: "BROKER",
      workspaceId: command.workspaceId,
      projectId: command.projectId,
      action: command.commandType,
      initialAuthorizationBasis: command.initialAuthorizationBasis,
      effectAuthorizationBasis: command.effectAuthorizationBasis,
      bindingRef: command.bindingRef,
      profileRef: command.profileRef,
      resultCode: "INVOKED",
      reasonCode: "CONNECTOR_ACCEPTED",
      attributes: {
        commandId: command.id,
        connectionRef: chain.connectionRef,
        mappingRef: chain.mappingRef,
      },
    });
    return result;
  }

  operationFor(
    command: ConnectorEffectCommand,
    chain: ResolvedConnectorChain,
  ): RegisteredBrokerOperation | undefined {
    return this.#operations.get(
      this.#key(
        chain.connectorRef.key,
        chain.connectorRef.version,
        command.capability.key,
        command.capability.exactContractVersion,
        command.capability.operation,
      ),
    );
  }

  #key(...parts: string[]): string {
    return parts.join("\0");
  }
}
