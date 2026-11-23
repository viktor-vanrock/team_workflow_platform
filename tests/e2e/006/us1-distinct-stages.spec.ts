import { describe, expect, it } from "vitest";

import { queueScenarioCatalog, runQueueScenario } from "../../../tools/local/queue-scenario.mts";

const scenarios = [
  "us1-candidate-has-no-operational-effects",
  "us1-confirmed-needs-info-backlog",
  "us1-dor-and-pending-jira-remain-backlog",
  "us1-confirmed-jira-ready-starts-clock",
  "us1-first-required-session-consumes-wip",
  "us1-completed-precedence",
] as const;

describe("US1 independent stage journey", () => {
  it("registers all six documented scenarios exactly once", () => {
    expect(
      scenarios.every((id) => queueScenarioCatalog.some((scenario) => scenario.id === id)),
    ).toBe(true);
    expect(new Set(queueScenarioCatalog.map(({ id }) => id)).size).toBe(
      queueScenarioCatalog.length,
    );
  });

  it.each(scenarios)("runs %s through API/PostgreSQL/worker assertions", async (id) => {
    await expect(runQueueScenario(id, { mode: "TEST" })).resolves.toMatchObject({
      id,
      status: "PASS",
    });
  });
});
