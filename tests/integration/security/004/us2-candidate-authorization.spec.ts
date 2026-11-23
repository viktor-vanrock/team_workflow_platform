import { describe, expect, it } from "vitest";

import { IntakeCandidateAggregate } from "../../../../packages/platform-core/src/index.ts";

describe("US2 candidate authorization", () =>
  it("requires a current HUMAN and exact source snapshot", () => {
    const candidate = IntakeCandidateAggregate.discover({
      id: "c",
      workspaceId: "w",
      projectId: "p",
      deduplicationKey: "key",
      currentSourceFingerprint: "v1",
      expiresAt: new Date("2026-09-03"),
    });
    expect(() =>
      candidate.decide("SERVICE", "IGNORE", new Date("2026-09-01"), 1, {
        expectedSourceObservationVersion: 1,
      }),
    ).toThrow("CANDIDATE_DECISION_HUMAN_REQUIRED");
    expect(() =>
      candidate.decide("HUMAN", "IGNORE", new Date("2026-09-01"), 1, {
        expectedSourceObservationVersion: 2,
      }),
    ).toThrow("CANDIDATE_SOURCE_OBSERVATION_STALE");
  }));
