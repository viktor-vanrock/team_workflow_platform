import { describe, expect, it } from "vitest";

import { IntakeCandidateAggregate } from "../../../packages/platform-core/src/index.ts";

const create = () =>
  IntakeCandidateAggregate.discover({
    id: "c",
    workspaceId: "w",
    projectId: "p",
    deduplicationKey: "JIRA:x:1",
    currentSourceFingerprint: "sha256:v1",
    expiresAt: new Date("2026-09-03"),
  });
describe("US2 candidate contract", () => {
  it("maintains identity, observations and closed HUMAN decisions", () => {
    const candidate = create();
    expect(candidate.snapshot()).toMatchObject({
      state: "PENDING_CONFIRMATION",
      currentSourceObservationVersion: 1,
      currentDecisionVersion: 0,
    });
    expect(candidate.observe("sha256:v2", 1)).toEqual({ appended: true, version: 2 });
    expect(
      candidate.decide("HUMAN", "IGNORE", new Date("2026-09-01"), 2, {
        expectedSourceObservationVersion: 2,
      }),
    ).toMatchObject({ state: "IGNORED", currentDecisionVersion: 1 });
  });
  it("requires snooze before expiry", () => {
    const candidate = create();
    expect(() =>
      candidate.decide("HUMAN", "SNOOZE", new Date("2026-09-01"), 1, {
        snoozedUntil: new Date("2026-09-04"),
      }),
    ).toThrow("CANDIDATE_SNOOZE_INVALID");
  });
});
