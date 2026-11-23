import { describe, expect, it } from "vitest";

import { MutableProjectEffectGuard } from "../../../packages/runtime-composition/src/onboarding/project-effect-guard.ts";

describe("US5 session/lease", () => {
  it("denies new starts while allowing reconciliation", async () => {
    const g = new MutableProjectEffectGuard("w", "p", 1);
    g.suspend();
    await expect(g.execute("session", async () => 1)).rejects.toThrow();
    await expect(g.reconcile(async () => "done")).resolves.toBe("done");
  });
});
