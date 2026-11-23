import { describe, expect, it } from "vitest";

import { FairJiraScheduler } from "../../../packages/connector-jira/src/reconciliation/jira-reconciliation.ts";
import { deriveProjectionFreshness } from "../../../packages/platform-core/src/work-management/operational-projection.ts";

describe("003 rate/freshness scheduling", () => {
  it("does not starve full sweeps under command saturation and derives SLO freshness", () => {
    const scheduler = new FairJiraScheduler();
    for (let index = 0; index < 20; index++) scheduler.enqueue("COMMAND_CONFIRMATION", `c${index}`);
    scheduler.enqueue("FULL_DRIFT_SWEEP", "sweep");
    const selected = Array.from({ length: 10 }, () => scheduler.next());
    expect(selected).toContain("sweep");
    expect(deriveProjectionFreshness(new Date(0), 60, new Date(59_000))).toBe("CURRENT");
    expect(deriveProjectionFreshness(new Date(0), 60, new Date(61_000))).toBe("STALE");
  });
});
