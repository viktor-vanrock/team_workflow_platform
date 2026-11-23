import type {
  ConfirmedOperationalEffect,
  OperationalConfirmationHook,
  PackConfirmationDelta,
} from "@awp/platform-contracts";

import type { WriteStageAuditor } from "../audit/write-stage-auditor.ts";

export interface OperationalConfirmationUnitOfWork {
  confirmEffect(
    input: ConfirmedOperationalEffect,
    hooks: readonly OperationalConfirmationHook[],
  ): Promise<readonly PackConfirmationDelta[]>;
}

export class OperationalConfirmationHookRegistry {
  readonly #hooks: readonly OperationalConfirmationHook[];

  constructor(hooks: readonly OperationalConfirmationHook[]) {
    const keys = new Set<string>();
    for (const hook of hooks) {
      if (keys.has(hook.key)) throw new Error(`CONFIRMATION_HOOK_COLLISION:${hook.key}`);
      keys.add(hook.key);
    }
    this.#hooks = Object.freeze(
      [...hooks].sort(
        (left, right) =>
          (left.order ?? 0) - (right.order ?? 0) || left.key.localeCompare(right.key),
      ),
    );
  }

  matching(input: ConfirmedOperationalEffect): readonly OperationalConfirmationHook[] {
    return this.#hooks.filter((hook) => hook.matches(input));
  }
}

export class ConfirmOperationalEffect {
  constructor(
    private readonly unitOfWork: OperationalConfirmationUnitOfWork,
    private readonly hooks: OperationalConfirmationHookRegistry,
    private readonly audit?: WriteStageAuditor,
  ) {}

  async confirm(input: ConfirmedOperationalEffect): Promise<readonly PackConfirmationDelta[]> {
    const deltas = await this.unitOfWork.confirmEffect(input, this.hooks.matching(input));
    await this.audit?.record({
      stage: "CONFIRMATION",
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      action: `${input.capabilityKey}.${input.operation}`,
      bindingRef: input.bindingRef,
      profileRef: input.profileRefs[0],
      resultCode: "CONFIRMED",
      reasonCode: "ATOMIC_OPERATIONAL_CONFIRMATION",
      attributes: { commandId: input.commandId, contributionCount: deltas.length },
    });
    return deltas;
  }
}
