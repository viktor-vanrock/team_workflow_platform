import {
  type OperationalConfirmationHook,
  OperationalConfirmationHookRegistry,
  type TransactionAwareConfirmationHook,
} from "@awp/platform-core";

export function composeConfirmationHooks(
  hooks: readonly TransactionAwareConfirmationHook[],
): ReadonlyMap<string, TransactionAwareConfirmationHook> {
  const map = new Map<string, TransactionAwareConfirmationHook>();
  for (const hook of hooks) {
    if (map.has(hook.componentRef))
      throw new Error(`CONFIRMATION_HOOK_COLLISION:${hook.componentRef}`);
    map.set(hook.componentRef, hook);
  }
  return map;
}
export function composeOperationalConfirmationHooks(
  hooks: readonly OperationalConfirmationHook[],
): OperationalConfirmationHookRegistry {
  return new OperationalConfirmationHookRegistry(hooks);
}
export function appendConfirmationHook(
  base: readonly TransactionAwareConfirmationHook[],
  hook: TransactionAwareConfirmationHook,
): readonly TransactionAwareConfirmationHook[] {
  return Object.freeze([...composeConfirmationHooks([...base, hook]).values()]);
}
