import { describe, expect, it, vi } from "vitest";

import { MutableProjectEffectGuard } from "../../../../packages/runtime-composition/src/onboarding/project-effect-guard.ts";

describe("US5 effect race", () => {
  it("denies Jira/GitLab/Mattermost/generic effects after suspend", async () => {
    const g = new MutableProjectEffectGuard("w", "p", 1);
    const effect = vi.fn();
    g.suspend();
    for (const provider of ["jira", "gitlab", "mattermost", "generic"])
      await expect(g.execute(provider, effect)).rejects.toThrow("PROJECT_EFFECTS_SUSPENDED");
    expect(effect).not.toHaveBeenCalled();
  });
});
