import type { DataSource, EntityManager } from "typeorm";

import type {
  ConfirmationTransaction,
  ConfirmationUnitOfWork,
  ConfirmedOperationalEffect,
  CoreMutationRefs,
  OperationalConfirmationHook,
  OperationalConfirmationUnitOfWork,
  PackConfirmationDelta,
  PackOwnedTransaction,
} from "@awp/platform-core";

export interface TypeOrmOperationalConfirmationOptions {
  readonly mutateCore?: (
    manager: EntityManager,
    input: ConfirmedOperationalEffect,
  ) => Promise<CoreMutationRefs>;
  readonly applyDelta?: (
    manager: EntityManager,
    input: ConfirmedOperationalEffect,
    hook: OperationalConfirmationHook,
    delta: PackConfirmationDelta,
  ) => Promise<void>;
}

export function assertOperationalCreateConfirmationRefs(
  input: ConfirmedOperationalEffect,
  refs: CoreMutationRefs,
): void {
  if (input.capabilityVersion !== "1.1.0" || input.operation !== "request.create") return;
  if (
    !refs.sourceDraftId ||
    !refs.workItemId ||
    !refs.operationalBindingId ||
    !refs.resultRefs?.projectionRevisionId
  ) {
    throw new Error("OPERATIONAL_CREATE_CONFIRMATION_REFS_INCOMPLETE");
  }
}

export class TypeOrmConfirmationUnitOfWork
  implements ConfirmationUnitOfWork, OperationalConfirmationUnitOfWork
{
  constructor(
    private readonly source: DataSource,
    private readonly options: TypeOrmOperationalConfirmationOptions = {},
  ) {}

  async confirm<T>(work: (transaction: ConfirmationTransaction) => Promise<T>): Promise<T> {
    return await this.source.transaction(
      async (manager) =>
        await work({
          transactionId: `typeorm:legacy:${Date.now()}`,
          native: manager,
        }),
    );
  }

  async confirmEffect(
    input: ConfirmedOperationalEffect,
    hooks: readonly OperationalConfirmationHook[],
  ): Promise<readonly PackConfirmationDelta[]> {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const refs = (await this.options.mutateCore?.(manager, input)) ?? {
        ...(input.source.intakeDraftId ? { sourceDraftId: input.source.intakeDraftId } : {}),
        ...(input.source.sourceWorkItemId ? { workItemId: input.source.sourceWorkItemId } : {}),
      };
      assertOperationalCreateConfirmationRefs(input, refs);
      const ordered = [...hooks].sort(
        (left, right) =>
          (left.order ?? 0) - (right.order ?? 0) || left.key.localeCompare(right.key),
      );
      const deltas: PackConfirmationDelta[] = [];
      for (const hook of ordered) {
        const idempotencyKey = `${input.commandId}:confirmation:${hook.key}`;
        const transaction: PackOwnedTransaction = {
          transactionId: `typeorm:confirmation:${input.commandId}`,
          native: manager,
          contributionKey: hook.key,
          idempotencyKey,
        };
        const delta = await hook.apply({ ...input, ...refs }, transaction);
        if (delta.idempotencyKey !== idempotencyKey)
          throw new Error(`CONFIRMATION_DELTA_IDEMPOTENCY_MISMATCH:${hook.key}`);
        await this.options.applyDelta?.(manager, input, hook, delta);
        deltas.push(Object.freeze(delta));
      }
      return Object.freeze(deltas);
    });
  }
}
