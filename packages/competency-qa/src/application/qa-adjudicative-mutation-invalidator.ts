import type { QaWorkspaceContext } from "../domain/primitives.ts";

export interface QaAdjudicativeMutationInvalidator {
  invalidatePending(context: QaWorkspaceContext, workItemId: string, reason: string): Promise<void>;
}

export interface QaAdjudicativeMutationInvalidatorContribution extends QaAdjudicativeMutationInvalidator {
  readonly key: string;
  readonly order?: number;
}

export class NoopQaAdjudicativeMutationInvalidator implements QaAdjudicativeMutationInvalidator {
  async invalidatePending(
    context: QaWorkspaceContext,
    workItemId: string,
    reason: string,
  ): Promise<void> {
    void [context, workItemId, reason];
  }
}

export const noopQaAdjudicativeMutationInvalidator = Object.freeze(
  new NoopQaAdjudicativeMutationInvalidator(),
);

export class QaAdjudicativeMutationInvalidatorRegistry implements QaAdjudicativeMutationInvalidator {
  readonly #contributions: readonly QaAdjudicativeMutationInvalidatorContribution[];

  constructor(contributions: readonly QaAdjudicativeMutationInvalidatorContribution[] = []) {
    const keys = new Set<string>();
    for (const contribution of contributions) {
      if (keys.has(contribution.key)) {
        throw new Error(`QA_MUTATION_INVALIDATOR_COLLISION:${contribution.key}`);
      }
      keys.add(contribution.key);
    }
    this.#contributions = Object.freeze(
      [...contributions].sort(
        (left, right) =>
          (left.order ?? 0) - (right.order ?? 0) || left.key.localeCompare(right.key),
      ),
    );
  }

  async invalidatePending(
    context: QaWorkspaceContext,
    workItemId: string,
    reason: string,
  ): Promise<void> {
    if (this.#contributions.length === 0) {
      await noopQaAdjudicativeMutationInvalidator.invalidatePending(context, workItemId, reason);
      return;
    }
    for (const contribution of this.#contributions) {
      await contribution.invalidatePending(context, workItemId, reason);
    }
  }
}
