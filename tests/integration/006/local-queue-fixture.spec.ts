import { describe, expect, it } from "vitest";

import { buildQaJiraGitLabMattermostQueueLocalFixture } from "../../../packages/runtime-composition/src/seed/qa-jira-gitlab-mattermost-queue-local-seed.ts";
import { createQueueFixture, PersistentQueueFaultState } from "../../support/006-queue-fixture.ts";

describe("Feature 006 deterministic local fixture", () => {
  it("contains visible A/B, forbidden C, policies, sessions, attempts and no production authority", () => {
    const fixture = buildQaJiraGitLabMattermostQueueLocalFixture();
    expect(fixture.projects.map(({ key, entitledToLead }) => [key, entitledToLead])).toEqual([
      ["A", true],
      ["B", true],
      ["C", false],
    ]);
    expect(fixture.projects.map(({ interleavedRank }) => interleavedRank)).toEqual([2, 1, 0]);
    expect(fixture.measureOnlyPolicy.mode).toBe("MEASURE_ONLY");
    expect(fixture.enforcedCandidate.mode).toBe("ENFORCED");
    expect(fixture.sessions).toHaveLength(2);
    expect(fixture.attempts).toHaveLength(2);
    expect(fixture.productionEndpoints).toEqual([]);
    expect(fixture.realProviderCredentials).toEqual([]);
    expect(fixture.fixtureHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("uses deterministic time and preserves an unconsumed fault across orchestrator restart", () => {
    const fixture = createQueueFixture();
    expect(fixture.clock.advance(300)).toBe("2026-09-03T08:05:00.000Z");
    const first = new PersistentQueueFaultState(fixture.faultStorage);
    expect(first.set("WORKER_RESTART", 2)).toEqual({
      scenarioId: "WORKER_RESTART",
      remaining: 2,
      revision: 1,
    });
    const restarted = new PersistentQueueFaultState(fixture.faultStorage);
    expect(restarted.current()).toEqual({
      scenarioId: "WORKER_RESTART",
      remaining: 2,
      revision: 1,
    });
    expect(restarted.consume()).toEqual({
      scenarioId: "WORKER_RESTART",
      remaining: 1,
      revision: 2,
    });
    expect(restarted.consume()).toEqual({ scenarioId: "NORMAL", remaining: 0, revision: 3 });
  });
});
