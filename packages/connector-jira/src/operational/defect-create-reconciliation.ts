import type { RequestCreateObservation } from "./request-create.ts";
import {
  reconcileRequestSubEffects,
  type RequestSubEffect,
  type RequestSubEffectStore,
} from "./request-create-reconciliation.ts";

export async function reconcileDefectCreate(
  input: Readonly<{
    effectId: string;
    externalEntityId: string;
    subEffects: readonly RequestSubEffect[];
    store: RequestSubEffectStore;
    execute: (effect: RequestSubEffect) => Promise<string>;
    observe: (id: string) => Promise<RequestCreateObservation>;
  }>,
) {
  const receipts = await reconcileRequestSubEffects(
    input.effectId,
    input.subEffects,
    input.store,
    input.execute,
  );
  const observation = await input.observe(input.externalEntityId);
  if (observation.externalEntityId !== input.externalEntityId)
    throw new Error("DEFECT_READ_BACK_IDENTITY_MISMATCH");
  return Object.freeze({ receipts, observation });
}
