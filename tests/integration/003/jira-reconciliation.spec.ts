import { describe, expect, it } from "vitest";

import {
  FairJiraScheduler,
  planJiraReconciliationPage,
} from "../../../packages/connector-jira/src/index.ts";

describe("Jira reconciliation", () => {
  it("keeps Cloud token/DC offset transient and commits only complete watermark", () => {
    expect(
      planJiraReconciliationPage({
        family: "jira-cloud-v3",
        watermark: { updatedAt: "2026-01-01T00:00:00Z", key: "QAC-1" },
        overlapSeconds: 120,
        complete: false,
        nextPageToken: "opaque",
      }).committedWatermark,
    ).toBeUndefined();
    expect(
      planJiraReconciliationPage({
        family: "jira-dc-10-v2",
        watermark: { updatedAt: "2026-01-01T00:00:00Z", key: "QAC-1" },
        overlapSeconds: 120,
        complete: true,
        offset: 50,
      }).committedWatermark,
    ).toEqual({ updatedAt: "2026-01-01T00:00:00Z", key: "QAC-1" });
  });

  it("schedules command confirmation before webhook and sweep lanes", () => {
    const scheduler = new FairJiraScheduler();
    scheduler.enqueue("FULL_DRIFT_SWEEP", "sweep");
    scheduler.enqueue("COMMAND_CONFIRMATION", "command");
    scheduler.enqueue("BOUND_REFRESH", "webhook");
    expect([scheduler.next(), scheduler.next(), scheduler.next()]).toEqual([
      "command",
      "webhook",
      "sweep",
    ]);
  });
});
