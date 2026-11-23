import { describe, expect, it } from "vitest";

import { evaluateSessionReviewPreconditions } from "../../packages/competency-qa/src/application/session-review-preconditions.ts";

describe("US3 negative review boundary", () => {
  it.each([
    ["no observation", []],
    [
      "positive only",
      [{ observationId: "o1", attemptId: "a1", planItemId: "p1", kind: "POSITIVE" as const }],
    ],
    [
      "wrong attempt",
      [{ observationId: "o2", attemptId: "a2", planItemId: "p1", kind: "NEGATIVE" as const }],
    ],
  ])("returns stable FINDING_REQUIRED for %s", (_label, observations) => {
    const result = evaluateSessionReviewPreconditions({
      attempts: [{ attemptId: "a1", planItemId: "p1", attemptNo: 1, result: "ASSERTION_FAILED" }],
      observations,
      results: [
        {
          resultRevisionId: "r1",
          planItemId: "p1",
          result: "FAIL",
          attemptIds: ["a1"],
          observationIds: observations.map(({ observationId }) => observationId),
        },
      ],
      evidence: [
        { evidenceLinkId: "e1", ownerType: "ATTEMPT", ownerId: "a1", availability: "AVAILABLE" },
      ],
      waivers: [],
    });
    expect(result).toEqual({ reviewable: false, code: "FINDING_REQUIRED" });
  });

  it("keeps a valid negative leaf at FINDING_REQUIRED without querying a Finding service", () => {
    let findingCalls = 0;
    const result = evaluateSessionReviewPreconditions({
      attempts: [{ attemptId: "a1", planItemId: "p1", attemptNo: 1, result: "ASSERTION_FAILED" }],
      observations: [{ observationId: "o1", attemptId: "a1", planItemId: "p1", kind: "NEGATIVE" }],
      results: [
        {
          resultRevisionId: "r1",
          planItemId: "p1",
          result: "FAIL",
          attemptIds: ["a1"],
          observationIds: ["o1"],
        },
      ],
      evidence: [
        { evidenceLinkId: "e1", ownerType: "ATTEMPT", ownerId: "a1", availability: "AVAILABLE" },
      ],
      waivers: [],
      findingLookup: () => {
        findingCalls += 1;
        return [];
      },
    });
    expect(result).toEqual({ reviewable: false, code: "FINDING_REQUIRED" });
    expect(findingCalls).toBe(0);
  });
});
