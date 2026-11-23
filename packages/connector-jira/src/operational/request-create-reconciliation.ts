export interface RequestSubEffect {
  readonly kind: "LINK" | "REMOTE_LINK" | "COMMENT";
  readonly semanticIdentity: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly required?: boolean;
}
export interface RequestSubEffectStore {
  prepare?(effectId: string, effects: readonly RequestSubEffect[]): Promise<void> | void;
  begin?(effectId: string, semanticIdentity: string): Promise<void> | void;
  receipt(
    effectId: string,
    semanticIdentity: string,
  ): Promise<string | undefined> | string | undefined;
  confirm(effectId: string, semanticIdentity: string, receipt: string): Promise<void> | void;
}
export class InMemoryRequestSubEffectStore implements RequestSubEffectStore {
  readonly #receipts = new Map<string, string>();
  receipt(effectId: string, semanticIdentity: string): string | undefined {
    return this.#receipts.get(`${effectId}:${semanticIdentity}`);
  }
  confirm(effectId: string, semanticIdentity: string, receipt: string): void {
    this.#receipts.set(`${effectId}:${semanticIdentity}`, receipt);
  }
  confirmed(effectId: string): readonly string[] {
    return [...this.#receipts.keys()]
      .filter((key) => key.startsWith(`${effectId}:`))
      .map((key) => key.slice(effectId.length + 1));
  }
}
export async function reconcileRequestSubEffects(
  effectId: string,
  effects: readonly RequestSubEffect[],
  store: RequestSubEffectStore,
  execute: (effect: RequestSubEffect) => Promise<string>,
): Promise<readonly string[]> {
  await store.prepare?.(effectId, effects);
  const receipts: string[] = [];
  for (const effect of effects) {
    const current = await store.receipt(effectId, effect.semanticIdentity);
    if (current) {
      receipts.push(current);
      continue;
    }
    await store.begin?.(effectId, effect.semanticIdentity);
    const receipt = await execute(effect);
    await store.confirm(effectId, effect.semanticIdentity, receipt);
    receipts.push(receipt);
  }
  return Object.freeze(receipts);
}
