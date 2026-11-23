import type { DataSource, EntityManager } from "typeorm";

import type {
  ExternalCommandLifecycleContribution,
  ExternalCommandLifecyclePhase,
  ExternalCommandLifecycleTransaction,
  ExternalCommandLifecycleUnitOfWork,
  PackLifecycleDelta,
  PackOwnedTransaction,
  ScopedExternalCommandContext,
} from "@awp/platform-core";

export interface TypeOrmExternalCommandLifecycleOptions {
  readonly applyDelta?: (
    manager: EntityManager,
    phase: ExternalCommandLifecyclePhase,
    input: ScopedExternalCommandContext,
    contribution: ExternalCommandLifecycleContribution,
    delta: PackLifecycleDelta,
  ) => Promise<void>;
}

export class TypeOrmExternalCommandLifecycleUnitOfWork implements ExternalCommandLifecycleUnitOfWork {
  readonly #contributions: readonly ExternalCommandLifecycleContribution[];

  constructor(
    private readonly source: DataSource,
    contributions: readonly ExternalCommandLifecycleContribution[],
    private readonly options: TypeOrmExternalCommandLifecycleOptions = {},
  ) {
    const keys = new Set<string>();
    for (const contribution of contributions) {
      if (keys.has(contribution.key))
        throw new Error(`EXTERNAL_COMMAND_LIFECYCLE_COLLISION:${contribution.key}`);
      keys.add(contribution.key);
    }
    this.#contributions = Object.freeze(
      [...contributions].sort(
        (left, right) =>
          (left.order ?? 0) - (right.order ?? 0) || left.key.localeCompare(right.key),
      ),
    );
  }

  async execute<T>(
    phase: ExternalCommandLifecyclePhase,
    input: ScopedExternalCommandContext,
    coreTransition: (transaction: PackOwnedTransaction) => Promise<T>,
  ): Promise<Readonly<{ result: T; deltas: readonly PackLifecycleDelta[] }>> {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const matching = this.#contributions.filter((contribution) => contribution.matches(input));
      const lockKeys = [
        `workspace:${input.workspaceId}`,
        `project:${input.workspaceId}:${input.projectId}`,
        `command:${input.workspaceId}:${input.projectId}:${input.commandId}`,
        ...matching.map(({ key }) => `contribution:${key}`),
      ].sort();
      for (const lockKey of lockKeys)
        await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [lockKey]);

      const phaseLedger = new Set<string>();
      const deltas: PackLifecycleDelta[] = [];
      for (const contribution of matching) {
        const idempotencyKey = `${input.commandId}:${phase}:${contribution.key}`;
        if (phaseLedger.has(idempotencyKey))
          throw new Error(`EXTERNAL_COMMAND_LIFECYCLE_DUPLICATE_PHASE:${idempotencyKey}`);
        phaseLedger.add(idempotencyKey);
        const transaction: ExternalCommandLifecycleTransaction = {
          transactionId: `typeorm:lifecycle:${input.commandId}:${phase}`,
          native: manager,
          contributionKey: contribution.key,
          idempotencyKey,
          phase,
        };
        const delta = await contribution.apply(phase, input, transaction);
        if (delta.idempotencyKey !== idempotencyKey)
          throw new Error(`EXTERNAL_COMMAND_LIFECYCLE_IDEMPOTENCY_MISMATCH:${contribution.key}`);
        await this.options.applyDelta?.(manager, phase, input, contribution, delta);
        deltas.push(Object.freeze(delta));
      }

      // APPROVAL_RELEASED contributions finish before the Core HELD -> READY transition below.
      const result = await coreTransition({
        transactionId: `typeorm:lifecycle:${input.commandId}:${phase}`,
        native: manager,
        contributionKey: "core.external-command-lifecycle",
        idempotencyKey: `${input.commandId}:${phase}:core`,
      });
      return Object.freeze({ result, deltas: Object.freeze(deltas) });
    });
  }
}
