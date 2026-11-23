import type {
  ExternalCommandLifecycleUnitOfWork,
  PackOwnedTransaction,
  ScopedExternalCommandContext,
} from "@awp/platform-contracts";

export interface EffectGateLifecycle {
  readonly unitOfWork: ExternalCommandLifecycleUnitOfWork;
  readonly context: ScopedExternalCommandContext;
  readonly onInvocationStarted?: (transaction: PackOwnedTransaction) => Promise<void>;
  readonly onTerminalFailure?: (
    transaction: PackOwnedTransaction,
    reasonCode: string,
  ) => Promise<void>;
}

export interface EffectGateInput<T = unknown> {
  readonly approvalMode: "NOT_REQUIRED" | "REQUIRED";
  readonly pinnedConfigurationHash: string;
  readonly liveConfigurationHash: string;
  readonly policyAllowed?: boolean;
  readonly authorizationBasis?: unknown;
  readonly lifecycle?: EffectGateLifecycle;
  readonly invoke: () => Promise<T>;
}

export interface EffectGateResult<T> {
  readonly status: "ALLOWED" | "FAILED";
  readonly reasonCode: string;
  readonly result?: T;
  readonly authorizationBasis?: unknown;
}

function failure<T>(input: EffectGateInput<T>, reasonCode: string): EffectGateResult<T> {
  return Object.freeze({
    status: "FAILED",
    reasonCode,
    ...(input.authorizationBasis === undefined
      ? {}
      : { authorizationBasis: input.authorizationBasis }),
  });
}

async function terminalFailure<T>(
  input: EffectGateInput<T>,
  reasonCode: string,
): Promise<EffectGateResult<T>> {
  if (!input.lifecycle) return failure(input, reasonCode);
  const completed = await input.lifecycle.unitOfWork.execute(
    "TERMINAL_FAILED",
    input.lifecycle.context,
    async (transaction) => {
      await input.lifecycle?.onTerminalFailure?.(transaction, reasonCode);
      return failure(input, reasonCode);
    },
  );
  return completed.result;
}

export async function evaluateEffectGate<T>(
  input: EffectGateInput<T>,
): Promise<EffectGateResult<T>> {
  if (input.pinnedConfigurationHash !== input.liveConfigurationHash)
    return await terminalFailure(input, "CONFIGURATION_DRIFT");
  if (input.policyAllowed === false) return await terminalFailure(input, "POLICY_DENIED");
  try {
    const result = input.lifecycle
      ? (
          await input.lifecycle.unitOfWork.execute(
            "EFFECT_INVOCATION_STARTED",
            input.lifecycle.context,
            async (transaction) => {
              await input.lifecycle?.onInvocationStarted?.(transaction);
              return await input.invoke();
            },
          )
        ).result
      : await input.invoke();
    return Object.freeze({
      status: "ALLOWED",
      reasonCode: "AUTHORIZED",
      result,
      ...(input.authorizationBasis === undefined
        ? {}
        : { authorizationBasis: input.authorizationBasis }),
    });
  } catch (error) {
    await terminalFailure(input, "CONNECTOR_INVOCATION_FAILED");
    throw error;
  }
}
