import { describe, expect, it } from "vitest";

import { ProjectSuspensionRecoveryWorker } from "../../../packages/runtime-composition/src/onboarding/recovery-worker.ts";

describe("US5 recovery", () => {
  it("recovers actions, expires probes, repairs projections and reauthorizes pending work", async () => {
    const calls: string[] = [];
    const worker = new ProjectSuspensionRecoveryWorker({
      recoverStaleOperationalActions: async () => 2,
      expireStaleProbes: async () => 3,
      projectsNeedingProjectionRepair: async () => ["p2", "p1", "p1"],
      repairProjection: async (projectId) => {
        calls.push(projectId);
      },
      reauthorizePendingWork: async () => 4,
    });
    await expect(worker.run()).resolves.toEqual({
      recoveredActions: 2,
      expiredProbes: 3,
      repaired: 2,
      reauthorizedWork: 4,
    });
    expect(calls).toEqual(["p1", "p2"]);
  });
});
