import { describe, expect, it } from "vitest";

import {
  InMemoryRequestSubEffectStore,
  reconcileRequestSubEffects,
} from "../../../packages/connector-jira/src/operational/request-create-reconciliation.ts";

describe("US1 sub-effect recovery", () => {
  it("does not replay exact link/comment receipts after restart", async () => {
    const store = new InMemoryRequestSubEffectStore();
    const calls: string[] = [];
    const effects = [
      { kind: "LINK" as const, semanticIdentity: "source:1", payload: {} },
      { kind: "COMMENT" as const, semanticIdentity: "comment:1", payload: {} },
    ];
    await expect(
      reconcileRequestSubEffects("effect", effects, store, async (effect) => {
        calls.push(effect.semanticIdentity);
        if (effect.semanticIdentity === "comment:1") throw new Error("crash");
        return `receipt:${effect.semanticIdentity}`;
      }),
    ).rejects.toThrow("crash");
    await reconcileRequestSubEffects("effect", effects, store, async (effect) => {
      calls.push(effect.semanticIdentity);
      return `receipt:${effect.semanticIdentity}`;
    });
    expect(calls).toEqual(["source:1", "comment:1", "comment:1"]);
    expect(store.confirmed("effect")).toEqual(["source:1", "comment:1"]);
  });
});
