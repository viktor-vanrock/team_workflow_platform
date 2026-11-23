import type { PlatformAction, PlatformActionPort } from "./platform-action-port.ts";

const guardedQueueActionKinds = new Set([
  "QUEUE_CONTROL_ACCEPT",
  "QUEUE_ORDER_OVERRIDE",
  "SERVICE_CLASS_EXPEDITE",
  "EXPEDITE_CAPACITY_OVERRIDE",
  "WIP_ADMISSION_OVERRIDE",
]);

export interface PlatformActionExecutionContext {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly approvalId: string;
  readonly approverId: string;
  readonly authorizationBasisHash: string;
}

export interface PlatformActionHandler<TCandidate = unknown, TResult = unknown> {
  readonly key: string;
  readonly order?: number;
  matches(action: PlatformAction<TCandidate, TResult>): boolean;
  execute(
    action: PlatformAction<TCandidate, TResult>,
    context: PlatformActionExecutionContext,
  ): Promise<TResult>;
}

export interface PlatformActionExecutionGuard<TCandidate = unknown, TResult = unknown> {
  readonly key: string;
  matches(action: PlatformAction<TCandidate, TResult>): boolean;
  verify(
    action: PlatformAction<TCandidate, TResult>,
    context: PlatformActionExecutionContext,
  ): Promise<void>;
}

export class PlatformActionExecutionGuardRegistry {
  readonly #guards: readonly PlatformActionExecutionGuard[];

  constructor(guards: readonly PlatformActionExecutionGuard[] = []) {
    const ordered = [...guards].sort((left, right) => left.key.localeCompare(right.key));
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index - 1]?.key === ordered[index]?.key)
        throw new Error(`PLATFORM_ACTION_GUARD_COLLISION:${ordered[index]?.key}`);
    }
    this.#guards = Object.freeze(ordered);
  }

  async verify(action: PlatformAction, context: PlatformActionExecutionContext): Promise<void> {
    const matches = this.#guards.filter((guard) => guard.matches(action));
    if (guardedQueueActionKinds.has(action.kind) && matches.length === 0) {
      throw new Error(`PLATFORM_ACTION_GUARD_NOT_FOUND:${action.kind}`);
    }
    if (matches.length > 1) throw new Error(`PLATFORM_ACTION_GUARD_AMBIGUOUS:${action.kind}`);
    if (matches[0]) await matches[0].verify(action, context);
  }
}

export class PlatformActionHandlerRegistry {
  readonly #handlers: readonly PlatformActionHandler[];

  constructor(handlers: readonly PlatformActionHandler[]) {
    const keys = new Set<string>();
    for (const handler of handlers) {
      if (keys.has(handler.key))
        throw new Error(`PLATFORM_ACTION_HANDLER_COLLISION:${handler.key}`);
      keys.add(handler.key);
    }
    this.#handlers = Object.freeze(
      [...handlers].sort(
        (left, right) =>
          (left.order ?? 0) - (right.order ?? 0) || left.key.localeCompare(right.key),
      ),
    );
  }

  handlerFor(action: PlatformAction): PlatformActionHandler {
    const matches = this.#handlers.filter((handler) => handler.matches(action));
    if (matches.length === 0) throw new Error(`PLATFORM_ACTION_HANDLER_NOT_FOUND:${action.kind}`);
    if (matches.length > 1) throw new Error(`PLATFORM_ACTION_HANDLER_AMBIGUOUS:${action.kind}`);
    return matches[0]!;
  }
}

export class PlatformActionExecutor<TCandidate = unknown, TResult = unknown> {
  constructor(
    private readonly actions: PlatformActionPort<TCandidate, TResult>,
    private readonly handlers: PlatformActionHandlerRegistry,
    private readonly guards: PlatformActionExecutionGuardRegistry = new PlatformActionExecutionGuardRegistry(),
  ) {}

  async execute(
    actionId: string,
    expectedVersion: number,
    context: PlatformActionExecutionContext,
  ): Promise<PlatformAction<TCandidate, TResult>> {
    const action = await this.actions.get(actionId);
    if (!action) throw new Error("PLATFORM_ACTION_NOT_FOUND");
    if (action.state === "COMPLETED") return action;
    if (action.state !== "PENDING_APPROVAL") throw new Error("PLATFORM_ACTION_NOT_EXECUTABLE");
    if (action.rowVersion !== expectedVersion) throw new Error("PLATFORM_ACTION_CAS_CONFLICT");
    await this.guards.verify(action, context);
    const claimed = await this.actions.claim(action.id, expectedVersion);
    const handler = this.handlers.handlerFor(claimed);
    try {
      const result = (await handler.execute(claimed, context)) as TResult;
      return await this.actions.complete(claimed.id, claimed.rowVersion, result);
    } catch (error) {
      await this.actions.fail(claimed.id, claimed.rowVersion).catch(() => undefined);
      throw error;
    }
  }
}
